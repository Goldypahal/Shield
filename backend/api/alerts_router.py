import json
import logging
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from access import alert_for_owner, alert_for_viewer, guardian_link, staff_can_see, walk_for_owner
from alert_states import OPEN, transition
from ble_relay import E5, MAX_LAT_E5, MAX_LON_E5, RELAY_VERSION, verify as verify_relay_signature
from live import broker
import police
from notifier import notify_guardians_of_alert
from pins import ESCALATE_AFTER_FAILURES, PIN_PATTERN, check_sos_pin
from security import get_current_user, is_staff
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-alerts")

router = APIRouter(prefix="/api/v1/alerts", tags=["Alerts & Escalation"])

TriggerType = Literal[
    "SOS_BUTTON", "AUDIO", "AUDIO_DISTRESS", "MOTION", "FALL", "SHAKE", "VOICE",
    "DEVIATION", "DURESS_PIN", "CHECKIN_TIMEOUT", "AUTO_TRIGGER",
]


class SyncAlertPayload(BaseModel):
    """ALERT-4: client-generated UUID makes retries from the offline queue idempotent."""
    model_config = ConfigDict(populate_by_name=True)

    id: str
    # `type` is accepted for app builds that predate the field rename
    trigger_type: TriggerType = Field(alias="type")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    priority: Literal["LOW", "MEDIUM", "HIGH"] = "HIGH"
    walk_id: Optional[str] = None
    state: Literal["PRE_ALERT", "ACTIVE"] = "ACTIVE"
    # Accepted but ignored: SMS only ever goes to the walker's registered guardians.
    contacts: Optional[List[str]] = None
    message: Optional[str] = Field(default=None, max_length=500)

    @field_validator("id")
    @classmethod
    def _uuid(cls, v: str) -> str:
        return str(uuid.UUID(v))


class RelayAlertPayload(BaseModel):
    """A signed SOS packet that reached the API through a nearby phone over Bluetooth.

    Names are short because the packet is assembled by hand on the radio side; `sig`
    is an HMAC-SHA256 over the canonical form built by ble_relay.canonical(). The
    walker's id and the alert id must be lowercase canonical UUIDs on both sides,
    because the signature is computed over the strings as sent.

    Unknown fields are rejected rather than ignored: the signature covers a fixed
    field list, so silently accepting extra keys would let what we parsed and what
    we verified disagree.
    """
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    v: int = RELAY_VERSION
    id: str
    uid: str
    tt: TriggerType = Field(alias="trigger_type")
    # Coordinates as integer micro-degrees: floats are kept out of the signed bytes
    lat_e5: int = Field(ge=-MAX_LAT_E5, le=MAX_LAT_E5)
    lon_e5: int = Field(ge=-MAX_LON_E5, le=MAX_LON_E5)
    pri: Literal["LOW", "MEDIUM", "HIGH"] = "HIGH"
    ts: int
    sig: str = Field(min_length=64, max_length=64)

    @field_validator("id", "uid")
    @classmethod
    def _uuid(cls, v: str) -> str:
        parsed = uuid.UUID(v)  # rejects anything that is not a UUID
        return str(parsed)  # canonical lowercase, so signature checks are stable


class StateTransitionPayload(BaseModel):
    state: Literal["ACTIVE", "CANCELLED", "RESOLVED", "FALSE_ALARM"]
    reason: Optional[str] = Field(default=None, max_length=500)
    pin: Optional[str] = Field(default=None, pattern=PIN_PATTERN)


STAND_DOWN = ("CANCELLED", "RESOLVED", "FALSE_ALARM")


class AckAlertPayload(BaseModel):
    action: Literal["ACKNOWLEDGE", "CALL"] = "ACKNOWLEDGE"


class EscalatePayload(BaseModel):
    reason: str = Field(default="No acknowledgement within 60s", max_length=300)


class FalseAlarmPayload(BaseModel):
    reason: str = Field(max_length=500)  # Tuning feedback (ALERT-11)


class AlertLocationPayload(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy: Optional[float] = Field(default=None, ge=0)
    speed: Optional[float] = None
    heading: Optional[float] = None


async def _publish(request: Request, alert: dict) -> None:
    redis_pool = getattr(request.app.state, "redis_pool", None)
    if not redis_pool:
        return
    try:
        await redis_pool.publish("active_alerts", json.dumps({
            "alert_id": alert["id"], "user_id": alert["user_id"], "lat": alert["lat"], "lon": alert["lon"],
            "trigger_type": alert["trigger_type"], "priority": alert["priority"],
        }))
    except Exception as e:
        logger.warning("Redis publish skipped: %s", e)


@router.post("/sync", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def sync_alert(request: Request, payload: SyncAlertPayload, background: BackgroundTasks,
                     current_user: dict = Depends(get_current_user)):
    """
    ALERT-4, ALERT-6, ALERT-7: Idempotent alert upload. Re-sending the same UUID
    returns the stored record. A new ACTIVE alert messages the walker's guardians.
    """
    user_id = current_user["user_id"]
    if payload.walk_id:
        await walk_for_owner(current_user, payload.walk_id)
    result = await storage.sync_alert(
        alert_id=payload.id, user_id=user_id, trigger_type=payload.trigger_type,
        lat=payload.lat, lon=payload.lon, priority=payload.priority,
        walk_id=payload.walk_id, initial_state=payload.state,
    )
    if result["alert"]["user_id"] != user_id:
        raise HTTPException(status_code=409, detail="Alert id already in use.")

    if result["status"] == "synced":
        await _publish(request, result["alert"])
        if payload.state == "ACTIVE":
            background.add_task(notify_guardians_of_alert, result["alert"])
    return result


@router.post("/relay", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def relay_alert(request: Request, payload: RelayAlertPayload, background: BackgroundTasks,
                      current_user: dict = Depends(get_current_user)):
    """
    Bluetooth relay: a walker with no signal cannot reach the API, so a nearby SHIELD
    phone that can uploads their signed packet here on their behalf.

    The alert belongs to the walker, not to the phone that carried it, and the relaying
    account is recorded in the audit log. The alert id is the walker's own client-generated
    UUID, so a packet relayed by several phones (or replayed later) is a no-op after the
    first time and guardians are not notified twice. What a valid signature does and does
    not prove is documented in ble_relay.py; it is weaker than the rest of this API.
    """
    if not verify_relay_signature(payload.model_dump()):
        raise HTTPException(status_code=403, detail="Relay signature check failed.")
    if payload.uid == current_user["user_id"]:
        raise HTTPException(status_code=409, detail="Relay from the walker's own device goes to /sync.")
    if not await storage.get_user_by_id(payload.uid):
        raise HTTPException(status_code=404, detail="Unknown walker.")

    result = await storage.sync_alert(
        alert_id=payload.id, user_id=payload.uid, trigger_type=payload.tt,
        lat=payload.lat_e5 / E5, lon=payload.lon_e5 / E5, priority=payload.pri,
        initial_state="ACTIVE",
    )
    if result["alert"]["user_id"] != payload.uid:
        raise HTTPException(status_code=409, detail="Alert id already in use.")

    if result["status"] == "synced":
        await storage.log_audit(
            actor=current_user["user_id"],
            action=f"ALERT_RELAYED_BY_BLUETOOTH walker={payload.uid}",
            target=f"alert/{payload.id}",
        )
        await _publish(request, result["alert"])
        background.add_task(notify_guardians_of_alert, result["alert"])
    return {**result, "relayed_by": current_user["user_id"]}


@router.post("/{alert_id}/location")
@limiter.limit("120/minute")
async def push_alert_location(request: Request, alert_id: str, payload: AlertLocationPayload,
                              current_user: dict = Depends(get_current_user)):
    """Live location during an SOS; fanned out to guardians on /ws/alert/{alert_id}."""
    alert = await alert_for_owner(current_user, alert_id)
    if alert["state"] not in OPEN:
        raise HTTPException(status_code=409, detail="Alert is closed.")
    point = await storage.add_alert_point(alert_id, payload.lat, payload.lon, payload.accuracy,
                                          payload.speed, payload.heading)
    await broker.broadcast(alert_id, {"type": "location", **point})
    return {"status": "location_recorded", "subscribers": broker.subscriber_count(alert_id)}


@router.put("/{alert_id}/state")
@limiter.limit("20/minute")
async def transition_alert_state(request: Request, alert_id: str, payload: StateTransitionPayload,
                                 background: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """
    ALERT-10 & Section 6.3: walker-side transitions (activate, cancel, resolve).

    Standing an alert down (cancel, resolve, false alarm) always needs the SOS PIN,
    from any state. Entering the duress PIN looks like a successful cancel but keeps
    the alert open and re-alerts guardians (DUR-2), for when someone forces the walker
    to cancel. Repeated wrong PINs escalate the alert, then lock the PIN.
    """
    alert = await alert_for_owner(current_user, alert_id)
    actor = f"walker:{current_user['user_id']}"

    if payload.state in STAND_DOWN:
        if alert["state"] not in OPEN:
            raise HTTPException(status_code=409, detail=f"Cannot move alert from {alert['state']} to {payload.state}.")
        if not payload.pin:
            raise HTTPException(status_code=403, detail="Your SOS PIN is required to stop an alert.")
        kind, failures = await check_sos_pin(current_user["user_id"], payload.pin)
        if kind == "duress":
            if alert["state"] == "PRE_ALERT":
                alert = await transition(alert, "ACTIVE", "duress", {"silent": True})
            escalated = await storage.update_alert_state(alert_id, "ESCALATED", actor="duress",
                                                         meta={"silent": True, "reason": "duress PIN used to cancel"})
            background.add_task(notify_guardians_of_alert, escalated or alert)
            logger.warning("Duress cancel on alert %s; kept open and escalated", alert_id)
            return {"status": "state_updated", "alert": {**alert, "state": payload.state}}
        if kind is None:
            if failures == ESCALATE_AFTER_FAILURES:
                target = "ACTIVE" if alert["state"] == "PRE_ALERT" else "ESCALATED"
                escalated = await transition(alert, target, "pin_guard",
                                             {"reason": f"{failures} wrong PINs entered while trying to stop the alert"})
                background.add_task(notify_guardians_of_alert, escalated)
                logger.warning("Alert %s escalated after %d wrong PINs", alert_id, failures)
            raise HTTPException(status_code=403, detail="Incorrect PIN.")

    meta = {"reason": payload.reason} if payload.reason else {}
    updated = await transition(alert, payload.state, actor, meta)
    if payload.state == "ACTIVE":
        background.add_task(notify_guardians_of_alert, updated)
    return {"status": "state_updated", "alert": updated}


@router.post("/{alert_id}/ack")
@limiter.limit("30/minute")
async def acknowledge_alert(request: Request, alert_id: str, payload: AckAlertPayload = AckAlertPayload(),
                            current_user: dict = Depends(get_current_user)):
    """ALERT-8 & GRD-5: a guardian (or responder) acknowledges, stopping the escalation timer."""
    alert = await alert_for_viewer(current_user, alert_id)
    if alert["user_id"] == current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Walkers cannot acknowledge their own alert.")
    link = await guardian_link(current_user, alert["user_id"])
    actor = f"guardian:{link['name']}" if link else f"{current_user['role']}:{current_user['user_id']}"
    updated = await transition(alert, "ACKNOWLEDGED", actor, {"action": payload.action})
    return {"status": "acknowledged", "alert": updated}


@router.post("/{alert_id}/escalate")
@limiter.limit("20/minute")
async def escalate_alert(request: Request, alert_id: str, payload: EscalatePayload = EscalatePayload(),
                         current_user: dict = Depends(get_current_user)):
    """ALERT-8: escalate to the next guardian / responder queue."""
    alert = await alert_for_viewer(current_user, alert_id)
    actor = f"{current_user['role']}:{current_user['user_id']}"
    updated = await transition(alert, "ESCALATED", actor, {"escalation_reason": payload.reason})
    return {"status": "escalated", "alert": updated}


@router.post("/{alert_id}/false-alarm")
@limiter.limit("10/minute")
async def mark_false_alarm(request: Request, alert_id: str, payload: FalseAlarmPayload,
                           current_user: dict = Depends(get_current_user)):
    """ALERT-11: walker marks a false alarm, with a reason used for threshold tuning."""
    alert = await alert_for_owner(current_user, alert_id)
    if alert["state"] not in OPEN:
        raise HTTPException(status_code=409, detail="Alert is already closed.")
    await storage.record_false_alarm(alert_id, payload.reason)
    return {"status": "false_alarm_recorded", "alert_id": alert_id, "reason": payload.reason}


@router.get("/{alert_id}")
async def get_alert(request: Request, alert_id: str, current_user: dict = Depends(get_current_user)):
    """Alert details, event log and recent live trail, for the walker, their guardians and responders."""
    alert = await alert_for_viewer(current_user, alert_id)
    trail = [] if alert.get("location_withheld") else await storage.get_alert_points(alert_id, limit=200)
    station = await storage.get_station(alert["station_id"]) if alert.get("station_id") else None
    return {"alert": alert, "trail": trail,
            "police": {"status": alert.get("police_status"), "text": police.status_text(alert, station["name"] if station else None),
                       "station": {"name": station["name"], "phone": station.get("phone")} if station else None,
                       "incident_112": alert.get("erss_incident_id")}}


guardian_router = APIRouter(prefix="/api/v1/guardian", tags=["Alerts & Escalation"])


@guardian_router.get("/alerts")
@limiter.limit("30/minute")
async def list_guarded_alerts(request: Request, current_user: dict = Depends(get_current_user)):
    """GRD-4: open alerts of every walker who added this account as a verified guardian."""
    walkers = {link["user_id"] for link in await storage.get_guardianships(current_user["phone_number"])}
    alerts = [a for a in await storage.get_active_alerts()
              if a["user_id"] in walkers or await staff_can_see(current_user, a)]
    return {"alerts": [
        {k: a.get(k) for k in ("id", "user_id", "walker_name", "trigger_type", "priority", "state",
                               "lat", "lon", "started_at", "walk_id")}
        for a in alerts
    ]}
