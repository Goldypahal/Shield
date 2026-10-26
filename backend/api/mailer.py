"""Transactional email (verification codes, security notices) over SMTP with STARTTLS.

When SMTP is not configured (development, tests) messages are logged, never the
code itself, so logs cannot be used to take over an account.
"""
import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage

import settings

logger = logging.getLogger("shield-mailer")


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:2]}***@{domain}" if domain else "***"


def _send_sync(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.MAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        if settings.SMTP_USERNAME:
            smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        smtp.send_message(msg)


async def send_email(to: str | None, subject: str, body: str) -> bool:
    if not to:
        return False
    if not settings.SMTP_HOST:
        logger.info("email.skipped (SMTP not configured) to=%s subject=%r", mask_email(to), subject)
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, body)
        logger.info("email.sent to=%s subject=%r", mask_email(to), subject)
        return True
    except Exception as exc:
        logger.error("email.failed to=%s error=%s", mask_email(to), exc)
        return False


PURPOSE_TEXT = {
    "signup": "finish creating your SHIELD account",
    "reset_password": "reset your SHIELD password",
    "change_pin": "change your SHIELD SOS PIN",
}


async def send_code_email(to: str, code: str, purpose: str, ttl_minutes: int) -> bool:
    return await send_email(
        to,
        f"Your SHIELD code: {code}",
        f"Your code to {PURPOSE_TEXT[purpose]} is {code}.\n\n"
        f"It expires in {ttl_minutes} minutes. SHIELD staff will never ask you for it.\n"
        "If you did not request this, you can ignore this email; your account is unchanged.",
    )


async def send_account_exists_email(to: str) -> bool:
    """Sent instead of a sign-up code when the address already has an account (no enumeration)."""
    return await send_email(
        to,
        "Someone tried to create a SHIELD account with your email",
        "A sign-up was started with this email address, which already has a SHIELD account.\n"
        "If it was you, sign in instead, or use 'Forgot password'. If not, no action is needed.",
    )


async def send_security_notice(to: str, what: str) -> bool:
    return await send_email(
        to,
        "SHIELD security notice",
        f"{what}\n\nIf this was not you, reset your password now and sign out of all devices from Settings.",
    )
