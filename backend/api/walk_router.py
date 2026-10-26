import logging
import uuid
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from access import walk_for_owner, walk_for_viewer
from live import broker
from notifier import notify_guardians_of_alert, notify_guardians_of_walk
from pins import ESCALATE_AFTER_FAILURES, PIN_PATTERN, check_sos_pin
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage, haversine_distance, point_to_segment_distance

logger = logging.getLogger("shield-walks")

router = APIRouter(prefix="/api/v1/walks", tags=["Walk Tracking"])

DEVIATION_THRESHOLD_M = 150.0
RIDE_DEVIATION_THRESHOLD_M = 300.0  # vehicles legitimately take parallel roads
ARRIVAL_RADIUS_M = 30.0
END_WITHOUT_PIN_RADIUS_M = 100.0  # ending a trip further than this from the destination needs the PIN
SAFE_STOP_RADIUS_M = 50.0


class StartWalkPayload(BaseModel):
    origin_name: str = Field(max_length=200)
    destination_name: str = Field(max_length=200)
    chosen_route_id: str = Field(max_length=100)
    route_coords: List[Dict[str, float]] = Field(min_length=2, max_length=5000)  # [{"lat": ..., "lon": ...}]
    safety_score: float = Field(ge=0, le=100)
    fastest_time_seconds: int = Field(ge=0)
    shared_guardian_ids: List[str] = Field(default_factory=list, max_length=5)
    mode: Literal["walk", "ride"] = "walk"
    # Ride safety: the auto/cab number plate guardians see, e.g. "CH01AB1234"
    vehicle_plate: Optional[str] = Field(default=None, pattern=r"^[A-Z0-9][A-Z0-9 -]{3,14}$")

    @model_validator(mode="after")
    def _plate_for_rides(self):
        if self.mode == "ride" and not self.vehicle_plate:
            raise ValueError("A ride needs the vehicle number plate.")
        return self


class LocationPoint(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    speed: Optional[float] = 0.0
    accuracy: Optional[float] = 5.0
    heading: Optional[float] = 0.0
    ts: Optional[str] = None
    battery_level: Optional[float] = Field(default=None, ge=0, le=1)


class BatchPointsPayload(BaseModel):
    points: List[LocationPoint] = Field(min_length=1, max_length=500)


class WalkCheckinPayload(BaseModel):
    acknowledged: bool
    safe: bool
    dismissal_latency_seconds: Optional[float] = Field(default=0.0, ge=0, le=3600)
    # "I'm safe" needs the SOS PIN, so someone holding the phone cannot dismiss the check
    pin: Optional[str] = Field(default=None, pattern=PIN_PATTERN)


class EndWalkPayload(BaseModel):
    pin: Optional[str] = Field(default=None, pattern=PIN_PATTERN)


async def _open_walk_alert(walk: dict, user_id: str, trigger: str) -> dict:
    trail = await storage.get_walk_trail(walk["id"])
    last = trail[-1] if trail else (walk["route"][0] if walk.get("route") else {"lat": 0.0, "lon": 0.0})
    result = await storage.sync_alert(
        alert_id=str(uuid.uuid4()), user_id=user_id, trigger_type=trigger,
        lat=last["lat"], lon=last["lon"], priority="HIGH", walk_id=walk["id"], initial_state="ACTIVE",
    )
    return result["alert"]


@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def start_walk(request: Request, payload: StartWalkPayload, background: BackgroundTasks,
                     current_user: dict = Depends(get_current_user)):
    """
    WALK-1: Starts a walk (or a ride) on the chosen route and returns a one-time ticket
    for its live channel. The guardians it is shared with get an SMS with a tracking link.
    """
    user_id = current_user["user_id"]
    own_guardians = {g["id"] for g in await storage.get_guardians(user_id)}
    unknown = set(payload.shared_guardian_ids) - own_guardians
    if unknown:
        raise HTTPException(status_code=400, detail="shared_guardian_ids contains unknown guardians.")
    for c in payload.route_coords:
        if "lat" not in c or "lon" not in c:
            raise HTTPException(status_code=422, detail="Each route coordinate needs lat and lon.")

    walk = await storage.create_walk(
        user_id=user_id,
        origin_name=payload.origin_name,
        destination_name=payload.destination_name,
        chosen_route_id=payload.chosen_route_id,
        route_coords=payload.route_coords,
        safety_score=payload.safety_score,
        fastest_time_seconds=payload.fastest_time_seconds,
        shared_with=payload.shared_guardian_ids,
        mode=payload.mode,
        vehicle_plate=payload.vehicle_plate,
    )
    if walk["shared_with"]:
        background.add_task(notify_guardians_of_walk, walk)
    ticket = await storage.create_ws_ticket(walk_id=walk["id"], user_id=user_id, ttl_seconds=300)
    return {
        "status": "walk_started",
        "walk": walk,
        "ws_ticket": ticket,
        "ws_url": f"/ws/walk/{walk['id']}?ticket={ticket}",
    }


@router.post("/{walk_id}/points")
@limiter.limit("60/minute")
async def batch_location_points(request: Request, walk_id: str, payload: BatchPointsPayload,
                                current_user: dict = Depends(get_current_user)):
    """
    WALK-2 to WALK-8: Stores a batch of fixes, then checks route deviation
    (>150 m), long stops away from Safe Stops, arrival (<30 m) and battery.
    """
    walk = await walk_for_owner(current_user, walk_id)
    if walk["status"] != "ACTIVE":
        raise HTTPException(status_code=409, detail="Walk is not active.")

    inserted_count = await storage.add_walk_points(walk_id, [p.model_dump() for p in payload.points])
    latest = payload.points[-1]
    await broker.broadcast(walk_id, {"type": "location", "walk_id": walk_id, **latest.model_dump()})

    route_coords = walk.get("route", [])
    deviation_distance_m = 0.0
    if len(route_coords) >= 2:
        deviation_distance_m = round(min(
            point_to_segment_distance(latest.lat, latest.lon, p1["lat"], p1["lon"], p2["lat"], p2["lon"])
            for p1, p2 in zip(route_coords, route_coords[1:])
        ), 1)
    threshold = RIDE_DEVIATION_THRESHOLD_M if walk.get("mode") == "ride" else DEVIATION_THRESHOLD_M
    deviation_alert = deviation_distance_m > threshold
    if deviation_alert:
        logger.warning("Route deviation on walk %s: %.0f m off path", walk_id, deviation_distance_m)

    long_stop_detected = False
    if (latest.speed or 0.0) < 0.3:
        dist_to_safe_stop = min(
            (haversine_distance(latest.lat, latest.lon, s["lat"], s["lon"]) for s in await storage.get_safe_stops()),
            default=float("inf"),
        )
        long_stop_detected = dist_to_safe_stop > SAFE_STOP_RADIUS_M

    arrived = bool(route_coords) and haversine_distance(
        latest.lat, latest.lon, route_coords[-1]["lat"], route_coords[-1]["lon"]) <= ARRIVAL_RADIUS_M
    low_battery = latest.battery_level is not None and latest.battery_level <= 0.15

    return {
        "status": "points_recorded",
        "count": inserted_count,
        "deviation_alert": deviation_alert,
        "deviation_distance_m": deviation_distance_m,
        "long_stop_detected": long_stop_detected,
        "checkin_required": long_stop_detected or deviation_alert,
        "arrived_at_destination": arrived,
        "low_battery_mode": low_battery,
        "sampling_rate_seconds": 30 if low_battery else (2 if deviation_alert else 10),
    }


@router.post("/{walk_id}/checkin")
@limiter.limit("20/minute")
async def walk_checkin(request: Request, walk_id: str, payload: WalkCheckinPayload, background: BackgroundTasks,
                       current_user: dict = Depends(get_current_user)):
    """
    WALK-6: Check-in response. "I'm safe" resets the timer; a missed or
    negative check-in opens a CHECKIN_TIMEOUT alert and messages guardians.
    """
    walk = await walk_for_owner(current_user, walk_id)
    if payload.acknowledged and payload.safe:
        if not payload.pin:
            raise HTTPException(status_code=403, detail="Your SOS PIN is required to confirm you are safe.")
        kind, failures = await check_sos_pin(current_user["user_id"], payload.pin)
        if kind == "normal":
            return {"status": "checkin_confirmed", "dismissal_latency_seconds": payload.dismissal_latency_seconds}
        if kind is None and failures != ESCALATE_AFTER_FAILURES:
            raise HTTPException(status_code=403, detail="Incorrect PIN.")
        # Duress PIN (looks confirmed) or repeated wrong PINs: alert the guardians
        alert = await _open_walk_alert(walk, current_user["user_id"], "DURESS_PIN" if kind == "duress" else "CHECKIN_TIMEOUT")
        background.add_task(notify_guardians_of_alert, alert)
        if kind is None:
            raise HTTPException(status_code=403, detail="Incorrect PIN.")
        return {"status": "checkin_confirmed", "dismissal_latency_seconds": payload.dismissal_latency_seconds}

    alert = await _open_walk_alert(walk, current_user["user_id"], "CHECKIN_TIMEOUT")
    background.add_task(notify_guardians_of_alert, alert)
    logger.warning("Missed check-in on walk %s; alert %s opened", walk_id, alert["id"])
    return {"status": "escalation_triggered", "walk_id": walk_id, "alert_id": alert["id"]}


@router.get("/{walk_id}")
async def get_walk_status(request: Request, walk_id: str, current_user: dict = Depends(get_current_user)):
    """Walk status, route and GPS trail, for the walker and the guardians it is shared with."""
    walk = await walk_for_viewer(current_user, walk_id)
    trail = await storage.get_walk_trail(walk_id)
    return {"walk": walk, "trail": trail, "total_points": len(trail)}


@router.post("/{walk_id}/end")
@limiter.limit("20/minute")
async def end_walk(request: Request, walk_id: str, background: BackgroundTasks,
                   payload: EndWalkPayload = EndWalkPayload(), current_user: dict = Depends(get_current_user)):
    """
    WALK-7: Ends the walk and prompts for a rating. Ending it away from the destination
    stops the guardians' live view, so it needs the SOS PIN (the duress PIN ends it on
    screen but alerts the guardians).
    """
    walk = await walk_for_owner(current_user, walk_id)
    if walk["status"] != "ACTIVE":
        raise HTTPException(status_code=409, detail="Walk already completed.")
    trail = await storage.get_walk_trail(walk_id)
    route = walk.get("route") or []
    arrived = bool(trail and route) and haversine_distance(
        trail[-1]["lat"], trail[-1]["lon"], route[-1]["lat"], route[-1]["lon"]) <= END_WITHOUT_PIN_RADIUS_M
    if not arrived:
        if not payload.pin:
            raise HTTPException(status_code=403, detail="You are not at your destination yet. Enter your SOS PIN to end the trip.")
        kind, failures = await check_sos_pin(current_user["user_id"], payload.pin)
        if kind is None:
            if failures == ESCALATE_AFTER_FAILURES:
                background.add_task(notify_guardians_of_alert, await _open_walk_alert(walk, current_user["user_id"], "CHECKIN_TIMEOUT"))
            raise HTTPException(status_code=403, detail="Incorrect PIN.")
        if kind == "duress":
            background.add_task(notify_guardians_of_alert, await _open_walk_alert(walk, current_user["user_id"], "DURESS_PIN"))
    walk = await storage.end_walk(walk_id, current_user["user_id"])
    await broker.broadcast(walk_id, {"type": "walk_ended", "walk_id": walk_id})
    return {
        "status": "walk_completed",
        "walk": walk,
        "rating_prompt": {"required": True, "message": "RATE-1: How was your walk? Lit? Busy? Felt safe?"},
    }
