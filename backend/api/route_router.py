import os
import sys
import math
import time
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from security import get_current_user
from rate_limiter import limiter
from route_scoring import route_scoring_service
from db.storage import storage

logger = logging.getLogger("shield-route-router")

router = APIRouter(prefix="/api/v1/routes", tags=["Safe Route Planning"])

# Wire Heimdal SafeRoute Tricity engine if available
TRICITY_ROUTER = None
try:
    routing_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "routing"))
    if routing_dir not in sys.path:
        sys.path.insert(0, routing_dir)
    from heimdal_routing.engine import SafetyGraph, SafeRouter, RiskModel
    # The bundled graph is a synthetic 400 m lattice, so drawn routes cut across real blocks.
    # Point SHIELD_ROUTING_GRAPH at a real-OSM build (python -m heimdal_routing osm ...) for
    # routes that follow actual streets on the map.
    graph_path = os.getenv("SHIELD_ROUTING_GRAPH") or os.path.join(routing_dir, "data", "tricity_graph.json")
    if os.path.exists(graph_path):
        _graph = SafetyGraph.load(graph_path)
        TRICITY_ROUTER = SafeRouter(_graph)
        logger.info("Successfully loaded Tricity SafetyGraph (%d nodes, %d edges)", len(_graph.nodes), len(_graph.edges))
except Exception as e:
    logger.warning("Tricity SafeRouter initialization skipped: %s", e)

# Community hazard reports (RATE-4) raise the risk of street segments within HAZARD_RADIUS_M
# for HAZARD_DAYS days. "blocked_path" is strong enough that routes go around it.
HAZARD_DAYS = 30
HAZARD_RADIUS_M = 75.0
HAZARD_PENALTY = {"blocked_path": 0.35, "harassment_spot": 0.25, "unsafe_zone": 0.2,
                  "dark_alley": 0.15, "broken_light": 0.1, "other": 0.05}
MAX_HAZARD_PENALTY = 0.45


async def hazard_penalties() -> tuple[dict[int, float], list[dict]]:
    """Per-edge added risk from recent reports, and the reports that were used."""
    penalties: dict[int, float] = {}
    used = []
    for h in await storage.get_recent_hazards(HAZARD_DAYS):
        edges = TRICITY_ROUTER.g.edges_near(h["lat"], h["lon"], HAZARD_RADIUS_M)
        if not edges:
            continue
        used.append({"lat": h["lat"], "lon": h["lon"], "category": h["category"], "reported_at": h.get("ts")})
        for k in edges:
            penalties[k] = min(MAX_HAZARD_PENALTY, penalties.get(k, 0.0) + HAZARD_PENALTY.get(h["category"], 0.05))
    return penalties, used


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

    penalties, reports = await hazard_penalties()
    try:
        plan = TRICITY_ROUTER.plan(pt_orig, pt_dest, hour=hour, mode=mode, max_detour=max_detour,
                                   edge_penalties=penalties)
        plan["community_reports"] = reports
        if not include_segments:
            for rt in plan.get("routes", {}).values():
                rt.pop("segments", None)
        return {
            "status": "success",
            "plan": plan
        }
    except Exception:
        logger.exception("Tricity routing error for %s -> %s", pt_orig, pt_dest)
        raise HTTPException(status_code=422, detail="No route could be planned between these points.")

@router.get("/tricity/landmarks")
@limiter.limit("60/minute")
async def get_tricity_landmarks(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """Returns available landmarks and anchor points in the Tricity graph."""
    if TRICITY_ROUTER is None:
        return {"landmarks": []}
    
    # landmarks is a list of {"name", "lat", "lon", "kind"} records
    landmarks = [
        {"name": lm["name"], "lat": lm["lat"], "lon": lm["lon"], "kind": lm.get("kind")}
        for lm in TRICITY_ROUTER.g.landmarks
    ]
    return {
        "count": len(landmarks),
        "landmarks": landmarks
    }


_heatmap_cache: dict[tuple[float, str], tuple[float, dict]] = {}
HEATMAP_CELL_DEG = 0.004  # about 440 m north-south, 380 m east-west at 30.7 N
HEATMAP_TTL_SECONDS = 600


@router.get("/tricity/heatmap")
@limiter.limit("30/minute")
async def safety_heatmap(
    request: Request,
    hour: float = Query(22.0, ge=0.0, lt=24.0),
    mode: str = Query("walk", pattern="^(walk|drive)$"),
    current_user: dict = Depends(get_current_user),
):
    """
    Night heatmap: length-weighted mean segment risk per ~400 m cell at a given hour,
    so people can see how the same streets change from day to night and pick a time
    as well as a route. Includes recent community reports. Values are relative (0-1).
    """
    if TRICITY_ROUTER is None:
        raise HTTPException(status_code=503, detail="Tricity SafetyGraph engine is not available.")
    hour = round(hour * 2) / 2
    key = (hour, mode)
    hit = _heatmap_cache.get(key)
    if hit and time.time() - hit[0] < HEATMAP_TTL_SECONDS:
        return hit[1]

    g = TRICITY_ROUTER.g
    penalties, _ = await hazard_penalties()
    model = RiskModel(g, mode, edge_penalties=penalties)
    cells: dict[tuple[int, int], list[float]] = {}
    for k, e in enumerate(g.edges):
        if mode == "drive" and e["cls"] == "park_path":
            continue
        lat = (g.lat[e["u"]] + g.lat[e["v"]]) / 2
        lon = (g.lon[e["u"]] + g.lon[e["v"]]) / 2
        cell = (math.floor(lat / HEATMAP_CELL_DEG), math.floor(lon / HEATMAP_CELL_DEG))
        acc = cells.setdefault(cell, [0.0, 0.0, 0.0])
        er = model.edge_risk(k, hour)
        acc[0] += er.risk * e["length_m"]
        acc[1] += e["length_m"]
        acc[2] += e["length_m"] if er.isolated else 0.0
    body = {
        "hour": hour,
        "mode": mode,
        "cell_deg": HEATMAP_CELL_DEG,
        "synthetic": bool(g.meta.get("synthetic")),
        "cells": [
            {"lat": round((i + 0.5) * HEATMAP_CELL_DEG, 5), "lon": round((j + 0.5) * HEATMAP_CELL_DEG, 5),
             "risk": round(r / L, 3), "isolated_share": round(iso / L, 2)}
            for (i, j), (r, L, iso) in cells.items() if L > 0
        ],
    }
    _heatmap_cache[key] = (time.time(), body)
    return body
