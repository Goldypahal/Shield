"""SOS PIN checks shared by every place that can stop or confirm an alert.

The PIN is the only way to stand an SOS down. Wrong guesses are counted per
account: after a few, the open alert is escalated (someone may be trying to
silence it) and the PIN locks for a while, so a 4-digit PIN cannot be brute-forced.
"""
import time
from typing import Literal

from fastapi import HTTPException

from db.storage import storage
from security import verify_password

PIN_PATTERN = r"^\d{4,6}$"
ESCALATE_AFTER_FAILURES = 3
LOCK_AFTER_FAILURES = 5
LOCK_SECONDS = 15 * 60

PinKind = Literal["normal", "duress"]


async def check_sos_pin(user_id: str, pin: str) -> tuple[PinKind | None, int]:
    """
    Returns ("normal" | "duress", 0) on a correct PIN, or (None, failures) on a wrong one.
    Raises 423 while the PIN is locked. Callers decide what a duress PIN does in their context.
    """
    user = await storage.get_user_by_id(user_id)
    if (user.get("pin_locked_until") or 0) > time.time():
        raise HTTPException(status_code=423, detail="Too many wrong PINs. The alert stays active; try again later.")
    kind: PinKind | None = None
    if user.get("duress_pin") and verify_password(pin, user["duress_pin"]):
        kind = "duress"
    elif verify_password(pin, user["hashed_pin"]):
        kind = "normal"
    failures = await storage.record_pin_result(user_id, success=kind is not None,
                                               lock_after=LOCK_AFTER_FAILURES, lock_seconds=LOCK_SECONDS)
    return kind, failures
