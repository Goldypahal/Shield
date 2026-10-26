"""Police integration: routing alerts to stations, the 112 (ERSS) hand-off, dispatcher
status, control-room escalation and data retention.

Rules that apply everywhere:
  * Nothing reaches the police unless the walker consented (users.police_sharing).
  * Police see an alert's location only while it is open, or afterwards if the walker
    consented to share it for an FIR (alerts.fir_consent_at).
  * Every police view and action is written to the audit log.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import time
import urllib.request
from datetime import datetime, timezone
from typing import Optional

import settings
from alert_states import OPEN
from db.storage import storage, haversine_distance
from live import broker

logger = logging.getLogger("shield-police")

MAX_STATION_DISTANCE_M = 25_000          # beyond this the alert goes straight to the control room
PATROL_POSITION_MAX_AGE_S = 15 * 60      # older patrol fixes are ignored
TRACK_LINK_TTL_SECONDS = 24 * 3600
ERSS_RETRY_SECONDS = (15, 30, 60, 120, 300)

POLICE_STATUSES = ("ROUTED", "ACKNOWLEDGED", "UNIT_ASSIGNED", "EN_ROUTE", "ON_SCENE", "CLOSED_SAFE")
STATUS_TEXT = {
    "ROUTED": "Sent to {station}",
    "ACKNOWLEDGED": "Police have seen your alert",
    "UNIT_ASSIGNED": "Police unit {unit} assigned",
    "EN_ROUTE": "Police unit {unit} is on the way",
    "ON_SCENE": "Police have arrived",
    "CLOSED_SAFE": "Police closed the incident",
}


def status_text(alert: dict, station_name: Optional[str] = None) -> Optional[str]:
    s = alert.get("police_status")
    if not s:
        return None
    text = STATUS_TEXT.get(s, s).format(station=station_name or "the police", unit=alert.get("police_unit") or "")
    if s in ("UNIT_ASSIGNED", "EN_ROUTE") and alert.get("police_eta_min"):
        text += f", about {alert['police_eta_min']} min away"
    return text.replace("  ", " ")


async def nearest_station(lat: float, lon: float) -> Optional[dict]:
    best, best_d = None, float("inf")
    for st in await storage.list_stations():
        d = haversine_distance(lat, lon, st["lat"], st["lon"])
        if d < best_d:
            best, best_d = st, d
    return {**best, "distance_m": round(best_d)} if best and best_d <= MAX_STATION_DISTANCE_M else None


async def dispatch(alert: dict) -> None:
    """
    Called whenever guardians are notified about an alert. Idempotent: routes the alert to the
    nearest station once and queues one 112 hand-off, only with the walker's consent.
    """
    user = await storage.get_user_by_id(alert["user_id"])
    if not user or not user.get("police_sharing"):
        return
    current = await storage.get_alert_by_id(alert["id"])
    if not current or current["state"] not in OPEN or current.get("routed_at"):
        return
    has_fix = bool(current.get("lat") or current.get("lon"))
    station = await nearest_station(current["lat"], current["lon"]) if has_fix else None
    await storage.update_alert_fields(alert["id"], station_id=station["id"] if station else None, routed_at=time.time(),
                                      police_status="ROUTED", control_escalated=0 if station else 1,
                                      police_updated_at=datetime.now(timezone.utc).isoformat())
    await storage.add_alert_event(alert["id"], "POLICE_ROUTED", "police_router",
                                  {"station": station["name"] if station else "control room",
                                   "distance_m": station["distance_m"] if station else None})
    if settings.ERSS_MODE != "off":
        token = await storage.create_share_link("alert", alert["id"], TRACK_LINK_TTL_SECONDS)
        await storage.enqueue_erss(alert["id"], {
            "source": "SHIELD", "source_ref": alert["id"], "category": "WOMEN_SAFETY_SOS",
            "trigger": current["trigger_type"], "priority": current["priority"],
            "location": {"lat": current["lat"], "lon": current["lon"]} if has_fix else None,
            "caller": {"name": user.get("name"), "phone": user.get("phone_number")},
            "station": station["name"] if station else None,
            "live_tracking_url": f"{settings.PUBLIC_APP_URL}/track/{token}",
            "raised_at": current["started_at"],
        })
    logger.warning("Alert %s routed to %s", alert["id"], station["name"] if station else "control room")


def _post_erss(payload: dict) -> dict:
    req = urllib.request.Request(
        settings.ERSS_ENDPOINT, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings.ERSS_API_KEY}"})
    with urllib.request.urlopen(req, timeout=10) as res:  # https enforced in settings
        return json.loads(res.read(65536) or b"{}")


async def process_erss_outbox() -> int:
    """Sends pending 112 hand-offs, retrying with back-off; returns how many were accepted."""
    sent = 0
    for item in await storage.due_erss():
        payload = json.loads(item["payload"])
        try:
            if settings.ERSS_MODE == "mock":
                incident_id = f"MOCK-112-{item['alert_id'][:8].upper()}"
            elif settings.ERSS_MODE == "http":
                incident_id = str((await asyncio.to_thread(_post_erss, payload)).get("incident_id") or "")
                if not incident_id:
                    raise ValueError("ERSS response had no incident_id")
            else:
                return sent
            await storage.update_alert_fields(item["alert_id"], erss_incident_id=incident_id[:64])
            await storage.add_alert_event(item["alert_id"], "ERSS_ACCEPTED", "erss", {"incident_id": incident_id[:64]})
            await storage.mark_erss(item["id"], "SENT")
            sent += 1
        except Exception as exc:
            attempt = item["attempts"]
            if attempt + 1 >= len(ERSS_RETRY_SECONDS):
                await storage.mark_erss(item["id"], "FAILED", str(exc)[:300])
                await storage.update_alert_fields(item["alert_id"], control_escalated=1)
                logger.error("112 hand-off for alert %s failed permanently: %s", item["alert_id"], exc)
            else:
                await storage.mark_erss(item["id"], "PENDING", str(exc)[:300], ERSS_RETRY_SECONDS[attempt])
    return sent


async def escalate_to_control_room() -> int:
    """Alerts a station did not acknowledge within POLICE_ACK_SECONDS become control-room alerts."""
    count = 0
    for alert in await storage.get_alerts_awaiting_police(settings.POLICE_ACK_SECONDS):
        await storage.update_alert_fields(alert["id"], control_escalated=1)
        await storage.add_alert_event(alert["id"], "POLICE_ESCALATED_TO_CONTROL", "police_router",
                                      {"reason": f"not acknowledged by station within {settings.POLICE_ACK_SECONDS}s"})
        count += 1
    return count


async def set_police_status(alert: dict, status: str, actor: str, unit: Optional[str] = None,
                            eta_min: Optional[int] = None, note: Optional[str] = None) -> dict:
    """Records a dispatcher update, shows it to the walker and guardians, and closes or acknowledges the alert."""
    from alert_states import transition  # local import: alert_states imports storage only
    await storage.update_alert_fields(alert["id"], police_status=status,
                                      police_unit=unit if unit is not None else alert.get("police_unit"),
                                      police_eta_min=eta_min if eta_min is not None else alert.get("police_eta_min"),
                                      police_note=note, police_updated_at=datetime.now(timezone.utc).isoformat())
    await storage.add_alert_event(alert["id"], f"POLICE_{status}", actor, {"unit": unit, "eta_min": eta_min})
    current = await storage.get_alert_by_id(alert["id"])
    if status == "CLOSED_SAFE" and current["state"] in OPEN:
        current = await transition(current, "RESOLVED", actor, {"resolved_by": "police"})
    elif status != "ROUTED" and current["state"] in ("ACTIVE", "ESCALATED"):
        current = await transition(current, "ACKNOWLEDGED", actor, {"action": f"police {status.lower()}"})
    station = await storage.get_station(current["station_id"]) if current.get("station_id") else None
    await broker.broadcast(alert["id"], {"type": "police_status", "status": status,
                                         "text": status_text(current, station["name"] if station else None)})
    return current


def verify_erss_signature(body: bytes, timestamp: str, signature: str) -> bool:
    """
    HMAC-SHA256 over "<timestamp>.<body>" with ERSS_WEBHOOK_SECRET; rejects timestamps older than 5 minutes.
    A replay inside that window only re-applies the same status, which is harmless.
    """
    if not settings.ERSS_WEBHOOK_SECRET or not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    expected = hmac.new(settings.ERSS_WEBHOOK_SECRET.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def apply_retention() -> dict:
    """LEG-2: deletes trails and unconsented evidence of alerts closed more than RETENTION_DAYS ago."""
    import os
    result = await storage.purge_expired(settings.RETENTION_DAYS)
    evidence_dir = os.path.abspath(settings.EVIDENCE_DIR)
    removed = 0
    if os.path.isdir(evidence_dir) and result["evidence_alert_ids"]:
        prefixes = tuple(f"{a}_chunk_" for a in result["evidence_alert_ids"])
        for name in os.listdir(evidence_dir):
            if name.startswith(prefixes):
                os.remove(os.path.join(evidence_dir, name))
                removed += 1
    if any(result[k] for k in ("alert_points", "walk_points", "evidence_chunks")) or removed:
        await storage.log_audit("retention", f"PURGE points={result['alert_points'] + result['walk_points']} "
                                             f"evidence={result['evidence_chunks']} files={removed}", "retention")
    return {**result, "evidence_files": removed}
