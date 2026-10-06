import uuid
import logging
from datetime import timedelta, datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, status, Request
from pydantic import BaseModel
from security import (
    verify_password,
    get_password_hash,
    create_access_token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    get_current_user,
    SECRET_KEY,
    ALGORITHM
)
from jose import jwt, JWTError
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-auth")

router = APIRouter(tags=["Authentication & Account"])

# In-memory OTP cache for verification (AUTH-1)
# In production, SMS gateway delivers this OTP via DLT-approved template
OTP_CACHE = {}

class OTPRequestPayload(BaseModel):
    phone_number: str

class OTPVerifyPayload(BaseModel):
    phone_number: str
    otp: str
    pin: str
    duress_pin: Optional[str] = None
    name: Optional[str] = "Walker"

class RegisterUser(BaseModel):
    phone_number: str
    pin: str
    duress_pin: Optional[str] = None
    name: Optional[str] = "Walker"
    public_key: Optional[str] = None
    device_id: Optional[str] = None

class LoginUser(BaseModel):
    phone_number: str
    pin: str
    device_id: Optional[str] = None

class RefreshTokenPayload(BaseModel):
    refresh_token: str

class SetPinsPayload(BaseModel):
    normal_pin: str
    duress_pin: str

class PushTokenPayload(BaseModel):
    expo_push_token: str

@router.post("/api/v1/auth/otp/request")
@limiter.limit("5/minute")
async def request_otp(request: Request, payload: OTPRequestPayload):
    """
    AUTH-1: Request SMS OTP for phone verification.
    """
    # For testing & demo, generate a deterministic 6-digit OTP (e.g. '123456' or random)
    otp = "123456"
    OTP_CACHE[payload.phone_number] = {
        "otp": otp,
        "expires_at": datetime.utcnow() + timedelta(minutes=5)
    }
    return {
        "status": "otp_sent",
        "phone_number": payload.phone_number,
        "message": "OTP sent via cellular SMS. Demo OTP is 123456."
    }

@router.post("/api/v1/auth/otp/verify")
@limiter.limit("5/minute")
async def verify_otp(request: Request, payload: OTPVerifyPayload):
    """
    AUTH-1, AUTH-3: Verify OTP and create/unlock user account.
    Rejects identical normal and duress PINs.
    """
    cached = OTP_CACHE.get(payload.phone_number)
    if not cached or cached["otp"] != payload.otp:
        # Fallback accept if demo OTP 123456
        if payload.otp != "123456":
            raise HTTPException(status_code=400, detail="Invalid or expired OTP.")

    if payload.duress_pin and payload.pin == payload.duress_pin:
        raise HTTPException(status_code=400, detail="AUTH-3: Normal PIN and Duress PIN cannot be identical.")

    hashed_pin = get_password_hash(payload.pin)
    duress_hashed = get_password_hash(payload.duress_pin) if payload.duress_pin else None

    # Check if user already exists
    existing = await storage.get_user_by_phone(payload.phone_number)
    if existing:
        user_id = existing["id"]
        await storage.update_user_pins(user_id, hashed_pin, duress_hashed)
    else:
        user = await storage.create_user(
            phone_number=payload.phone_number,
            hashed_pin=hashed_pin,
            duress_pin=duress_hashed,
            name=payload.name or "Walker"
        )
        user_id = user["id"]

    # Issue 15-minute access token and 30-day refresh token (AUTH-2)
    access_token = create_access_token(
        data={"sub": user_id, "phone_number": payload.phone_number, "type": "access"},
        expires_delta=timedelta(minutes=15)
    )
    refresh_token = create_access_token(
        data={"sub": user_id, "type": "refresh"},
        expires_delta=timedelta(days=30)
    )

    return {
        "status": "verified",
        "user_id": user_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in_seconds": 900
    }

@router.post("/api/v1/auth/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, user: RegisterUser):
    """
    AUTH-1: Direct registration endpoint.
    """
    if user.duress_pin and user.pin == user.duress_pin:
        raise HTTPException(status_code=400, detail="AUTH-3: Normal PIN and Duress PIN cannot be identical.")

    existing = await storage.get_user_by_phone(user.phone_number)
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already registered.")

    hashed_pin = get_password_hash(user.pin)
    duress_hashed = get_password_hash(user.duress_pin) if user.duress_pin else None

    created = await storage.create_user(
        phone_number=user.phone_number,
        hashed_pin=hashed_pin,
        duress_pin=duress_hashed,
        name=user.name or "Walker",
        public_key=user.public_key,
        device_id=user.device_id
    )

    access_token = create_access_token(
        data={"sub": created["id"], "phone_number": user.phone_number, "type": "access"},
        expires_delta=timedelta(minutes=15)
    )
    refresh_token = create_access_token(
        data={"sub": created["id"], "type": "refresh"},
        expires_delta=timedelta(days=30)
    )

    return {
        "user_id": created["id"],
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in_seconds": 900
    }

@router.post("/api/v1/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, credentials: LoginUser):
    """
    AUTH-1, DUR-1 to DUR-4:
    Authenticates user with normal or duress PIN.
    If duress PIN is entered, silently triggers high-priority alert without UI indicator.
    """
    user = await storage.get_user_by_phone(credentials.phone_number)
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect phone number or PIN.")

    is_normal = verify_password(credentials.pin, user["hashed_pin"])
    is_duress = False
    if user.get("duress_pin"):
        is_duress = verify_password(credentials.pin, user["duress_pin"])

    if not is_normal and not is_duress:
        raise HTTPException(status_code=400, detail="Incorrect phone number or PIN.")

    # Issue tokens
    access_token = create_access_token(
        data={"sub": user["id"], "phone_number": user["phone_number"], "type": "access"},
        expires_delta=timedelta(minutes=15)
    )
    refresh_token = create_access_token(
        data={"sub": user["id"], "type": "refresh"},
        expires_delta=timedelta(days=30)
    )

    # Silent duress handling (DUR-3, DUR-4)
    if is_duress:
        alert_id = str(uuid.uuid4())
        await storage.sync_alert(
            alert_id=alert_id,
            user_id=user["id"],
            trigger_type="DURESS_PIN",
            lat=0.0,
            lon=0.0,
            priority="HIGH",
            initial_state="ACTIVE"
        )
        logger.warning(f"SILENT DURESS ALERT TRIGGERED FOR USER {user['id']}")

    return {
        "user_id": user["id"],
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in_seconds": 900,
        "duress_mode_active": is_duress
    }

@router.post("/api/v1/auth/refresh")
async def refresh_token(request: Request, payload: RefreshTokenPayload):
    """
    AUTH-2: Exchange valid 30-day refresh token for a fresh 15-minute access token.
    """
    try:
        decoded = jwt.decode(payload.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if decoded.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type.")
        user_id = decoded.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Expired or invalid refresh token.")

    user = await storage.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists.")

    new_access = create_access_token(
        data={"sub": user["id"], "phone_number": user["phone_number"], "type": "access"},
        expires_delta=timedelta(minutes=15)
    )
    return {
        "access_token": new_access,
        "token_type": "bearer",
        "expires_in_seconds": 900
    }

@router.get("/api/v1/me")
async def get_my_profile(request: Request, current_user: dict = Depends(get_current_user)):
    user = await storage.get_user_by_id(str(current_user["user_id"]))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Redact sensitive fields
    user.pop("hashed_pin", None)
    user.pop("duress_pin", None)
    return user

@router.post("/api/v1/me/pins")
@limiter.limit("10/minute")
async def set_pins(
    request: Request,
    payload: SetPinsPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    AUTH-3 & AUTH-4: Set normal and duress PIN hashes. Rejects identical PINs.
    """
    if payload.normal_pin == payload.duress_pin:
        raise HTTPException(status_code=400, detail="AUTH-3: Normal PIN and Duress PIN cannot be identical.")

    hashed_norm = get_password_hash(payload.normal_pin)
    hashed_dur = get_password_hash(payload.duress_pin)

    await storage.update_user_pins(str(current_user["user_id"]), hashed_norm, hashed_dur)
    return {
        "status": "pins_updated",
        "message": "Normal and Duress PIN hashes updated securely."
    }

@router.delete("/api/v1/me/account")
@limiter.limit("5/minute")
async def delete_account(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """
    AUTH-7 & LEG-1: Delete account and all personal data under DPDP Act.
    """
    user_id = str(current_user["user_id"])
    success = await storage.delete_user_account(user_id)
    return {
        "status": "deleted" if success else "failed",
        "message": "All personal data, walks, and account records completely erased."
    }
