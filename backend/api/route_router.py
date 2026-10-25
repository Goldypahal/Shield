import os
import sys
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from security import get_current_user
from rate_limiter import limiter
from route_scoring import route_scoring_service

logger = logging.getLogger("shield-route-router")

router = APIRouter(prefix="/api/v1/routes", tags=["Safe Route Planning"])

# Wire Heimdal SafeRoute Tricity engine if available
TRICITY_ROUTER = None
try:
    routing_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "routing"))
    if routing_dir not in sys.path:
        sys.path.insert(0, routing_dir)
    from heimdal_routing.engine import SafetyGraph, SafeRouter
    graph_path = os.path.join(routing_dir, "data", "tricity_graph.json")
    if os.path.exists(graph_path):
        _graph = SafetyGraph.load(graph_path)
        TRICITY_ROUTER = SafeRouter(_graph)
        logger.info("Successfully loaded Tricity SafetyGraph (%d nodes, %d edges)", len(_graph.nodes), len(_graph.edges))
except Exception as e:
    logger.warning("Tricity SafeRouter initialization skipped: %s", e)

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

@router.get("/tricity/plan")
@limiter.limit("30/minute")
async def plan_tricity_route(
    request: Request,
    origin: str = Query(..., description="lat,lon or Landmark name (e.g. 'ISBT 43' or '30.7333,76.7794')"),
    destination: str = Query(..., description="lat,lon or Landmark name (e.g. 'Elante Mall' or '30.7056,76.8013')"),
    hour: float = Query(22.0, ge=0.0, lt=24.0, description="Hour of the day in 24h format (e.g. 22.5)"),
    mode: str = Query("walk", pattern="^(walk|drive)$"),
    max_detour: float = Query(1.5, ge=1.0, le=3.0),
    include_segments: bool = Query(True),
    current_user: dict = Depends(get_current_user)
):
    """
    Heimdal SafeRoute Tricity Routing Engine:
    Computes Fastest, Safest, and Balanced routes across Chandigarh, Mohali, Panchkula & Zirakpur
    with lighting, police proximity, footfall, and safety score explanations.
    """
    if TRICITY_ROUTER is None:
        raise HTTPException(
            status_code=503,
            detail="Tricity SafetyGraph engine is not available in the current environment."
        )

    def _resolve_point(s: str) -> tuple[float, float]:
        try:
            parts = s.split(",")
            return float(parts[0]), float(parts[1])
        except (ValueError, IndexError):
            try:
                return TRICITY_ROUTER.g.find_place(s)
            except KeyError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

    pt_orig = _resolve_point(origin)
    pt_dest = _resolve_point(destination)

    try:
        plan = TRICITY_ROUTER.plan(pt_orig, pt_dest, hour=hour, mode=mode, max_detour=max_detour)
        if not include_segments:
            for rt in plan.get("routes", {}).values():
                rt.pop("segments", None)
        return {
            "status": "success",
            "plan": plan
        }
    except Exception as e:
        logger.error("Tricity routing error: %s", e)
        raise HTTPException(status_code=422, detail=f"Routing failure: {str(e)}")

@router.get("/tricity/landmarks")
@limiter.limit("60/minute")
async def get_tricity_landmarks(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """Returns available landmarks and anchor points in the Tricity graph."""
    if TRICITY_ROUTER is None:
        return {"landmarks": []}
    
    landmarks = [
        {"name": name, "lat": coord[0], "lon": coord[1]}
        for name, coord in TRICITY_ROUTER.g.landmarks.items()
    ]
    return {
        "count": len(landmarks),
        "landmarks": landmarks
    }
