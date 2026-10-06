import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-alerts")

router = APIRouter(prefix="/api/v1/alerts", tags=["Alerts & Escalation"])

class SyncAlertPayload(BaseModel):
    id: str  # Client-generated UUID (ALERT-4)
    trigger_type: str  # SOS_BUTTON, AUDIO, MOTION, FALL, DEVIATION, DURESS_PIN, CHECKIN_TIMEOUT
    lat: float
    lon: float
    priority: Optional[str] = "HIGH"
    walk_id: Optional[str] = None
    state: Optional[str] = "ACTIVE"
    contacts: Optional[List[str]] = []
    message: Optional[str] = None

class StateTransitionPayload(BaseModel):
    state: str  # PRE_ALERT, ACTIVE, ACKNOWLEDGED, ESCALATED, RESOLVED, FALSE_ALARM, CANCELLED
    reason: Optional[str] = None
    pin: Optional[str] = None

class AckAlertPayload(BaseModel):
    guardian_id: str
    guardian_name: Optional[str] = "Guardian"
    action: Optional[str] = "ACKNOWLEDGE" # ACKNOWLEDGE, ESCALATE, CALL

class FalseAlarmPayload(BaseModel):
    reason: str  # Tuning feedback (ALERT-11)

@router.post("/sync", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def sync_alert(
    request: Request,
    payload: SyncAlertPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    ALERT-4, ALERT-6, ALERT-7:
    Idempotent alert upload using client-generated UUID.
    Duplicate submissions of the same UUID return existing record without error.
    """
    user_id = str(current_user["user_id"])
    result = await storage.sync_alert(
        alert_id=payload.id,
        user_id=user_id,
        trigger_type=payload.trigger_type,
        lat=payload.lat,
        lon=payload.lon,
        priority=payload.priority or "HIGH",
        walk_id=payload.walk_id,
        initial_state=payload.state or "ACTIVE"
    )

    # If Redis is available, publish alert for real-time dashboard and guardians
    redis_pool = getattr(request.app.state, "redis_pool", None)
    if redis_pool:
        try:
            await redis_pool.publish("active_alerts", json.dumps({
                "alert_id": payload.id,
                "user_id": user_id,
                "lat": payload.lat,
                "lon": payload.lon,
                "trigger_type": payload.trigger_type,
                "priority": payload.priority
            }))
        except Exception as e:
            logger.warning(f"Redis publish skipped: {e}")

    return result

@router.put("/{alert_id}/state")
@limiter.limit("20/minute")
async def transition_alert_state(
    request: Request,
    alert_id: str,
    payload: StateTransitionPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    ALERT-10 & Section 6.3 State Machine:
    Transitions alert states: PRE_ALERT -> ACTIVE / CANCELLED -> ACKNOWLEDGED / ESCALATED -> RESOLVED / FALSE_ALARM.
    """
    actor = f"user_{current_user.get('user_id')}"
    meta = {"reason": payload.reason} if payload.reason else {}

    try:
        updated = await storage.update_alert_state(alert_id, payload.state, actor=actor, meta=meta)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"status": "state_updated", "alert": updated}

@router.post("/{alert_id}/ack")
@limiter.limit("30/minute")
async def acknowledge_alert(
    request: Request,
    alert_id: str,
    payload: AckAlertPayload
):
    """
    ALERT-8 & GRD-5:
    Guardian acknowledges alert within 60s, transitioning state to ACKNOWLEDGED.
    """
    meta = {"guardian_id": payload.guardian_id, "guardian_name": payload.guardian_name, "action": payload.action}
    updated = await storage.update_alert_state(
        alert_id,
        "ACKNOWLEDGED",
        actor=f"guardian_{payload.guardian_name}",
        meta=meta
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {
        "status": "acknowledged",
        "alert": updated,
        "message": f"Alert acknowledged by {payload.guardian_name}. Escalation timer stopped."
    }

@router.post("/{alert_id}/escalate")
@limiter.limit("20/minute")
async def escalate_alert(
    request: Request,
    alert_id: str,
    reason: Optional[str] = "No acknowledgement within 60s"
):
    """
    ALERT-8: Escalation chain.
    If Guardian 1 does not acknowledge within 60s, escalate to Guardian 2, then Guardian 3, then Responders.
    """
    meta = {"escalation_reason": reason}
    updated = await storage.update_alert_state(
        alert_id,
        "ESCALATED",
        actor="system_escalation_engine",
        meta=meta
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {
        "status": "escalated",
        "alert": updated,
        "message": "Escalated to next guardian / campus responder queue."
    }

@router.post("/{alert_id}/false-alarm")
@limiter.limit("10/minute")
async def mark_false_alarm(
    request: Request,
    alert_id: str,
    payload: FalseAlarmPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    ALERT-11:
    Mark alert as false alarm with explanation reason for model/threshold tuning.
    """
    success = await storage.record_false_alarm(alert_id, payload.reason)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {
        "status": "false_alarm_recorded",
        "alert_id": alert_id,
        "reason": payload.reason,
        "message": "Feedback recorded for threshold tuning."
    }

@router.get("/{alert_id}")
async def get_alert(
    request: Request,
    alert_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get alert details, current state, and transition event log."""
    alert = await storage.get_alert_by_id(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"alert": alert}
