"""Central runtime configuration, read once from environment variables.

Production refuses to start with insecure defaults; development keeps working
out of the box but logs loudly about what it is faking.
"""
import os
import logging

logger = logging.getLogger("shield-settings")


def _load_dotenv() -> None:
    """Reads backend/.env for local runs. Real environment variables always win; empty values are ignored."""
    path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.environ.get("SHIELD_SKIP_DOTENV") or not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if value:
                os.environ.setdefault(key.strip(), value)


_load_dotenv()

ENV = os.environ.get("SHIELD_ENV", "development").lower()  # development | test | production
IS_PROD = ENV == "production"


def _flag(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


_DEV_SECRET = "dev-only-insecure-jwt-secret-do-not-deploy"
JWT_SECRET = os.environ.get("JWT_SECRET") or ""
if not JWT_SECRET:
    if IS_PROD:
        raise RuntimeError("JWT_SECRET must be set when SHIELD_ENV=production")
    JWT_SECRET = _DEV_SECRET
    logger.warning("JWT_SECRET not set; using the insecure development secret")
elif IS_PROD and len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET must be at least 32 characters in production")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS = int(os.environ.get("REFRESH_TOKEN_DAYS", "30"))

# Demo mode returns the OTP in the API response instead of sending an SMS.
DEMO_MODE = _flag("SHIELD_DEMO_MODE", default=not IS_PROD)
if IS_PROD and DEMO_MODE:
    raise RuntimeError("SHIELD_DEMO_MODE cannot be enabled in production")

BCRYPT_ROUNDS = int(os.environ.get("BCRYPT_ROUNDS", "12"))
if IS_PROD and BCRYPT_ROUNDS < 12:
    raise RuntimeError("BCRYPT_ROUNDS must be at least 12 in production")

# Background sweep that escalates unacknowledged alerts (ALERT-8). One API process
# should run it; disable on extra replicas until it moves to a dedicated worker.
ESCALATION_LOOP = _flag("SHIELD_ESCALATION_LOOP", default=True)

OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5

CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:8000,http://localhost:8081,http://localhost:19006"
    ).split(",")
    if o.strip()
]
if IS_PROD and "*" in CORS_ORIGINS:
    raise RuntimeError("CORS_ORIGINS cannot contain '*' in production")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6380/0")
DB_PATH = os.environ.get("SHIELD_DB_PATH")  # None -> backend/db/shield.db
EVIDENCE_DIR = os.environ.get(
    "SHIELD_EVIDENCE_DIR", os.path.join(os.path.dirname(__file__), "..", "secure_storage")
)
MAX_EVIDENCE_CHUNK_BYTES = 8 * 1024 * 1024

# SMS delivery (Twilio). When unset, notifications are logged instead of sent.
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_PHONE_NUMBER", "")
PUBLIC_APP_URL = os.environ.get("PUBLIC_APP_URL", "http://localhost:8000").rstrip("/")

# Email for verification codes (sign-up, password reset, SOS PIN change). Works with Gmail:
# SMTP_HOST=smtp.gmail.com, SMTP_PORT=587 and an App Password (Google Account > Security > App passwords).
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "") or SMTP_USERNAME
if IS_PROD and not (SMTP_HOST and MAIL_FROM):
    raise RuntimeError("SMTP_HOST and MAIL_FROM must be set in production: accounts are verified by email")

# Police integration.
# ERSS_MODE: off | mock | http. "http" posts alerts to the state's 112 ERSS endpoint once the
# integration is approved; "mock" records a fake incident id so the whole flow can be tested.
ERSS_MODE = os.environ.get("ERSS_MODE", "mock" if not IS_PROD else "off").lower()
ERSS_ENDPOINT = os.environ.get("ERSS_ENDPOINT", "")
ERSS_API_KEY = os.environ.get("ERSS_API_KEY", "")
ERSS_WEBHOOK_SECRET = os.environ.get("ERSS_WEBHOOK_SECRET", "")  # HMAC key for status callbacks from ERSS
if ERSS_MODE not in ("off", "mock", "http"):
    raise RuntimeError("ERSS_MODE must be off, mock or http")
if IS_PROD and ERSS_MODE == "mock":
    raise RuntimeError("ERSS_MODE=mock is for development only")
if ERSS_MODE == "http" and not (ERSS_ENDPOINT.startswith("https://") and ERSS_API_KEY and len(ERSS_WEBHOOK_SECRET) >= 32):
    raise RuntimeError("ERSS_MODE=http needs an https ERSS_ENDPOINT, ERSS_API_KEY and a 32+ char ERSS_WEBHOOK_SECRET")
# Alerts no station officer acknowledges within this window go to the control room
POLICE_ACK_SECONDS = int(os.environ.get("POLICE_ACK_SECONDS", "180"))
# Staff must use a TOTP second factor; can be relaxed only outside production
STAFF_TOTP_REQUIRED = _flag("STAFF_TOTP_REQUIRED", default=True)
if IS_PROD and not STAFF_TOTP_REQUIRED:
    raise RuntimeError("STAFF_TOTP_REQUIRED cannot be disabled in production")
# Location trails and unconsented evidence of closed alerts are deleted after this many days
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "90"))

# Secret for pseudonymising user ids in community data (ratings, hazards); derived from the JWT secret if unset.
PSEUDONYM_SECRET = os.environ.get("PSEUDONYM_SECRET", "") or JWT_SECRET

# CARTO basemaps. Tile keys are visible to every browser that loads the map, so
# restrict this key to your domains in the CARTO dashboard.
CARTO_API_KEY = os.environ.get("CARTO_API_KEY", "")

# Routers that need PostgreSQL/PostGIS (community buddy matching, contextual risk).
POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "")
