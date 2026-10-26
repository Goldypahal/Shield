"""Police-facing and walker-facing endpoints of the police integration (see police.py)."""
import csv
import io
import json
import math
from collections import Counter
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field

import police
import settings
from access import alert_for_owner, alert_for_viewer
from notifier import notify_guardians_of_alert
from pins import PIN_PATTERN, check_sos_pin
from rate_limiter import limiter
from security import get_current_user, require_roles, STAFF_ROLES
from db.storage import storage, haversine_distance

router = APIRouter(tags=["Police integration"])
staff = require_roles(*STAFF_ROLES)

HELPLINES = [
    {"number": "112", "label": "Emergency (police, fire, ambulance)"},
    {"number": "1091", "label": "Women helpline (police)"},
    {"number": "181", "label": "Women helpline (support)"},
]


def _actor(user: dict) -> str:
    return f"{user['role']}:{user['user_id']}"


# --- Dispatcher actions ------------------------------------------------------

class PoliceStatusPayload(BaseModel):
    status: Literal["ACKNOWLEDGED", "UNIT_ASSIGNED", "EN_ROUTE", "ON_SCENE", "CLOSED_SAFE"]
    unit: Optional[str] = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9 /-]+$")
    eta_minutes: Optional[int] = Field(default=None, ge=0, le=180)
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("/api/v1/dashboard/alerts/{alert_id}/police-status")
@limiter.limit("60/minute")
async def update_police_status(request: Request, alert_id: str, payload: PoliceStatusPayload,
                               current_user: dict = Depends(staff)):
    """Dispatcher progress (acknowledged, unit assigned, en route, on scene, closed); the walker and guardians see it."""
    alert = await alert_for_viewer(current_user, alert_id)
    if alert.get("location_withheld"):
        raise HTTPException(status_code=409, detail="This alert is already closed.")
    await storage.log_audit(_actor(current_user), f"POLICE_STATUS {payload.status}", f"alert/{alert_id}")
    updated = await police.set_police_status(alert, payload.status, _actor(current_user), payload.unit,
                                             payload.eta_minutes, payload.note)
    return {"status": "updated", "alert": {k: updated.get(k) for k in
                                           ("id", "state", "police_status", "police_unit", "police_eta_min")}}


@router.get("/api/v1/dashboard/alerts/{alert_id}/fir-bundle")
@limiter.limit("10/minute")
async def fir_bundle(request: Request, alert_id: str, current_user: dict = Depends(staff)):
    """
    Evidence package for an FIR: summary, timeline, location trail and the evidence hash chain.
    Only with the walker's explicit FIR consent (audio stays end-to-end encrypted; the walker shares keys separately).
    """
    alert = await alert_for_viewer(current_user, alert_id)
    if not alert.get("fir_consent_at"):
        raise HTTPException(status_code=403, detail="The walker has not consented to share this incident for an FIR.")
    await storage.log_audit(_actor(current_user), "EXPORT_FIR_BUNDLE", f"alert/{alert_id}")
    walker = await storage.get_user_by_id(alert["user_id"])
    trail = await storage.get_walk_trail(alert["walk_id"]) if alert.get("walk_id") else await storage.get_alert_points(alert_id, limit=5000)
    chunks = await storage.get_evidence_chunks(alert_id)
    prev, intact = "0" * 64, True
    for i, c in enumerate(chunks):
        if c["seq"] != i or c["prev_sha256"] != prev:
            intact = False
            break
        prev = c["sha256"]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "consent": {"fir_consent_at": alert["fir_consent_at"]},
        "complainant": {"name": walker.get("name"), "phone": walker.get("phone_number")} if walker else None,
        "incident": {k: alert.get(k) for k in ("id", "trigger_type", "priority", "state", "lat", "lon", "started_at",
                                               "resolved_at", "erss_incident_id", "police_unit")},
        "timeline": [{"ts": e.get("ts"), "event": e.get("event_type"), "actor": e.get("actor")} for e in alert.get("events", [])],
        "location_trail": [{"ts": p.get("ts"), "lat": p["lat"], "lon": p["lon"], "accuracy_m": p.get("accuracy")} for p in trail],
        "evidence": {"chunks": len(chunks), "hash_chain_intact": intact,
                     "chain": [{"seq": c["seq"], "sha256": c["sha256"], "prev_sha256": c["prev_sha256"]} for c in chunks],
                     "note": "Audio is AES-256-GCM encrypted on the walker's phone; SHIELD cannot decrypt it."},
        "pdf_report": f"/api/v1/reports/incident/{alert_id}/pdf",
    }


# --- Stations, patrol units, police data --------------------------------------

@router.get("/api/v1/dashboard/stations")
@limiter.limit("30/minute")
async def list_stations(request: Request, current_user: dict = Depends(staff)):
    return {"stations": await storage.list_stations(), "your_station_id": current_user.get("station_id")}


class PatrolPositionPayload(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    available: bool = True


@router.post("/api/v1/dashboard/patrol-units/{call_sign}/position")
@limiter.limit("120/minute")
async def patrol_position(request: Request, payload: PatrolPositionPayload,
                          call_sign: str = Path(pattern=r"^[A-Za-z0-9-]{2,20}$"), current_user: dict = Depends(staff)):
    """PCR van position from the station or the van's tablet. Never shown to the public, only distances."""
    existing = await storage.get_patrol_unit(call_sign)
    if existing and current_user.get("station_id") and existing.get("station_id") not in (None, current_user["station_id"]):
        raise HTTPException(status_code=403, detail="This unit belongs to another station.")
    await storage.upsert_patrol_unit(call_sign, current_user.get("station_id") or (existing or {}).get("station_id"),
                                     payload.lat, payload.lon, payload.available)
    return {"status": "position_recorded"}


class Hotspot(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radius_m: float = Field(default=150, ge=25, le=1000)
    weight: float = Field(default=0.5, ge=0, le=1)
    period: Literal["day", "evening", "night", "any"] = "any"


class HotspotsPayload(BaseModel):
    hotspots: List[Hotspot] = Field(min_length=1, max_length=1000)
    valid_days: int = Field(default=30, ge=1, le=180)


@router.post("/api/v1/dashboard/police-data/hotspots")
@limiter.limit("10/minute")
async def upload_hotspots(request: Request, payload: HotspotsPayload, current_user: dict = Depends(staff)):
    """Anonymised crime hotspots from the police; safer routes avoid them (aggregate locations only, no case data)."""
    n = await storage.add_hotspots([h.model_dump() for h in payload.hotspots], _actor(current_user), payload.valid_days * 86400)
    await storage.log_audit(_actor(current_user), f"UPLOAD_HOTSPOTS n={n}", "police-data/hotspots")
    return {"status": "hotspots_saved", "count": n}


CELL_DEG = 0.004
K_ANONYMITY = 3  # a cell is shared only when at least this many reports fall in it


@router.get("/api/v1/dashboard/exports/hazards")
@limiter.limit("10/minute")
async def export_hazards(request: Request, days: int = Query(30, ge=1, le=365), format: str = Query("json", pattern="^(json|csv)$"),
                         current_user: dict = Depends(staff)):
    """Community reports for patrol planning: counted per ~400 m cell, no reporter data, small cells suppressed."""
    await storage.log_audit(_actor(current_user), "EXPORT_HAZARDS", "exports/hazards")
    cells: dict = {}
    for h in await storage.get_recent_hazards(days):
        key = (math.floor(h["lat"] / CELL_DEG), math.floor(h["lon"] / CELL_DEG))
        cells.setdefault(key, Counter())[h["category"]] += 1
    rows = [{"lat": round((i + 0.5) * CELL_DEG, 5), "lon": round((j + 0.5) * CELL_DEG, 5), "reports": sum(c.values()), **c}
            for (i, j), c in cells.items() if sum(c.values()) >= K_ANONYMITY]
    rows.sort(key=lambda r: -r["reports"])
    if format == "csv":
        cats = ["broken_light", "dark_alley", "harassment_spot", "unsafe_zone", "blocked_path", "other"]
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["lat", "lon", "reports", *cats])
        for r in rows:
            w.writerow([r["lat"], r["lon"], r["reports"], *[r.get(c, 0) for c in cats]])
        return Response(out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=shield_hazard_cells.csv"})
    return {"days": days, "cell_deg": CELL_DEG, "min_reports_per_cell": K_ANONYMITY, "cells": rows}


@router.get("/api/v1/dashboard/exports/dark-streets")
@limiter.limit("10/minute")
async def export_dark_streets(request: Request, limit: int = Query(100, ge=1, le=1000), current_user: dict = Depends(staff)):
    """Streets that are dark and empty at night (routing engine), for patrols and lighting repairs."""
    import route_router
    if route_router.TRICITY_ROUTER is None:
        raise HTTPException(status_code=503, detail="Routing engine not available.")
    await storage.log_audit(_actor(current_user), "EXPORT_DARK_STREETS", "exports/dark-streets")
    g = route_router.TRICITY_ROUTER.g
    model = route_router.RiskModel(g, "walk")
    rows = []
    for k, e in enumerate(g.edges):
        er = model.edge_risk(k, 23.0)
        if er.isolated or er.light < 0.4:
            rows.append({"name": e.get("name") or "unnamed", "lat": round(float((g.lat[e["u"]] + g.lat[e["v"]]) / 2), 5),
                         "lon": round(float((g.lon[e["u"]] + g.lon[e["v"]]) / 2), 5), "length_m": round(e["length_m"]),
                         "lighting_score": round(er.light, 2), "night_risk": round(er.risk, 2), "isolated": er.isolated})
    rows.sort(key=lambda r: (-r["night_risk"], -r["length_m"]))
    return {"synthetic_data": bool(g.meta.get("synthetic")), "streets": rows[:limit]}


# --- 112 / ERSS status callbacks ------------------------------------------------

@router.post("/api/v1/integrations/erss/status", include_in_schema=False)
@limiter.limit("120/minute")
async def erss_status_webhook(request: Request):
    """Status from the 112 system, signed with ERSS_WEBHOOK_SECRET (headers X-ERSS-Timestamp, X-ERSS-Signature)."""
    body = await request.body()
    if len(body) > 16384 or not police.verify_erss_signature(body, request.headers.get("X-ERSS-Timestamp", ""),
                                                             request.headers.get("X-ERSS-Signature", "")):
        raise HTTPException(status_code=401, detail="Invalid signature.")
    try:
        data = json.loads(body)
        incident_id, status = str(data["incident_id"])[:64], str(data["status"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=422, detail="Expected incident_id and status.")
    if status not in police.POLICE_STATUSES or status == "ROUTED":
        raise HTTPException(status_code=422, detail="Unknown status.")
    alert = await storage.find_alert_by_erss_incident(incident_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Unknown incident.")
    unit = str(data.get("unit") or "")[:40] or None
    eta = data.get("eta_minutes")
    eta = int(eta) if isinstance(eta, (int, float)) and 0 <= eta <= 180 else None
    await storage.log_audit("erss", f"POLICE_STATUS {status}", f"alert/{alert['id']}")
    await police.set_police_status(alert, status, "erss", unit, eta)
    return {"status": "ok"}


# --- Walker side ------------------------------------------------------------------

@router.get("/api/v1/police/nearby")
@limiter.limit("30/minute")
async def police_nearby(request: Request, lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                        current_user: dict = Depends(get_current_user)):
    """Helplines, the nearest police station, and how far the nearest patrol van is (distance only, never its position)."""
    station = await police.nearest_station(lat, lon)
    units = await storage.list_fresh_patrol_units(police.PATROL_POSITION_MAX_AGE_S)
    nearest_unit = min((haversine_distance(lat, lon, u["lat"], u["lon"]) for u in units if u.get("lat") is not None),
                       default=None)
    return {
        "helplines": HELPLINES,
        "station": {"name": station["name"], "phone": station.get("phone"), "distance_m": station["distance_m"]} if station else None,
        # Rounded to 500 m so the public cannot track police vehicles
        "patrol_unit_km": round(nearest_unit / 500) * 0.5 if nearest_unit is not None and nearest_unit < 15000 else None,
    }


class PoliceSharingPayload(BaseModel):
    enabled: bool


@router.put("/api/v1/me/police-sharing")
@limiter.limit("10/minute")
async def set_police_sharing(request: Request, payload: PoliceSharingPayload, current_user: dict = Depends(get_current_user)):
    """Consent to send SOS alerts to the police (nearest station and 112). Can be withdrawn at any time."""
    await storage.update_user_fields(current_user["user_id"], police_sharing=int(payload.enabled),
                                     police_sharing_at=datetime.now(timezone.utc).isoformat())
    await storage.log_audit(f"walker:{current_user['user_id']}", f"POLICE_SHARING {'ON' if payload.enabled else 'OFF'}",
                            f"user/{current_user['user_id']}")
    return {"police_sharing": payload.enabled}


@router.get("/api/v1/alerts/mine")
@limiter.limit("30/minute")
async def my_alerts(request: Request, current_user: dict = Depends(get_current_user)):
    return {"alerts": await storage.get_user_alerts(current_user["user_id"])}


class FirConsentPayload(BaseModel):
    pin: str = Field(pattern=PIN_PATTERN)


@router.post("/api/v1/alerts/{alert_id}/fir-consent")
@limiter.limit("10/minute")
async def fir_consent(request: Request, alert_id: str, payload: FirConsentPayload, background: BackgroundTasks,
                      current_user: dict = Depends(get_current_user)):
    """
    The walker lets the police use this incident's report, trail and evidence for an FIR.
    Confirmed with the SOS PIN; the duress PIN looks the same but records nothing and alerts guardians.
    """
    alert = await alert_for_owner(current_user, alert_id)
    kind, _ = await check_sos_pin(current_user["user_id"], payload.pin)
    if kind is None:
        raise HTTPException(status_code=403, detail="Incorrect PIN.")
    if kind == "duress":
        background.add_task(notify_guardians_of_alert, alert)
        return {"status": "consent_recorded"}
    now = datetime.now(timezone.utc).isoformat()
    await storage.update_alert_fields(alert_id, fir_consent_at=now)
    await storage.add_alert_event(alert_id, "FIR_CONSENT", f"walker:{current_user['user_id']}")
    await storage.log_audit(f"walker:{current_user['user_id']}", "FIR_CONSENT", f"alert/{alert_id}")
    return {"status": "consent_recorded"}
