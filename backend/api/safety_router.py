"""Safe havens: places to walk to when something feels wrong.

Police posts, hospitals, pharmacies and fuel stations from OpenStreetMap
(backend/routing/data/safe_havens.json, refreshed with backend/routing/fetch_safe_havens.py).
Police posts and hospitals are treated as always staffed; other places are marked
24/7 only when OSM says opening_hours=24/7.
"""
import json
import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request

from rate_limiter import limiter
from security import get_current_user
from db.storage import haversine_distance

router = APIRouter(prefix="/api/v1/safe-havens", tags=["Safe havens"])

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "routing", "data", "safe_havens.json")
try:
    with open(DATA_PATH, encoding="utf-8") as f:
        _DOC = json.load(f)
except OSError:
    _DOC = {"source": "", "places": []}
PLACES = _DOC["places"]

Kind = Literal["police", "hospital", "pharmacy", "fuel"]


@router.get("")
@limiter.limit("60/minute")
async def nearby_havens(
    request: Request,
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    radius_km: float = Query(default=3.0, gt=0, le=15),
    kind: Optional[list[Kind]] = Query(default=None),
    open_now_only: bool = Query(default=False, description="Only places known to be open 24/7"),
    limit: int = Query(default=25, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Nearest safe havens to a point, closest first."""
    found = []
    for p in PLACES:
        if kind and p["kind"] not in kind:
            continue
        if open_now_only and not p.get("open_24_7"):
            continue
        d = haversine_distance(lat, lon, p["lat"], p["lon"])
        if d <= radius_km * 1000:
            found.append({**p, "distance_m": round(d)})
    found.sort(key=lambda p: p["distance_m"])
    return {"source": _DOC.get("source"), "places": found[:limit]}
