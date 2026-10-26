import os
import re
from datetime import datetime, timezone
import secrets
import time
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

import settings
from access import channel_for_viewer
from mailer import send_account_exists_email, send_code_email, send_security_notice
from notifier import notify_guardians_of_alert, send_otp_sms
from pins import PIN_PATTERN, check_sos_pin
from security import (
    decode_token,
    get_current_user,
    get_password_hash,
    hash_account_password,
    is_staff,
    issue_token_pair,
    match_totp,
    verify_account_password,
)
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-auth")

router = APIRouter(tags=["Authentication & Account"])

PHONE_PATTERN = r"^\+[1-9]\d{7,14}$"  # E.164
EMAIL_PATTERN = r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$"
MAX_FAILED_LOGINS = 5
LOCK_SECONDS = 15 * 60
CODE_TTL_SECONDS = 10 * 60
COMMON_PASSWORDS = {
    "password", "password1", "password123", "1234567890", "qwertyuiop", "iloveyou12", "welcome123",
    "admin12345", "letmein123", "shield1234", "abcdef1234", "qwerty1234", "1q2w3e4r5t", "passw0rd12",
}


def _email(v: str) -> str:
    v = v.strip().lower()
    if not re.match(EMAIL_PATTERN, v):
        raise ValueError("Enter a valid email address.")
    return v


def check_password_policy(password: str, email: str = "") -> None:
    """Length and a blocklist (NIST 800-63B); no arbitrary composition rules."""
    if len(password) < 10:
        raise HTTPException(status_code=400, detail="Password must be at least 10 characters.")
    lowered = password.lower()
    local = email.split("@")[0]
    if lowered in COMMON_PASSWORDS or len(set(password)) < 4 or (len(local) >= 4 and local in lowered):
        raise HTTPException(status_code=400, detail="That password is too easy to guess. Try a longer phrase.")


class EmailField(BaseModel):
    email: str = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def _norm(cls, v: str) -> str:
        return _email(v)


class RegisterStartPayload(EmailField):
    phone_number: str = Field(pattern=PHONE_PATTERN)


class RegisterCompletePayload(EmailField):
    email_code: str = Field(pattern=r"^\d{6}$")
    phone_number: str = Field(pattern=PHONE_PATTERN)
    phone_code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    pin: str = Field(pattern=PIN_PATTERN)
    duress_pin: Optional[str] = Field(default=None, pattern=PIN_PATTERN)
    device_id: Optional[str] = Field(default=None, max_length=128)
    # Explicit choice (DPDP Act): send SOS alerts to the police (nearest station, 112) or only to guardians
    police_sharing: bool


class LoginPayload(EmailField):
    password: str = Field(min_length=1, max_length=128)
    device_id: Optional[str] = Field(default=None, max_length=128)
    totp_code: Optional[str] = Field(default=None, pattern=r"^\d{6}$")  # staff second factor


class RefreshTokenPayload(BaseModel):
    refresh_token: str = Field(max_length=4096)


class ForgotPasswordPayload(EmailField):
    pass


class ResetPasswordPayload(EmailField):
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=1, max_length=128)


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class SetPinsPayload(BaseModel):
    email_code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=1, max_length=128)
    pin: str = Field(pattern=PIN_PATTERN)
    duress_pin: str = Field(pattern=PIN_PATTERN)


class PinCheckPayload(BaseModel):
    pin: str = Field(pattern=PIN_PATTERN)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)


class ConfirmPasswordPayload(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class PushTokenPayload(BaseModel):
    expo_push_token: str = Field(min_length=10, max_length=256)


class WSTicketPayload(BaseModel):
    channel_id: str = Field(max_length=64)


def _reject_identical(pin: str, duress_pin: Optional[str]) -> None:
    if duress_pin and pin == duress_pin:
        raise HTTPException(status_code=400, detail="AUTH-3: Normal PIN and Duress PIN cannot be identical.")


def _new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


async def _issue_code(key: str) -> str:
    code = _new_code()
    if not await storage.store_code(key, code, CODE_TTL_SECONDS):
        raise HTTPException(status_code=429, detail="A code was sent moments ago. Wait 30 seconds before asking again.")
    return code


async def _session_response(user: dict) -> dict:
    return {"user_id": user["id"], **await issue_token_pair(user)}


@router.post("/api/v1/auth/register/start")
@limiter.limit("5/minute")
async def register_start(request: Request, payload: RegisterStartPayload):
    """
    AUTH-1: Step 1 of sign-up. Sends a 6-digit code to the email and another by SMS
    to the phone. The answer is the same whether or not the email is taken, so the
    endpoint cannot be used to find out who has an account.
    """
    response = {"status": "codes_sent", "expires_in_seconds": CODE_TTL_SECONDS}
    phone_code = await _issue_code(f"sms:signup:{payload.phone_number}")
    if settings.DEMO_MODE:
        response["demo_phone_code"] = phone_code  # development only; refused in production
    else:
        await send_otp_sms(payload.phone_number, phone_code)

    if await storage.get_user_by_email(payload.email):
        await send_account_exists_email(payload.email)
        return response
    email_code = await _issue_code(f"email:signup:{payload.email}")
    if settings.DEMO_MODE:
        response["demo_email_code"] = email_code
    else:
        await send_code_email(payload.email, email_code, "signup", CODE_TTL_SECONDS // 60)
    return response


@router.post("/api/v1/auth/register/complete", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def register_complete(request: Request, payload: RegisterCompletePayload):
    """
    AUTH-1, AUTH-3: Step 2. Both codes prove the email and phone belong to the user;
    the password signs in, the SOS PIN (and optional duress PIN) stop an alert.
    """
    email_ok = await storage.check_code(f"email:signup:{payload.email}", payload.email_code, settings.OTP_MAX_ATTEMPTS)
    phone_ok = await storage.check_code(f"sms:signup:{payload.phone_number}", payload.phone_code, settings.OTP_MAX_ATTEMPTS)
    if not (email_ok and phone_ok):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")
    check_password_policy(payload.password, payload.email)
    _reject_identical(payload.pin, payload.duress_pin)
    if await storage.get_user_by_email(payload.email) or await storage.get_user_by_phone(payload.phone_number):
        raise HTTPException(status_code=409, detail="An account already exists for this email or phone. Sign in instead.")

    user = await storage.create_user(
        phone_number=payload.phone_number, name=payload.name,
        hashed_pin=get_password_hash(payload.pin),
        duress_pin=get_password_hash(payload.duress_pin) if payload.duress_pin else None,
        device_id=payload.device_id, email=payload.email,
        password_hash=hash_account_password(payload.password), verified=True,
    )
    if payload.police_sharing:
        await storage.update_user_fields(user["id"], police_sharing=1,
                                         police_sharing_at=datetime.now(timezone.utc).isoformat())
    return await _session_response(user)


@router.post("/api/v1/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, credentials: LoginPayload, background: BackgroundTasks):
    """AUTH-1: Email + password. Five wrong passwords lock the account for 15 minutes."""
    user = await storage.get_user_by_email(credentials.email)
    if not user:
        verify_account_password(credentials.password, None)  # equal timing for unknown emails
        raise HTTPException(status_code=400, detail="Incorrect email or password.")
    if (user.get("locked_until") or 0) > time.time():
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later or reset your password.")

    ok = verify_account_password(credentials.password, user.get("password_hash"))
    totp_needed = ok and is_staff(user) and settings.STAFF_TOTP_REQUIRED
    if totp_needed:
        if not user.get("totp_secret"):
            raise HTTPException(status_code=403, detail="Two-factor sign-in is not set up for this staff account. Ask an administrator.")
        # The dashboard sends the code together with the password, so a missing or wrong code gets the
        # same answer as a wrong password and counts toward the lockout: no "password was right" oracle
        step = match_totp(user["totp_secret"], credentials.totp_code, user.get("totp_last_step") or 0)             if credentials.totp_code else None
        ok = step is not None
        if ok:
            await storage.update_user_fields(user["id"], totp_last_step=step)
    await storage.record_login_result(user["id"], success=ok, max_failures=MAX_FAILED_LOGINS, lock_seconds=LOCK_SECONDS)
    if not ok:
        if (user.get("failed_logins") or 0) + 1 == MAX_FAILED_LOGINS:
            background.add_task(send_security_notice, user["email"],
                                "Your SHIELD account was locked for 15 minutes after several wrong passwords.")
        raise HTTPException(status_code=400, detail="Incorrect email or password.")
    return await _session_response(user)


@router.post("/api/v1/auth/refresh")
@limiter.limit("30/minute")
async def refresh_token(request: Request, payload: RefreshTokenPayload):
    """
    AUTH-2: Exchanges a refresh token for a new pair. Each refresh token works once;
    presenting a used one means it was copied, so every session of the account is revoked.
    """
    decoded = decode_token(payload.refresh_token, "refresh")
    user = await storage.get_user_by_id(decoded["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists.")
    state = await storage.consume_refresh_token(decoded.get("jti", ""), user["id"])
    if state == "reused":
        await storage.revoke_all_sessions(user["id"])
        logger.warning("Refresh token reuse for user %s; all sessions revoked", user["id"])
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    if state != "ok":
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    return await issue_token_pair(user)


@router.post("/api/v1/auth/logout")
@limiter.limit("30/minute")
async def logout(request: Request, payload: RefreshTokenPayload):
    """Ends this device's session (the refresh token stops working)."""
    try:
        decoded = decode_token(payload.refresh_token, "refresh")
        await storage.revoke_refresh_token(decoded.get("jti", ""), decoded["sub"])
    except HTTPException:
        pass  # already expired or invalid: nothing to revoke
    return {"status": "logged_out"}


@router.post("/api/v1/auth/logout-all")
@limiter.limit("10/minute")
async def logout_all(request: Request, current_user: dict = Depends(get_current_user)):
    """Signs out every device, including this one."""
    await storage.revoke_all_sessions(current_user["user_id"])
    return {"status": "logged_out_everywhere"}


@router.post("/api/v1/auth/password/forgot")
@limiter.limit("5/minute")
async def forgot_password(request: Request, payload: ForgotPasswordPayload):
    """Sends a reset code if the email has an account. The answer never says which."""
    response = {"status": "code_sent_if_account_exists", "expires_in_seconds": CODE_TTL_SECONDS}
    if await storage.get_user_by_email(payload.email):
        code = await _issue_code(f"email:reset_password:{payload.email}")
        if settings.DEMO_MODE:
            response["demo_email_code"] = code
        else:
            await send_code_email(payload.email, code, "reset_password", CODE_TTL_SECONDS // 60)
    return response


@router.post("/api/v1/auth/password/reset")
@limiter.limit("10/minute")
async def reset_password(request: Request, payload: ResetPasswordPayload, background: BackgroundTasks):
    """Sets a new password with the emailed code and signs out every device."""
    user = await storage.get_user_by_email(payload.email)
    if not await storage.check_code(f"email:reset_password:{payload.email}", payload.code, settings.OTP_MAX_ATTEMPTS) or not user:
        raise HTTPException(status_code=400, detail="Invalid or expired code.")
    check_password_policy(payload.new_password, payload.email)
    await storage.set_password(user["id"], hash_account_password(payload.new_password))
    await storage.revoke_all_sessions(user["id"])
    background.add_task(send_security_notice, user["email"], "Your SHIELD password was reset.")
    return {"status": "password_reset"}


@router.get("/api/v1/me")
async def get_my_profile(request: Request, current_user: dict = Depends(get_current_user)):
    user = await storage.get_user_by_id(current_user["user_id"])
    hidden = ("hashed_pin", "duress_pin", "password_hash", "failed_logins", "locked_until",
              "token_version", "pin_failures", "pin_locked_until", "totp_secret", "totp_last_step")
    profile = {k: v for k, v in user.items() if k not in hidden}
    profile["has_duress_pin"] = bool(user.get("duress_pin"))
    return profile


async def _confirm_password(user: dict, password: str) -> None:
    """Re-authentication for sensitive changes; failures count toward the login lockout."""
    if (user.get("locked_until") or 0) > time.time():
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
    ok = verify_account_password(password, user.get("password_hash"))
    await storage.record_login_result(user["id"], success=ok, max_failures=MAX_FAILED_LOGINS, lock_seconds=LOCK_SECONDS)
    if not ok:
        raise HTTPException(status_code=403, detail="Password confirmation failed.")


@router.post("/api/v1/me/password")
@limiter.limit("5/minute")
async def change_password(request: Request, payload: ChangePasswordPayload, background: BackgroundTasks,
                          current_user: dict = Depends(get_current_user)):
    """Changes the password, signs out other devices and returns a fresh session for this one."""
    user = await storage.get_user_by_id(current_user["user_id"])
    await _confirm_password(user, payload.current_password)
    check_password_policy(payload.new_password, user.get("email") or "")
    await storage.set_password(user["id"], hash_account_password(payload.new_password))
    await storage.revoke_all_sessions(user["id"])
    background.add_task(send_security_notice, user["email"], "Your SHIELD password was changed.")
    return {"status": "password_changed", **await issue_token_pair(await storage.get_user_by_id(user["id"]))}


@router.post("/api/v1/me/pins/code")
@limiter.limit("5/minute")
async def request_pin_change_code(request: Request, current_user: dict = Depends(get_current_user)):
    """AUTH-4: Step 1 of changing the SOS PINs: a code goes to the verified email."""
    user = await storage.get_user_by_id(current_user["user_id"])
    if not user.get("email") or not user.get("email_verified"):
        raise HTTPException(status_code=400, detail="This account has no verified email.")
    code = await _issue_code(f"email:change_pin:{user['email']}")
    response = {"status": "code_sent", "expires_in_seconds": CODE_TTL_SECONDS}
    if settings.DEMO_MODE:
        response["demo_email_code"] = code
    else:
        await send_code_email(user["email"], code, "change_pin", CODE_TTL_SECONDS // 60)
    return response


@router.post("/api/v1/me/pins")
@limiter.limit("5/minute")
async def set_pins(request: Request, payload: SetPinsPayload, background: BackgroundTasks,
                   current_user: dict = Depends(get_current_user)):
    """
    AUTH-3 & AUTH-4: Step 2: email code + password replace both PINs. The old PIN is
    not needed, so a forgotten PIN can be reset; someone holding the unlocked phone cannot.
    """
    user = await storage.get_user_by_id(current_user["user_id"])
    if not await storage.check_code(f"email:change_pin:{user.get('email')}", payload.email_code, settings.OTP_MAX_ATTEMPTS):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")
    await _confirm_password(user, payload.password)
    _reject_identical(payload.pin, payload.duress_pin)
    await storage.update_user_pins(user["id"], get_password_hash(payload.pin), get_password_hash(payload.duress_pin))
    await storage.record_pin_result(user["id"], success=True, lock_after=1, lock_seconds=0)
    background.add_task(send_security_notice, user["email"], "Your SHIELD SOS PINs were changed.")
    return {"status": "pins_updated"}


@router.post("/api/v1/me/pin/check")
@limiter.limit("20/minute")
async def check_pin(request: Request, payload: PinCheckPayload, background: BackgroundTasks,
                    current_user: dict = Depends(get_current_user)):
    """
    DUR-1/DUR-2: Confirms the SOS PIN before the app stands down an SOS countdown.
    The duress PIN gets the same answer, while a silent HIGH alert opens and guardians are messaged.
    """
    kind, _ = await check_sos_pin(current_user["user_id"], payload.pin)
    if kind is None:
        raise HTTPException(status_code=403, detail="Incorrect PIN.")
    if kind == "duress":
        result = await storage.sync_alert(
            alert_id=str(uuid.uuid4()), user_id=current_user["user_id"], trigger_type="DURESS_PIN",
            lat=payload.lat or 0.0, lon=payload.lon or 0.0, priority="HIGH", initial_state="ACTIVE",
        )
        background.add_task(notify_guardians_of_alert, result["alert"])
        logger.warning("Silent duress alert %s opened from PIN check", result["alert"]["id"])
    return {"valid": True}


@router.post("/api/v1/auth/push-token")
@limiter.limit("10/minute")
async def register_push_token(request: Request, payload: PushTokenPayload,
                              current_user: dict = Depends(get_current_user)):
    await storage.set_push_token(current_user["user_id"], payload.expo_push_token)
    return {"status": "push_token_saved"}


@router.delete("/api/v1/me/account")
@limiter.limit("5/minute")
async def delete_account(request: Request, payload: ConfirmPasswordPayload,
                         current_user: dict = Depends(get_current_user)):
    """AUTH-7 & LEG-1: Erases the account, its records and its encrypted evidence files (DPDP Act)."""
    user_id = current_user["user_id"]
    await _confirm_password(await storage.get_user_by_id(user_id), payload.password)
    evidence_dir = os.path.abspath(settings.EVIDENCE_DIR)
    for alert_id in await storage.get_user_alert_ids(user_id):
        for name in os.listdir(evidence_dir) if os.path.isdir(evidence_dir) else []:
            if name.startswith(f"{alert_id}_chunk_"):
                os.remove(os.path.join(evidence_dir, name))
    await storage.delete_user_account(user_id)
    return {"status": "deleted", "message": "All personal data, walks, alerts and evidence erased."}


@router.post("/api/v1/auth/ws-ticket")
@limiter.limit("30/minute")
async def create_websocket_ticket(request: Request, payload: WSTicketPayload,
                                  current_user: dict = Depends(get_current_user)):
    """
    NFR-10: One-time 60 s ticket for a live channel, so tokens never appear in
    URLs. Issued only for walks/alerts the caller is allowed to follow.
    """
    kind = await channel_for_viewer(current_user, payload.channel_id)
    ticket = await storage.create_ws_ticket(walk_id=payload.channel_id, user_id=current_user["user_id"], ttl_seconds=60)
    return {"status": "ticket_created", "ticket": ticket, "channel_id": payload.channel_id,
            "channel_kind": kind, "expires_in_seconds": 60}
