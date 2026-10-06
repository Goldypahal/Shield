import hashlib
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-ratings")

router = APIRouter(tags=["Ratings & Hazards"])

class WalkRatingPayload(BaseModel):
    walk_id: Optional[str] = None
    segment_id: str
    lit: bool
    busy: bool
    felt_safe: bool
    note: Optional[str] = None
    gps_coverage_ratio: Optional[float] = 1.0  # Mobile client computes GPS trace coverage (RATE-2)

class HazardReportPayload(BaseModel):
    lat: float
    lon: float
    category: str  # broken_light, harassment_spot, blocked_path, dark_alley, other
    description: Optional[str] = None
    photo_key: Optional[str] = None

@router.post("/api/v1/ratings", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def submit_rating(
    request: Request,
    payload: WalkRatingPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    RATE-1, RATE-2, RATE-3:
    Submits walk rating. Validates GPS trace >= 70% coverage.
    Applies anti-spam and Bayesian consensus update on segment score.
    """
    # RATE-2: GPS coverage check
    if payload.gps_coverage_ratio is not None and payload.gps_coverage_ratio < 0.70:
        raise HTTPException(
            status_code=400,
            detail="RATE-2: Rating rejected. GPS trace must cover at least 70% of the rated segment."
        )

    # RATE-5: Anonymise user ID with salt before storing
    user_id = str(current_user["user_id"])
    user_hash = hashlib.sha256(f"salt_{user_id}".encode()).hexdigest()[:16]

    try:
        result = await storage.add_rating(
            segment_id=payload.segment_id,
            user_hash=user_hash,
            lit=payload.lit,
            busy=payload.busy,
            felt_safe=payload.felt_safe,
            walk_id=payload.walk_id,
            note=payload.note
        )
    except ValueError as e:
        raise HTTPException(status_code=429 if "limit" in str(e).lower() else 400, detail=str(e))

    return {
        "status": "rating_accepted",
        "result": result,
        "message": "Thank you! Your feedback improves route safety scores for everyone."
    }

@router.post("/api/v1/hazards", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def report_hazard(
    request: Request,
    payload: HazardReportPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    RATE-4: Report hazard (broken light, harassment spot, blocked path) with pin coordinates.
    """
    user_id = str(current_user["user_id"])
    user_hash = hashlib.sha256(f"hazard_salt_{user_id}".encode()).hexdigest()[:16]

    hazard = await storage.add_hazard(
        lat=payload.lat,
        lon=payload.lon,
        category=payload.category,
        description=payload.description,
        user_hash=user_hash,
        photo_key=payload.photo_key
    )

    return {
        "status": "hazard_reported",
        "hazard": hazard,
        "message": "Hazard reported. Sent to authority dashboard for city/campus review."
    }

@router.get("/api/v1/hazards")
async def list_active_hazards(
    request: Request
):
    """Returns active hazards for map rendering (anonymized)."""
    hazards = await storage.get_active_hazards()
    return {"hazards": hazards}
