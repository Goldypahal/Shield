"""SRS Section 6.3 alert state machine, enforced in one place."""
from typing import Optional

from fastapi import HTTPException

from db.storage import storage

TERMINAL = {"RESOLVED", "FALSE_ALARM", "CANCELLED"}
OPEN = {"PRE_ALERT", "ACTIVE", "ACKNOWLEDGED", "ESCALATED"}

TRANSITIONS = {
    "PRE_ALERT": {"ACTIVE", "CANCELLED"},
    "ACTIVE": {"ACKNOWLEDGED", "ESCALATED", "RESOLVED", "FALSE_ALARM", "CANCELLED"},
    "ESCALATED": {"ESCALATED", "ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM", "CANCELLED"},
    "ACKNOWLEDGED": {"ACKNOWLEDGED", "ESCALATED", "RESOLVED", "FALSE_ALARM", "CANCELLED"},
}


async def transition(alert: dict, new_state: str, actor: str, meta: Optional[dict] = None) -> dict:
    allowed = TRANSITIONS.get(alert["state"], set())
    if new_state not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot move alert from {alert['state']} to {new_state}.",
        )
    return await storage.update_alert_state(alert["id"], new_state, actor=actor, meta=meta)
