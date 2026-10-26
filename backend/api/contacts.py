import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from auth import PHONE_PATTERN
from rate_limiter import limiter
from security import get_current_user
from db.storage import storage

logger = logging.getLogger("shield-guardians")

router = APIRouter(tags=["Guardians & Contacts"])


class GuardianPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=80)
    # `phone_number` is accepted for the mobile app's contact screen
    phone: str = Field(alias="phone_number", pattern=PHONE_PATTERN)
    priority: Optional[int] = Field(default=1, ge=1, le=5)
    public_key: Optional[str] = Field(default=None, max_length=4096)


def _present(g: dict) -> dict:
    return {**g, "phone_number": g["phone"], "verified": bool(g.get("verified"))}


@router.get("/api/v1/guardians")
@router.get("/api/v1/contacts")
@limiter.limit("30/minute")
async def list_guardians(request: Request, current_user: dict = Depends(get_current_user)):
    """GRD-1: Up to 5 guardians in priority order with key fingerprints (GRD-3)."""
    guardians = [_present(g) for g in await storage.get_guardians(current_user["user_id"])]
    return {"guardians": guardians, "contacts": guardians}


@router.post("/api/v1/guardians", status_code=status.HTTP_201_CREATED)
@router.post("/api/v1/contacts", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def add_guardian(request: Request, payload: GuardianPayload, current_user: dict = Depends(get_current_user)):
    """GRD-1: Adds a guardian (max 5). They get live access only after accepting (GRD-2)."""
    if payload.phone == current_user["phone_number"]:
        raise HTTPException(status_code=400, detail="You cannot add yourself as a guardian.")
    try:
        guardian = await storage.add_or_update_guardian(
            user_id=current_user["user_id"], name=payload.name, phone=payload.phone,
            priority=payload.priority or 1, public_key=payload.public_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    guardian = _present(guardian)
    return {"status": "guardian_added", "guardian": guardian, "contact": guardian}


@router.post("/api/v1/guardians/{guardian_id}/verify")
@limiter.limit("20/minute")
async def verify_guardian(request: Request, guardian_id: str, current_user: dict = Depends(get_current_user)):
    """
    GRD-2: The invited person accepts, from their own account. Only the phone
    number the walker entered can accept, so an invite link alone grants nothing.
    """
    if not current_user.get("phone_verified") or not await storage.verify_guardian(guardian_id, current_user["phone_number"]):
        raise HTTPException(status_code=404, detail="Invitation not found for this account.")
    return {"status": "verified", "guardian_id": guardian_id}


@router.delete("/api/v1/guardians/{guardian_id}")
@router.delete("/api/v1/contacts/{guardian_id}")
@limiter.limit("20/minute")
async def delete_guardian(request: Request, guardian_id: str, current_user: dict = Depends(get_current_user)):
    if not await storage.delete_guardian(guardian_id, current_user["user_id"]):
        raise HTTPException(status_code=404, detail="Guardian not found")
    return {"status": "deleted", "guardian_id": guardian_id}
