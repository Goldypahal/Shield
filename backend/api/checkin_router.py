"""Check-in timers ("I should be home in 20 minutes").

The countdown lives on the server, so it still fires if the phone dies, is
switched off or is taken. Confirming or extending needs the SOS PIN: anyone
holding the phone could otherwise silence it. The duress PIN looks like a
normal confirm but alerts the guardians at once.
"""
import time
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from notifier import notify_guardians_of_alert
from pins import ESCALATE_AFTER_FAILURES, PIN_PATTERN, check_sos_pin
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-checkins")

router = APIRouter(prefix="/api/v1/checkins", tags=["Check-in timer"])

MAX_MINUTES = 12 * 60


class StartCheckinPayload(BaseModel):
    minutes: int = Field(ge=1, le=MAX_MINUTES)
    label: Optional[str] = Field(default=None, max_length=120)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)


class PinPayload(BaseModel):
    pin: str = Field(pattern=PIN_PATTERN)
    minutes: Optional[int] = Field(default=None, ge=1, le=MAX_MINUTES)  # extend only


class LocationPayload(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


def _present(t: dict) -> dict:
    return {"id": t["id"], "label": t.get("label"), "state": t["state"], "due_at": t["due_at"],
            "seconds_left": max(0, round(t["due_at"] - time.time()))}


async def _owned_active(user: dict, timer_id: str) -> dict:
    timer = await storage.get_checkin(timer_id)
    if not timer or timer["user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Not found")
    if timer["state"] != "ACTIVE":
        raise HTTPException(status_code=409, detail="This check-in is no longer running.")
    return timer


async def _open_alert(timer: dict, reason: str) -> dict:
    result = await storage.sync_alert(
        alert_id=str(uuid.uuid4()), user_id=timer["user_id"], trigger_type="CHECKIN_TIMEOUT",
        lat=timer.get("lat") or 0.0, lon=timer.get("lon") or 0.0, priority="HIGH", initial_state="ACTIVE",
    )
    await storage.update_checkin(timer["id"], state="EXPIRED", alert_id=result["alert"]["id"])
    logger.warning("Check-in %s: %s; alert %s opened", timer["id"], reason, result["alert"]["id"])
    return result["alert"]


@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def start_checkin(request: Request, payload: StartCheckinPayload, current_user: dict = Depends(get_current_user)):
    """Starts a timer (replacing any running one). Guardians are alerted if it runs out."""
    timer = await storage.create_checkin(current_user["user_id"], payload.label,
                                         time.time() + payload.minutes * 60, payload.lat, payload.lon)
    return {"status": "checkin_started", "checkin": _present(timer)}


@router.get("/active")
@limiter.limit("60/minute")
async def active_checkin(request: Request, current_user: dict = Depends(get_current_user)):
    timer = await storage.get_active_checkin(current_user["user_id"])
    return {"checkin": _present(timer) if timer else None}


@router.post("/{timer_id}/location")
@limiter.limit("30/minute")
async def update_location(request: Request, timer_id: str, payload: LocationPayload,
                          current_user: dict = Depends(get_current_user)):
    """Latest position, so an expired timer can tell guardians where to look."""
    timer = await _owned_active(current_user, timer_id)
    await storage.update_checkin(timer["id"], lat=payload.lat, lon=payload.lon)
    return {"status": "location_recorded"}


async def _pin_action(current_user: dict, timer: dict, pin: str, background: BackgroundTasks) -> bool:
    """True for the real PIN. Duress: opens the alert silently and still returns True to the caller's UI."""
    kind, failures = await check_sos_pin(current_user["user_id"], pin)
    if kind == "duress":
        alert = await _open_alert(timer, "duress PIN entered")
        background.add_task(notify_guardians_of_alert, alert)
        return False
    if kind is None:
        if failures == ESCALATE_AFTER_FAILURES:
            alert = await _open_alert(timer, f"{failures} wrong PINs")
            background.add_task(notify_guardians_of_alert, alert)
        raise HTTPException(status_code=403, detail="Incorrect PIN.")
    return True


@router.post("/{timer_id}/confirm")
@limiter.limit("20/minute")
async def confirm_safe(request: Request, timer_id: str, payload: PinPayload, background: BackgroundTasks,
                       current_user: dict = Depends(get_current_user)):
    """'I'm safe': stops the timer with the SOS PIN."""
    timer = await _owned_active(current_user, timer_id)
    if await _pin_action(current_user, timer, payload.pin, background):
        await storage.update_checkin(timer["id"], state="CONFIRMED")
    return {"status": "checkin_confirmed"}


@router.post("/{timer_id}/extend")
@limiter.limit("20/minute")
async def extend(request: Request, timer_id: str, payload: PinPayload, background: BackgroundTasks,
                 current_user: dict = Depends(get_current_user)):
    """Adds time with the SOS PIN (default 10 minutes)."""
    timer = await _owned_active(current_user, timer_id)
    minutes = payload.minutes or 10
    if await _pin_action(current_user, timer, payload.pin, background):
        timer = await storage.update_checkin(timer["id"], due_at=max(timer["due_at"], time.time()) + minutes * 60)
        return {"status": "checkin_extended", "checkin": _present(timer)}
    # Duress: answer as if extended
    return {"status": "checkin_extended", "checkin": {**_present(timer), "state": "ACTIVE",
                                                      "due_at": timer["due_at"] + minutes * 60}}


async def expire_overdue_checkins() -> int:
    """Called by the escalation sweep: every timer past due opens a CHECKIN_TIMEOUT alert."""
    expired = 0
    for timer in await storage.get_overdue_checkins():
        try:
            alert = await _open_alert(timer, "timer ran out")
            await notify_guardians_of_alert(alert)
            expired += 1
        except Exception:
            logger.exception("Could not expire check-in %s", timer["id"])
    return expired
