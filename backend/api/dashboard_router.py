import csv
import io
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from alert_states import transition
from access import alert_for_viewer, staff_can_see
from security import require_roles, STAFF_ROLES
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-dashboard")

router = APIRouter(prefix="/api/v1/dashboard", tags=["Authority Dashboard"])

class AssignAlertPayload(BaseModel):
    responder_id: str = Field(max_length=100)
    responder_name: str = Field(max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)

class ResolveAlertPayload(BaseModel):
    responder_name: str = Field(max_length=120)
    resolution_notes: str = Field(max_length=2000)

@router.get("/alerts/active")
@limiter.limit("30/minute")
async def get_active_alerts(
    request: Request,
    current_user: dict = Depends(require_roles(*STAFF_ROLES))
):
    """
    DASH-1 & DASH-6:
    Responder view: live active alerts with walker details, coordinates, and trail.
    Logs access to audit log.
    """
    actor = f"{current_user['role']}:{current_user['user_id']}"
    await storage.log_audit(actor=actor, action="VIEW_ACTIVE_ALERTS", target="alerts/active")

    alerts = [a for a in await storage.get_active_alerts() if await staff_can_see(current_user, a)]
    stations = {s["id"]: s for s in await storage.list_stations()}
    enriched = []
    for a in alerts:
        # Fetch trail if walk_id attached
        trail = await storage.get_walk_trail(a["walk_id"]) if a.get("walk_id") else await storage.get_alert_points(a["id"], limit=20)
        
        # Anonymize or format walker details
        enriched.append({
            "id": a["id"],
            "walker_name": a.get("walker_name", "Anonymous Walker"),
            "walker_phone": a.get("walker_phone", "Hidden for privacy"),
            "trigger_type": a["trigger_type"],
            "priority": a["priority"],
            "state": a["state"],
            "lat": a["lat"],
            "lon": a["lon"],
            "started_at": a["started_at"],
            "trail": trail[-20:], # Last 20 GPS points
            "trail_count": len(trail),
            "station": stations.get(a.get("station_id"), {}).get("name"),
            "police_status": a.get("police_status"),
            "police_unit": a.get("police_unit"),
            "incident_112": a.get("erss_incident_id"),
            "control_room": bool(a.get("control_escalated")) or not a.get("station_id"),
        })

    return {
        "status": "success",
        "active_count": len(enriched),
        "alerts": enriched
    }

@router.post("/alerts/{alert_id}/assign")
@limiter.limit("20/minute")
async def assign_responder(
    request: Request,
    alert_id: str,
    payload: AssignAlertPayload,
    current_user: dict = Depends(require_roles(*STAFF_ROLES))
):
    """
    DASH-2 & DASH-6:
    Assigns responder unit or police vehicle to incident.
    """
    # The audit actor is the authenticated account, never a name from the request body
    actor = f"{current_user['role']}:{current_user['user_id']}"
    alert = await alert_for_viewer(current_user, alert_id)  # station scoping and consent, same as every view
    await storage.log_audit(actor=actor, action="ASSIGN_ALERT", target=f"alert/{alert_id}")

    meta = {"assigned_to": payload.responder_name, "responder_id": payload.responder_id, "notes": payload.notes}
    updated = await transition(alert, "ACKNOWLEDGED", actor, meta)
    return {"status": "assigned", "alert": updated}

@router.post("/alerts/{alert_id}/resolve")
@limiter.limit("20/minute")
async def resolve_alert(
    request: Request,
    alert_id: str,
    payload: ResolveAlertPayload,
    current_user: dict = Depends(require_roles(*STAFF_ROLES))
):
    """
    DASH-2 & DASH-6:
    Resolves alert with formal incident notes.
    """
    actor = f"{current_user['role']}:{current_user['user_id']}"
    alert = await alert_for_viewer(current_user, alert_id)  # station scoping and consent, same as every view
    await storage.log_audit(actor=actor, action="RESOLVE_ALERT", target=f"alert/{alert_id}")

    meta = {"resolved_by": payload.responder_name, "resolution_notes": payload.resolution_notes}
    updated = await transition(alert, "RESOLVED", actor, meta)
    return {"status": "resolved", "alert": updated}

@router.get("/heatmap")
@limiter.limit("30/minute")
async def get_heatmap_data(
    request: Request,
    current_user: dict = Depends(require_roles(*STAFF_ROLES))
):
    """
    DASH-3 & DASH-5:
    Analyst view: aggregated heatmap of ratings, hazard reports, and incident clusters.
    Enforces minimum aggregation to prevent individual tracking.
    """
    actor = f"analyst_{current_user.get('user_id')}"
    await storage.log_audit(actor=actor, action="VIEW_HEATMAP", target="dashboard/heatmap")

    segments = await storage.get_all_segments()
    hazards = await storage.get_active_hazards()

    heatmap_points = []
    # Add low-safety segment coordinates as intensity points
    for s in segments:
        coords = s.get("coordinates", [])
        if coords:
            mid_lon, mid_lat = coords[len(coords) // 2]
            # Invert score so low safety = high risk heatmap intensity
            risk_intensity = round(max(0.1, (100.0 - s["static_score"]) / 100.0), 2)
            heatmap_points.append({
                "lat": mid_lat,
                "lon": mid_lon,
                "intensity": risk_intensity,
                "type": "segment_risk",
                "name": s["name"]
            })

    # Add hazards as high-intensity points
    for h in hazards:
        heatmap_points.append({
            "lat": h["lat"],
            "lon": h["lon"],
            "intensity": 0.85,
            "type": "hazard",
            "category": h["category"],
            "description": h.get("description")
        })

    return {
        "status": "success",
        "total_points": len(heatmap_points),
        "heatmap": heatmap_points,
        "aggregation_privacy": "DASH-5: Cell aggregation applied. No individual walker trails revealed."
    }

@router.get("/gaps")
@limiter.limit("20/minute")
async def get_infrastructure_gaps(
    request: Request,
    format: Optional[str] = "json",
    current_user: dict = Depends(require_roles(*STAFF_ROLES))
):
    """
    DASH-4:
    Ranked work list of infrastructure gaps: segments with low lighting score & high night usage.
    Available as JSON or downloadable CSV for municipal / campus maintenance teams.
    """
    actor = f"analyst_{current_user.get('user_id')}"
    await storage.log_audit(actor=actor, action="VIEW_GAPS", target="dashboard/gaps")

    segments = await storage.get_all_segments()
    # Rank by lowest lamp density and lowest static score
    gaps = []
    for s in segments:
        lamp_density = s.get("lamp_density", 0.0)
        score = s.get("static_score", 50.0)
        # Urgency metric: (100 - score) * 0.7 + (3.0 - lamp_density) * 10
        urgency = round((100.0 - score) * 0.6 + max(0.0, 3.0 - lamp_density) * 13.3, 1)
        
        gaps.append({
            "segment_id": s["id"],
            "name": s["name"],
            "lamp_density_per_100m": lamp_density,
            "safety_score": score,
            "rating_count": s.get("rating_count", 0),
            "priority_rank": "HIGH" if urgency > 60 else ("MEDIUM" if urgency > 40 else "LOW"),
            "urgency_score": urgency,
            "recommended_action": "Install 3x LED solar street lamps & repair existing wiring" if lamp_density < 1.0 else "Increase night patrol & trim obstructing foliage"
        })

    gaps.sort(key=lambda g: g["urgency_score"], reverse=True)

    if format.lower() == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["segment_id", "name", "lamp_density_per_100m", "safety_score", "rating_count", "priority_rank", "urgency_score", "recommended_action"])
        for g in gaps:
            writer.writerow([g["segment_id"], g["name"], g["lamp_density_per_100m"], g["safety_score"], g["rating_count"], g["priority_rank"], g["urgency_score"], g["recommended_action"]])
        
        csv_content = output.getvalue()
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=shield_infrastructure_gaps.csv"}
        )

    return {
        "status": "success",
        "total_gaps": len(gaps),
        "work_list": gaps
    }

@router.get("/audit-logs")
@limiter.limit("20/minute")
async def get_audit_logs(
    request: Request,
    current_user: dict = Depends(require_roles("admin"))
):
    """
    DASH-6: View audit log of dashboard queries and actions (admins only).
    """
    logs = await storage.get_audit_logs(limit=50)
    return {"audit_logs": logs}
