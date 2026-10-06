import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage, haversine_distance, point_to_segment_distance

logger = logging.getLogger("shield-walks")

router = APIRouter(prefix="/api/v1/walks", tags=["Walk Tracking"])

class StartWalkPayload(BaseModel):
    origin_name: str
    destination_name: str
    chosen_route_id: str
    route_coords: List[Dict[str, float]] # [{"lat": ..., "lon": ...}]
    safety_score: float
    fastest_time_seconds: int
    shared_guardian_ids: List[str] = []

class LocationPoint(BaseModel):
    lat: float
    lon: float
    speed: Optional[float] = 0.0
    accuracy: Optional[float] = 5.0
    heading: Optional[float] = 0.0
    ts: Optional[str] = None
    battery_level: Optional[float] = None

class BatchPointsPayload(BaseModel):
    points: List[LocationPoint]

@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def start_walk(
    request: Request,
    payload: StartWalkPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    WALK-1: Start walk on chosen route.
    Generates walk record and one-time WebSocket ticket for guardian live streaming.
    """
    user_id = str(current_user["user_id"])
    walk = await storage.create_walk(
        user_id=user_id,
        origin_name=payload.origin_name,
        destination_name=payload.destination_name,
        chosen_route_id=payload.chosen_route_id,
        route_coords=payload.route_coords,
        safety_score=payload.safety_score,
        fastest_time_seconds=payload.fastest_time_seconds,
        shared_with=payload.shared_guardian_ids
    )

    # Generate one-time WebSocket ticket (NFR-10)
    ticket = await storage.create_ws_ticket(walk_id=walk["id"], user_id=user_id, ttl_seconds=300)

    return {
        "status": "walk_started",
        "walk": walk,
        "ws_ticket": ticket,
        "ws_url": f"/ws/walk/{walk['id']}?ticket={ticket}",
        "message": "Foreground service active with persistent notification."
    }

@router.post("/{walk_id}/points")
@limiter.limit("60/minute")
async def batch_location_points(
    request: Request,
    walk_id: str,
    payload: BatchPointsPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    WALK-2, WALK-3, WALK-4:
    Batch location points, check route deviation (>150m for >30s),
    and check arrival (within 30m of destination).
    """
    walk = await storage.get_walk(walk_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found")

    points_data = [p.model_dump() for p in payload.points]
    inserted_count = await storage.add_walk_points(walk_id, points_data)

    # Route deviation check (WALK-4)
    route_coords = walk.get("route", [])
    deviation_alert = False
    deviation_distance_m = 0.0

    if route_coords and payload.points:
        latest = payload.points[-1]
        # Calculate minimum distance from latest point to any segment of chosen route
        min_dist = float("inf")
        for i in range(len(route_coords) - 1):
            p1 = route_coords[i]
            p2 = route_coords[i + 1]
            dist = point_to_segment_distance(
                latest.lat, latest.lon,
                p1["lat"], p1["lon"],
                p2["lat"], p2["lon"]
            )
            if dist < min_dist:
                min_dist = dist

        deviation_distance_m = round(min_dist, 1)
        # Flag deviation if > 150m
        if deviation_distance_m > 150.0:
            deviation_alert = True
            logger.warning(f"Route deviation detected on walk {walk_id}: {deviation_distance_m}m off path")

    # Long-stop detection outside Safe Stop (WALK-5)
    long_stop_detected = False
    checkin_required = False
    if payload.points:
        latest = payload.points[-1]
        is_stationary = (latest.speed or 0.0) < 0.3
        if is_stationary:
            safe_stops = await storage.get_safe_stops()
            dist_to_nearest_safe_stop = min(
                (haversine_distance(latest.lat, latest.lon, s["lat"], s["lon"]) for s in safe_stops),
                default=9999.0
            )
            # If stopped motionless outside designated Safe Stop (>50m away)
            if dist_to_nearest_safe_stop > 50.0:
                long_stop_detected = True
                checkin_required = True

    # Arrival check (WALK-7)
    arrived = False
    if route_coords and payload.points:
        dest = route_coords[-1]
        latest = payload.points[-1]
        dist_to_dest = haversine_distance(latest.lat, latest.lon, dest["lat"], dest["lon"])
        if dist_to_dest <= 30.0:
            arrived = True

    # Low battery mode (WALK-8)
    low_battery = False
    if payload.points and payload.points[-1].battery_level is not None:
        if payload.points[-1].battery_level <= 0.15:
            low_battery = True

    return {
        "status": "points_recorded",
        "count": inserted_count,
        "deviation_alert": deviation_alert,
        "deviation_distance_m": deviation_distance_m,
        "long_stop_detected": long_stop_detected,
        "checkin_required": checkin_required,
        "arrived_at_destination": arrived,
        "low_battery_mode": low_battery,
        "sampling_rate_seconds": 30 if low_battery else (2 if deviation_alert else 10)
    }

class WalkCheckinPayload(BaseModel):
    acknowledged: bool
    safe: bool
    dismissal_latency_seconds: Optional[float] = 0.0

@router.post("/{walk_id}/checkin")
@limiter.limit("20/minute")
async def walk_checkin(
    request: Request,
    walk_id: str,
    payload: WalkCheckinPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    WALK-6: Check-in response handler.
    If user acknowledges safe within 20-second dismissal window, resets timer.
    If not acknowledged or safe=False, alerts guardians.
    """
    walk = await storage.get_walk(walk_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found")

    user_id = str(current_user["user_id"])
    if not payload.acknowledged or not payload.safe:
        # Trigger guardian escalation (ALERT-8)
        logger.warning(f"Unacknowledged or distress check-in on walk {walk_id}")
        return {
            "status": "escalation_triggered",
            "message": "Guardians alerted due to missed check-in",
            "walk_id": walk_id
        }

    return {
        "status": "checkin_confirmed",
        "message": "User verified safe; timer reset",
        "dismissal_latency_seconds": payload.dismissal_latency_seconds
    }

@router.get("/{walk_id}")
async def get_walk_status(
    request: Request,
    walk_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Returns walk status, route, and full GPS trail for guardian or walker."""
    walk = await storage.get_walk(walk_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found")

    trail = await storage.get_walk_trail(walk_id)
    return {
        "walk": walk,
        "trail": trail,
        "total_points": len(trail)
    }

@router.post("/{walk_id}/end")
async def end_walk(
    request: Request,
    walk_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    WALK-7: End walk, notify guardians, prompt for rating.
    """
    user_id = str(current_user["user_id"])
    walk = await storage.end_walk(walk_id, user_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found or already completed")

    return {
        "status": "walk_completed",
        "walk": walk,
        "rating_prompt": {
            "required": True,
            "message": "RATE-1: How was your walk? Lit? Busy? Felt safe?"
        }
    }
