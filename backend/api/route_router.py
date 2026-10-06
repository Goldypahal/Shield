import logging
from datetime import datetime
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from security import get_current_user
from rate_limiter import limiter
from route_scoring import route_scoring_service

logger = logging.getLogger("shield-route-router")

router = APIRouter(prefix="/api/v1/routes", tags=["Safe Route Planning"])

class LocationCoord(BaseModel):
    lat: float
    lon: float

class RouteComparePayload(BaseModel):
    origin: LocationCoord
    destination: LocationCoord
    walk_time: Optional[str] = None # ISO format or None

@router.post("/compare")
@limiter.limit("30/minute")
async def compare_routes(
    request: Request,
    payload: RouteComparePayload,
    current_user: dict = Depends(get_current_user)
):
    """
    ROUTE-1 to ROUTE-6, ROUTE-8:
    Compares 2-3 walking route alternatives, computes Safety Score per segment and route
    using Section 6.1 model with time-of-day weights, identifies Safe Stops, and flags caution segments.
    """
    parsed_time = None
    if payload.walk_time:
        try:
            parsed_time = datetime.fromisoformat(payload.walk_time)
        except Exception:
            parsed_time = datetime.now()
    else:
        parsed_time = datetime.now()

    result = await route_scoring_service.compare_routes(
        origin_lat=payload.origin.lat,
        origin_lon=payload.origin.lon,
        dest_lat=payload.destination.lat,
        dest_lon=payload.destination.lon,
        walk_time=parsed_time
    )

    return result
