"""Guardian notifications for alerts (ALERT-8, GRD-4).

Sends SMS through Twilio when it is configured; otherwise logs what would have
been sent, so development and tests never need real credentials. Only the
walker's own registered guardians are messaged, never numbers supplied in a
request, which would let any account send SMS to arbitrary numbers at our cost.
"""
import asyncio
import logging
from typing import List

import settings
from db.storage import storage

logger = logging.getLogger("shield-notifier")

_client = None


def _twilio():
    global _client
    if _client is None and settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_FROM_NUMBER:
        from twilio.rest import Client
        _client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    return _client


def mask_phone(phone: str) -> str:
    return phone[:3] + "*" * max(0, len(phone) - 5) + phone[-2:] if len(phone) > 5 else "***"


TRACK_LINK_TTL_SECONDS = 24 * 3600


def build_alert_message(walker_name: str, alert: dict, track_token: str) -> str:
    lat, lon = alert.get("lat"), alert.get("lon")
    where = f" Last known location: https://maps.google.com/?q={lat:.5f},{lon:.5f}." if lat or lon else ""
    return (
        f"SHIELD ALERT: {walker_name} may need help ({alert.get('trigger_type', 'SOS').replace('_', ' ').lower()})."
        f"{where} Follow live (no app needed): {settings.PUBLIC_APP_URL}/track/{track_token}"
        " If you believe they are in danger, call 112."
    )


async def _send_sms(to: str, body: str) -> bool:
    client = _twilio()
    if client is None:
        logger.info("sms.skipped (Twilio not configured) to=%s", mask_phone(to))
        return False
    try:
        await asyncio.to_thread(client.messages.create, body=body, from_=settings.TWILIO_FROM_NUMBER, to=to)
        logger.info("sms.sent to=%s", mask_phone(to))
        return True
    except Exception as exc:  # one failed number must not stop the rest
        logger.error("sms.failed to=%s error=%s", mask_phone(to), exc)
        return False


async def notify_guardians_of_alert(alert: dict) -> List[str]:
    """Messages every guardian of the alert's owner; returns the masked numbers attempted."""
    walker = await storage.get_user_by_id(alert["user_id"])
    guardians = await storage.get_guardians(alert["user_id"])
    if not walker or not guardians:
        logger.warning("alert %s has no guardians to notify", alert["id"])
        return []
    # Unguessable, expiring, read-only link; the alert id itself never appears in an SMS
    token = await storage.create_share_link("alert", alert["id"], TRACK_LINK_TTL_SECONDS)
    body = build_alert_message(walker.get("name") or "A SHIELD user", alert, token)
    results = await asyncio.gather(*(_send_sms(g["phone"], body) for g in guardians))
    await log_notification(alert["id"], len(guardians), sum(results))
    return [mask_phone(g["phone"]) for g in guardians]


async def notify_guardians_of_walk(walk: dict) -> List[str]:
    """WALK-3: tells the guardians a walk (or ride) is shared with them, with a live tracking link."""
    walker = await storage.get_user_by_id(walk["user_id"])
    shared = set(walk.get("shared_with") or [])
    guardians = [g for g in await storage.get_guardians(walk["user_id"]) if g["id"] in shared]
    if not walker or not guardians:
        return []
    token = await storage.create_share_link("walk", walk["id"], TRACK_LINK_TTL_SECONDS)
    what = "a ride" if walk.get("mode") == "ride" else "a walk"
    plate = f" in vehicle {walk['vehicle_plate']}" if walk.get("vehicle_plate") else ""
    body = (f"SHIELD: {walker.get('name') or 'A SHIELD user'} started {what}{plate} to "
            f"{walk.get('destination_name') or 'their destination'} and shared it with you. "
            f"Follow live: {settings.PUBLIC_APP_URL}/track/{token}")
    await asyncio.gather(*(_send_sms(g["phone"], body) for g in guardians))
    return [mask_phone(g["phone"]) for g in guardians]


async def log_notification(alert_id: str, attempted: int, delivered: int) -> None:
    await storage.log_audit(actor="notifier", action=f"GUARDIANS_NOTIFIED attempted={attempted} delivered={delivered}",
                            target=f"alert/{alert_id}")


async def send_otp_sms(phone: str, code: str) -> bool:
    return await _send_sms(phone, f"Your SHIELD verification code is {code}. It expires in 5 minutes. Never share it.")
