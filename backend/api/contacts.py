import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from rate_limiter import limiter
from security import get_current_user
from db.storage import storage

logger = logging.getLogger("shield-guardians")

router = APIRouter(tags=["Guardians & Contacts"])

class GuardianPayload(BaseModel):
    name: str
    phone: str
    priority: Optional[int] = 1
    public_key: Optional[str] = None

@router.get("/api/v1/guardians")
@router.get("/api/v1/contacts")
@limiter.limit("30/minute")
async def list_guardians(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """
    GRD-1: List up to 5 guardians in priority order with key fingerprints (GRD-3).
    """
    user_id = str(current_user["user_id"])
    guardians = await storage.get_guardians(user_id)
    return {"guardians": guardians, "contacts": guardians}

@router.post("/api/v1/guardians", status_code=status.HTTP_201_CREATED)
@router.post("/api/v1/contacts", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def add_guardian(
    request: Request,
    payload: GuardianPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    GRD-1: Add guardian with name, phone, priority order (up to 5 max).
    Generates out-of-band key fingerprint QR (GRD-3).
    """
    user_id = str(current_user["user_id"])
    try:
        guardian = await storage.add_or_update_guardian(
            user_id=user_id,
            name=payload.name,
            phone=payload.phone,
            priority=payload.priority or 1,
            public_key=payload.public_key
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "status": "guardian_added",
        "guardian": guardian,
        "contact": guardian,
        "invitation_link": f"https://shield.app/invite/{guardian['id']}"
    }

@router.post("/api/v1/guardians/{guardian_id}/verify")
@limiter.limit("20/minute")
async def verify_guardian(
    request: Request,
    guardian_id: str
):
    """
    GRD-2: Guardian accepts SMS link invitation, enabling live tracking access.
    """
    success = await storage.verify_guardian(guardian_id)
    return {
        "status": "verified" if success else "failed",
        "guardian_id": guardian_id,
        "message": "Guardian verified. Live tracking enabled for shared walks."
    }

@router.delete("/api/v1/guardians/{guardian_id}")
@router.delete("/api/v1/contacts/{guardian_id}")
@limiter.limit("20/minute")
async def delete_guardian(
    request: Request,
    guardian_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Remove guardian."""
    user_id = str(current_user["user_id"])
    deleted = await storage.delete_guardian(guardian_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Guardian not found")
    return {"status": "deleted", "guardian_id": guardian_id}
