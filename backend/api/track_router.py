"""Guardian tracking links (no app or account needed).

A guardian's SMS carries /track/<token>. The token is random (192 bits), stored
only as a hash, expires after 24 h and is read-only. It shows the walker's first
name, the alert or walk state and the live trail while it is open; once closed,
the location is no longer shown.
"""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from rate_limiter import limiter
from db.storage import storage
from alert_states import OPEN
import police

router = APIRouter(tags=["Guardian tracking link"])

PAGE = os.path.join(os.path.dirname(__file__), "static", "track.html")
TRAIL_POINTS = 60


def _first_name(user: dict | None) -> str:
    return ((user or {}).get("name") or "SHIELD user").split()[0]


@router.get("/track/{token}", include_in_schema=False)
@limiter.limit("60/minute")
async def tracking_page(request: Request, token: str):
    # The page itself holds no data; it calls the JSON endpoint below with the token
    return FileResponse(PAGE, media_type="text/html", headers={
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",  # the token must not leak to the tile server
        "Content-Security-Policy": (
            "default-src 'none'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; "
            "img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"),
    })


@router.get("/track-assets/track.js", include_in_schema=False)
@limiter.limit("60/minute")
async def tracking_script(request: Request):
    return FileResponse(os.path.join(os.path.dirname(PAGE), "track.js"), media_type="text/javascript",
                        headers={"Cache-Control": "no-store"})


@router.get("/api/v1/track/{token}")
@limiter.limit("30/minute")
async def tracking_data(request: Request, token: str):
    link = await storage.resolve_share_link(token) if len(token) <= 64 else None
    if not link:
        raise HTTPException(status_code=404, detail="This link has expired or is not valid.")

    if link["kind"] == "alert":
        alert = await storage.get_alert_by_id(link["target_id"])
        if not alert:
            raise HTTPException(status_code=404, detail="This link has expired or is not valid.")
        is_open = alert["state"] in OPEN
        trail = await storage.get_alert_points(alert["id"], limit=TRAIL_POINTS) if is_open else []
        if is_open and alert.get("walk_id"):
            trail = (await storage.get_walk_trail(alert["walk_id"]))[-TRAIL_POINTS:]
        return {
            "kind": "alert",
            "name": _first_name(await storage.get_user_by_id(alert["user_id"])),
            "open": is_open,
            "state": alert["state"],
            "trigger": alert["trigger_type"],
            # Dispatcher progress, e.g. "Police unit PCR-12 is on the way, about 6 min away"
            "police": police.status_text(alert) if is_open else None,
            "started_at": alert.get("started_at"),
            "start": {"lat": alert["lat"], "lon": alert["lon"]} if is_open and (alert["lat"] or alert["lon"]) else None,
            "trail": [{"lat": p["lat"], "lon": p["lon"], "ts": p.get("ts")} for p in trail],
        }

    walk = await storage.get_walk(link["target_id"])
    if not walk:
        raise HTTPException(status_code=404, detail="This link has expired or is not valid.")
    is_open = walk["status"] == "ACTIVE"
    trail = (await storage.get_walk_trail(walk["id"]))[-TRAIL_POINTS:] if is_open else []
    return {
        "kind": "walk",
        "name": _first_name(await storage.get_user_by_id(walk["user_id"])),
        "open": is_open,
        "state": walk["status"],
        "mode": walk.get("mode") or "walk",
        "vehicle_plate": walk.get("vehicle_plate"),
        "destination": walk.get("destination_name"),
        "route": walk.get("route") if is_open else [],
        "trail": [{"lat": p["lat"], "lon": p["lon"], "ts": p.get("ts")} for p in trail],
    }
