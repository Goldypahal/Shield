import hashlib
import hmac
import logging
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
import settings
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage, haversine_distance

logger = logging.getLogger("shield-ratings")

router = APIRouter(tags=["Ratings & Hazards"])

def pseudonym(purpose: str, user_id: str) -> str:
    """RATE-5: keyed pseudonym; without the server secret it cannot be linked back to a user id."""
    return hmac.new(settings.PSEUDONYM_SECRET.encode(), f"{purpose}:{user_id}".encode(), hashlib.sha256).hexdigest()[:16]


class WalkRatingPayload(BaseModel):
    walk_id: Optional[str] = Field(default=None, max_length=64)
    segment_id: str = Field(max_length=100)
    lit: bool
    busy: bool
    felt_safe: bool
    note: Optional[str] = Field(default=None, max_length=500)
    gps_coverage_ratio: Optional[float] = Field(default=1.0, ge=0, le=1)  # Mobile client computes GPS trace coverage (RATE-2)

class HazardReportPayload(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    category: Literal["broken_light", "harassment_spot", "blocked_path", "dark_alley", "unsafe_zone", "other"]
    description: Optional[str] = Field(default=None, max_length=500)
    photo_key: Optional[str] = Field(default=None, max_length=200)

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
    user_hash = pseudonym("rating", current_user["user_id"])

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
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
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
    user_hash = pseudonym("hazard", current_user["user_id"])

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
@limiter.limit("60/minute")
async def list_active_hazards(
    request: Request,
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lon: Optional[float] = Query(default=None, ge=-180, le=180),
    radius_km: float = Query(default=5.0, gt=0, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Active community hazard reports for the map, optionally within radius_km of lat/lon."""
    hazards = await storage.get_active_hazards()
    if lat is not None and lon is not None:
        hazards = [h for h in hazards if haversine_distance(lat, lon, h["lat"], h["lon"]) <= radius_km * 1000]
    for h in hazards:
        h.pop("user_hash", None)  # reporter pseudonym is not public
    return {"hazards": hazards}
