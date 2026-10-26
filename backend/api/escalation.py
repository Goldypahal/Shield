"""ALERT-8: automatic escalation of alerts nobody acknowledged.

A background sweep moves ACTIVE alerts older than the acknowledgement window
to ESCALATED and messages the guardians again, so an alert can never sit
unnoticed just because nobody pressed a button.
"""
import asyncio
import logging
import time

from alert_states import transition
from checkin_router import expire_overdue_checkins
import police
from notifier import notify_guardians_of_alert
from db.storage import storage

logger = logging.getLogger("shield-escalation")

ACK_WINDOW_SECONDS = 60
SWEEP_INTERVAL_SECONDS = 15


async def escalate_overdue_alerts(ack_window_seconds: int = ACK_WINDOW_SECONDS) -> int:
    """One sweep; returns how many alerts were escalated."""
    escalated = 0
    for alert in await storage.get_unacknowledged_alerts(ack_window_seconds):
        try:
            updated = await transition(alert, "ESCALATED", "escalation_engine",
                                       {"escalation_reason": f"No acknowledgement within {ack_window_seconds}s"})
            await notify_guardians_of_alert(updated)
            escalated += 1
            logger.warning("Alert %s auto-escalated after %ss without acknowledgement", alert["id"], ack_window_seconds)
        except Exception:
            logger.exception("Auto-escalation failed for alert %s", alert["id"])
    return escalated


RETENTION_INTERVAL_SECONDS = 3600


async def run_escalation_loop(stop: asyncio.Event) -> None:
    last_retention = 0.0
    while not stop.is_set():
        try:
            await escalate_overdue_alerts()
            await expire_overdue_checkins()
            await police.process_erss_outbox()
            await police.escalate_to_control_room()
            if time.time() - last_retention > RETENTION_INTERVAL_SECONDS:
                await police.apply_retention()
                last_retention = time.time()
        except Exception:
            logger.exception("Escalation sweep failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=SWEEP_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass
