"""
All-India navigation: place search and route planning with a safety score per route.

GET  /api/v1/nav/capabilities   which provider is active and which travel modes it supports
GET  /api/v1/nav/search         places anywhere in India (autocomplete)
GET  /api/v1/nav/place/{id}     coordinates for a Google place suggestion
GET  /api/v1/nav/reverse        address for a coordinate
POST /api/v1/nav/plan           every route alternative, each scored for safety, with
                                safest / shortest / fastest badges and 24x7 places on the way
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from db.storage import storage
from nav_geo import haversine
from nav_providers import (MODES, GooglePlacesSearch, ProviderError, google_key, routing_provider,
                           search_provider)
from nav_safety import HAZARD_WEIGHT, analysed_parts, assign_badges, fetch_osm, period_for, score_route
from rate_limiter import limiter
from security import get_current_user

logger = logging.getLogger("shield-nav-router")
router = APIRouter(prefix="/api/v1/nav", tags=["All-India navigation"])

IST = timezone(timedelta(hours=5, minutes=30))
HAZARD_DAYS = 30
MAX_TRIP_M = 3_500_000  # Kashmir to Kanyakumari is about 3,700 km by road


class Point(BaseModel):
    lat: float = Field(ge=6.0, le=37.5)
    lon: float = Field(ge=68.0, le=97.6)


class PlanRequest(BaseModel):
    origin: Point
    destination: Point
    mode: Literal["walk", "bicycle", "two_wheeler", "car", "transit"] = "walk"
    depart_at: Optional[str] = None  # ISO time; defaults to now (IST)
    language: str = Field(default="en", max_length=8)


@router.get("/capabilities")
async def capabilities(current_user: dict = Depends(get_current_user)):
    rp = routing_provider()
    return {
        "provider": rp.name,
        "modes": list(rp.modes),
        "all_modes": list(MODES),
        "search": search_provider().name,
        "two_wheeler_uses_car_profile": rp.name != "google",
        "attribution": "Google" if rp.name == "google" else "© OpenStreetMap contributors",
    }


@router.get("/search")
@limiter.limit("60/minute")
async def search_places(request: Request, q: str = Query(..., min_length=2, max_length=120),
                        lat: Optional[float] = None, lon: Optional[float] = None, language: str = "en",
                        current_user: dict = Depends(get_current_user)):
    try:
        places = await search_provider().search(q, (lat, lon) if lat is not None and lon is not None else None, language)
    except ProviderError as e:
        logger.warning("Place search failed: %s", e)
        raise HTTPException(status_code=503, detail="Place search is unavailable right now.")
    return {"places": [p.__dict__ for p in places]}


@router.get("/place/{place_id}")
@limiter.limit("60/minute")
async def place_details(request: Request, place_id: str, current_user: dict = Depends(get_current_user)):
    sp = search_provider()
    if not isinstance(sp, GooglePlacesSearch):
        raise HTTPException(status_code=404, detail="Place details need Google Places.")
    place = await sp.details(place_id)
    if not place:
        raise HTTPException(status_code=404, detail="Place not found.")
    return place.__dict__


@router.get("/reverse")
@limiter.limit("60/minute")
async def reverse(request: Request, lat: float, lon: float, current_user: dict = Depends(get_current_user)):
    try:
        place = await search_provider().reverse((lat, lon))
    except ProviderError:
        place = None
    return {"place": place.__dict__ if place else None}


async def _incidents(period: str) -> List[dict]:
    out = []
    for h in await storage.get_recent_hazards(HAZARD_DAYS):
        out.append({"lat": h["lat"], "lon": h["lon"], "category": h.get("category", "other"),
                    "weight": HAZARD_WEIGHT.get(h.get("category"), 0.3), "radius_m": 75.0, "public": True})
    for s in await storage.get_active_hotspots():
        if s.get("period", "any") not in ("any", period):
            continue
        out.append({"lat": s["lat"], "lon": s["lon"], "category": "police_hotspot",
                    "weight": float(s.get("weight", 1.0)), "radius_m": float(s.get("radius_m", 150.0)),
                    "public": False})  # police hotspot locations are never sent to the phone
    return out


@router.post("/plan")
@limiter.limit("20/minute")
async def plan(request: Request, payload: PlanRequest, current_user: dict = Depends(get_current_user)):
    origin = (payload.origin.lat, payload.origin.lon)
    dest = (payload.destination.lat, payload.destination.lon)
    if haversine(origin, dest) < 20:
        raise HTTPException(status_code=400, detail="Start and destination are the same place.")

    rp = routing_provider()
    if payload.mode not in rp.modes:
        raise HTTPException(status_code=400, detail=f"'{payload.mode}' routes need Google Maps, which is not set up.")

    when = datetime.now(IST)
    if payload.depart_at:
        try:
            when = datetime.fromisoformat(payload.depart_at).astimezone(IST)
        except ValueError:
            pass
    period = period_for(when.hour + when.minute / 60)

    try:
        options = await rp.routes(origin, dest, payload.mode, payload.language)
    except ProviderError as e:
        logger.warning("Routing failed: %s", e)
        raise HTTPException(status_code=503, detail="The routing service is unavailable right now.")
    options = [o for o in options if o.distance_m <= MAX_TRIP_M][:4]
    if not options:
        return {"routes": [], "provider": rp.name, "period": period, "mode": payload.mode}

    incidents = await _incidents(period)
    osm_data = await asyncio.gather(*(fetch_osm(analysed_parts(o.coords, o.distance_m)) for o in options))

    routes = []
    for i, (opt, osm) in enumerate(zip(options, osm_data)):
        routes.append({
            "id": f"r{i}",
            "coords": [[round(lat, 6), round(lon, 6)] for lat, lon in opt.coords],
            "distance_m": round(opt.distance_m),
            "duration_s": round(opt.duration_s),
            "duration_note": opt.duration_note,
            "summary": opt.summary,
            "steps": [s.__dict__ for s in opt.steps],
            "safety": score_route(opt.coords, opt.distance_m, osm, incidents, period),
        })
    assign_badges(routes)
    return {
        "routes": routes,
        "provider": rp.name,
        "period": period,
        "mode": payload.mode,
        "attribution": "Google" if rp.name == "google" else "© OpenStreetMap contributors",
    }
