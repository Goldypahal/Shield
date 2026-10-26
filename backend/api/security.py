import base64
import hashlib
import hmac
import os
import struct
import time
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

import settings
from db.storage import storage

SECRET_KEY = settings.JWT_SECRET
ALGORITHM = settings.JWT_ALGORITHM
ISSUER = "shield-api"

ROLES = ("walker", "responder", "admin")
STAFF_ROLES = ("responder", "admin")

security_scheme = HTTPBearer()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """bcrypt check for short secrets (PINs)."""
    try:
        pwd_bytes = str(plain_password).encode('utf-8')[:72]
        hash_bytes = str(hashed_password).encode('utf-8')
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    """bcrypt hash for short secrets (PINs)."""
    pwd_bytes = str(password).encode('utf-8')[:72]
    return bcrypt.hashpw(pwd_bytes, bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)).decode('utf-8')


def _prehash(password: str) -> str:
    # bcrypt ignores input past 72 bytes; a SHA-256 digest keeps every character of a long password significant.
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest()).decode("ascii")


def hash_account_password(password: str) -> str:
    return get_password_hash(_prehash(password))


def verify_account_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        # Same work as a real check, so a missing account cannot be told apart by timing
        verify_password(_prehash(password), DUMMY_HASH)
        return False
    return verify_password(_prehash(password), hashed)


DUMMY_HASH = get_password_hash("shield-dummy-password-for-timing")


# --- TOTP second factor for staff (RFC 6238: 30 s steps, 6 digits, HMAC-SHA1; works with any authenticator app)
TOTP_STEP = 30


def new_totp_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def totp_uri(secret: str, account: str, issuer: str = "SHIELD Command") -> str:
    from urllib.parse import quote
    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}&period={TOTP_STEP}&digits=6"


def totp_code(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def match_totp(secret: str, code: str, last_step: int, now: float | None = None) -> int | None:
    """The matching time step (current one, or one either side for clock drift), never one already used."""
    current = int((now if now is not None else time.time()) // TOTP_STEP)
    for step in (current - 1, current, current + 1):
        if step > last_step and hmac.compare_digest(totp_code(secret, step), code):
            return step
    return None


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Signs a JWT. `data` must carry `sub` and `type` ("access" or "refresh")."""
    to_encode = data.copy()
    to_encode.setdefault("type", "access")
    now = datetime.now(timezone.utc)
    to_encode.update({
        "iat": now,
        "exp": now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)),
        "iss": ISSUER,
    })
    to_encode.setdefault("jti", uuid.uuid4().hex)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def issue_token_pair(user: dict) -> dict:
    """Access token (short-lived, carries the session version) plus a refresh token recorded server-side."""
    access = create_access_token(
        {"sub": user["id"], "role": user.get("role", "walker"), "ver": user.get("token_version") or 0,
         "type": "access"},
        timedelta(minutes=settings.ACCESS_TOKEN_MINUTES),
    )
    jti = uuid.uuid4().hex
    refresh = create_access_token(
        {"sub": user["id"], "type": "refresh", "jti": jti},
        timedelta(days=settings.REFRESH_TOKEN_DAYS),
    )
    await storage.add_refresh_token(jti, user["id"], time.time() + settings.REFRESH_TOKEN_DAYS * 86400)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in_seconds": settings.ACCESS_TOKEN_MINUTES * 60,
    }


def decode_token(token: str, expected_type: str) -> dict:
    """Decodes and type-checks a JWT, raising 401 on any problem."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], issuer=ISSUER,
                             options={"require": ["exp", "iat", "sub", "iss"]})
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Expired or invalid token.", headers={"WWW-Authenticate": "Bearer"})
    if payload.get("type") != expected_type or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token type.", headers={"WWW-Authenticate": "Bearer"})
    return payload


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security_scheme)) -> dict:
    """
    Auth guard for protected routes. Accepts only access tokens (a refresh token
    is rejected) and re-reads the user so deleted accounts, role changes and
    "sign out everywhere" take effect immediately.
    """
    payload = decode_token(credentials.credentials, "access")
    user = await storage.get_user_by_id(payload["sub"])
    if not user or payload.get("ver", 0) != (user.get("token_version") or 0):
        raise HTTPException(status_code=401, detail="Session is no longer valid.", headers={"WWW-Authenticate": "Bearer"})
    return {"user_id": user["id"], "phone_number": user["phone_number"], "role": user.get("role") or "walker",
            "phone_verified": bool(user.get("phone_verified")), "station_id": user.get("station_id")}


def require_roles(*roles: str):
    """Dependency factory: `Depends(require_roles("responder", "admin"))`."""
    async def _guard(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role for this action.")
        return current_user
    return _guard


def is_staff(user: dict) -> bool:
    return user.get("role") in STAFF_ROLES
