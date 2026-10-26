import os
import json
import time
import math
import uuid
import hashlib
import hmac
import secrets
import aiosqlite
import logging
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

logger = logging.getLogger("shield-storage")

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two points in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def point_to_segment_distance(plat: float, plon: float, s_lat1: float, s_lon1: float, s_lat2: float, s_lon2: float) -> float:
    """Approximate distance in meters from point P to line segment S1-S2."""
    d1 = haversine_distance(plat, plon, s_lat1, s_lon1)
    d2 = haversine_distance(plat, plon, s_lat2, s_lon2)
    segment_length = haversine_distance(s_lat1, s_lon1, s_lat2, s_lon2)
    if segment_length < 1e-6:
        return d1

    # Project P onto S1-S2
    dx = s_lon2 - s_lon1
    dy = s_lat2 - s_lat1
    t = ((plon - s_lon1) * dx + (plat - s_lat1) * dy) / (dx * dx + dy * dy + 1e-12)
    t = max(0.0, min(1.0, t))
    proj_lat = s_lat1 + t * dy
    proj_lon = s_lon1 + t * dx
    return haversine_distance(plat, plon, proj_lat, proj_lon)

class ShieldStorage:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = os.environ.get("SHIELD_DB_PATH") or os.path.join(os.path.dirname(__file__), "shield.db")
        self.db_path = os.path.abspath(db_path)
        self._initialized = False

    @asynccontextmanager
    async def _connect(self):
        """Opens a connection with foreign keys enforced (SQLite leaves them off by default)."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys=ON;")
            yield db

    async def ping(self) -> bool:
        try:
            async with self._connect() as db:
                await db.execute("SELECT 1")
            return True
        except Exception:
            return False

    async def ensure_initialized(self):
        if not self._initialized:
            await self.init_db()

    async def init_db(self):
        """Initializes tables in SQLite for standalone and test operation."""
        if self._initialized:
            return

        async with self._connect() as db:
            await db.execute("PRAGMA journal_mode=WAL;")
            
            # Users
            await db.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    phone_number TEXT UNIQUE NOT NULL,
                    name TEXT DEFAULT 'Walker',
                    hashed_pin TEXT NOT NULL,
                    duress_pin TEXT,
                    public_key TEXT,
                    device_id TEXT,
                    expo_push_token TEXT,
                    language TEXT DEFAULT 'en',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # Guardians
            await db.execute("""
                CREATE TABLE IF NOT EXISTS guardians (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    priority INTEGER DEFAULT 1,
                    verified INTEGER DEFAULT 0,
                    public_key TEXT,
                    key_fingerprint TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE(user_id, phone)
                );
            """)

            # Walks
            await db.execute("""
                CREATE TABLE IF NOT EXISTS walks (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    origin_name TEXT,
                    destination_name TEXT,
                    route_json TEXT,
                    chosen_route_id TEXT,
                    safety_score REAL,
                    fastest_time_seconds INTEGER,
                    status TEXT DEFAULT 'ACTIVE',
                    shared_with TEXT DEFAULT '[]',
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    end_time TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)

            # Walk Points
            await db.execute("""
                CREATE TABLE IF NOT EXISTS walk_points (
                    id TEXT PRIMARY KEY,
                    walk_id TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    speed REAL DEFAULT 0.0,
                    accuracy REAL DEFAULT 5.0,
                    heading REAL DEFAULT 0.0,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(walk_id) REFERENCES walks(id) ON DELETE CASCADE
                );
            """)

            # Alerts
            await db.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    walk_id TEXT,
                    trigger_type TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'PRE_ALERT',
                    priority TEXT DEFAULT 'HIGH',
                    lat REAL,
                    lon REAL,
                    audio_path TEXT,
                    battery_level REAL,
                    network_strength TEXT DEFAULT 'ONLINE',
                    started_at TIMESTAMP NOT NULL,
                    resolved_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)

            # Alert Events
            await db.execute("""
                CREATE TABLE IF NOT EXISTS alert_events (
                    id TEXT PRIMARY KEY,
                    alert_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    meta TEXT DEFAULT '{}',
                    FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
                );
            """)

            # Evidence Chunks
            await db.execute("""
                CREATE TABLE IF NOT EXISTS evidence_chunks (
                    id TEXT PRIMARY KEY,
                    alert_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    prev_sha256 TEXT NOT NULL,
                    storage_key TEXT NOT NULL,
                    wrapped_keys TEXT NOT NULL,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
                );
            """)

            # Segments
            await db.execute("""
                CREATE TABLE IF NOT EXISTS segments (
                    id TEXT PRIMARY KEY,
                    osm_way_id INTEGER,
                    name TEXT,
                    coordinates_json TEXT NOT NULL,
                    length_m REAL NOT NULL,
                    lamp_density REAL DEFAULT 0.0,
                    activity_index REAL DEFAULT 0.0,
                    community_rating REAL DEFAULT 0.5,
                    rating_count INTEGER DEFAULT 0,
                    static_score REAL DEFAULT 60.0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # Ratings
            await db.execute("""
                CREATE TABLE IF NOT EXISTS ratings (
                    id TEXT PRIMARY KEY,
                    walk_id TEXT,
                    segment_id TEXT NOT NULL,
                    user_hash TEXT NOT NULL,
                    lit INTEGER NOT NULL,
                    busy INTEGER NOT NULL,
                    felt_safe INTEGER NOT NULL,
                    note TEXT,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(segment_id) REFERENCES segments(id) ON DELETE CASCADE
                );
            """)

            # Hazards
            await db.execute("""
                CREATE TABLE IF NOT EXISTS hazards (
                    id TEXT PRIMARY KEY,
                    user_hash TEXT,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    category TEXT NOT NULL,
                    description TEXT,
                    photo_key TEXT,
                    status TEXT DEFAULT 'ACTIVE',
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # Safe Stops
            await db.execute("""
                CREATE TABLE IF NOT EXISTS safe_stops (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    hours TEXT DEFAULT '24/7',
                    verified INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # Audit Log
            await db.execute("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id TEXT PRIMARY KEY,
                    actor TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target TEXT NOT NULL,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # False Alarm Feedback
            await db.execute("""
                CREATE TABLE IF NOT EXISTS false_alarm_feedback (
                    id TEXT PRIMARY KEY,
                    alert_id TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
                );
            """)

            # One-time WS Tickets
            await db.execute("""
                CREATE TABLE IF NOT EXISTS ws_tickets (
                    ticket TEXT PRIMARY KEY,
                    walk_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    used INTEGER DEFAULT 0
                );
            """)

            # Live location during an SOS that is not tied to a planned walk
            await db.execute("""
                CREATE TABLE IF NOT EXISTS alert_points (
                    id TEXT PRIMARY KEY,
                    alert_id TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    accuracy REAL,
                    speed REAL,
                    heading REAL,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
                );
            """)
            await db.execute("CREATE INDEX IF NOT EXISTS idx_alert_points_alert ON alert_points(alert_id, ts);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_walk_points_walk ON walk_points(walk_id, ts);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_guardians_phone ON guardians(phone);")

            # One-time codes sent by email or SMS, keyed "<channel>:<purpose>:<address>"; only hashes are stored
            await db.execute("""
                CREATE TABLE IF NOT EXISTS verification_codes (
                    code_key TEXT PRIMARY KEY,
                    code_hash TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    attempts INTEGER DEFAULT 0
                );
            """)

            # Refresh tokens by id, so a session can be revoked and a replayed (stolen) token detected
            await db.execute("""
                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    jti TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    revoked INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)
            await db.execute("CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);")

            # "I should be safe by HH:MM" timers; the server alerts guardians if one runs out
            await db.execute("""
                CREATE TABLE IF NOT EXISTS checkin_timers (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    label TEXT,
                    due_at REAL NOT NULL,
                    state TEXT NOT NULL DEFAULT 'ACTIVE',
                    lat REAL,
                    lon REAL,
                    alert_id TEXT,
                    created_at REAL NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)
            await db.execute("CREATE INDEX IF NOT EXISTS idx_checkin_due ON checkin_timers(state, due_at);")

            # Read-only tracking links sent to guardians by SMS (no app needed); only token hashes are stored
            await db.execute("""
                CREATE TABLE IF NOT EXISTS share_links (
                    token_hash TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    created_at REAL NOT NULL
                );
            """)

            # Additive migrations for databases created before these columns existed
            await self._ensure_column(db, "users", "role", "TEXT NOT NULL DEFAULT 'walker'")
            await self._ensure_column(db, "users", "failed_logins", "INTEGER NOT NULL DEFAULT 0")
            await self._ensure_column(db, "users", "locked_until", "REAL NOT NULL DEFAULT 0")
            await self._ensure_column(db, "users", "email", "TEXT")
            await self._ensure_column(db, "users", "email_verified", "INTEGER NOT NULL DEFAULT 0")
            await self._ensure_column(db, "users", "phone_verified", "INTEGER NOT NULL DEFAULT 0")
            await self._ensure_column(db, "users", "password_hash", "TEXT")
            # Bumped on password reset / "sign out everywhere"; access tokens carry it and die with it
            await self._ensure_column(db, "users", "token_version", "INTEGER NOT NULL DEFAULT 0")
            # SOS PIN brute-force protection, separate from login failures
            await self._ensure_column(db, "users", "pin_failures", "INTEGER NOT NULL DEFAULT 0")
            await self._ensure_column(db, "users", "pin_locked_until", "REAL NOT NULL DEFAULT 0")
            await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;")
            await self._ensure_column(db, "walks", "mode", "TEXT NOT NULL DEFAULT 'walk'")  # walk | ride
            await self._ensure_column(db, "walks", "vehicle_plate", "TEXT")

            await db.commit()

        self._initialized = True
        logger.info(f"Storage initialized at {self.db_path}")
        await self.seed_pilot_area()

    @staticmethod
    async def _ensure_column(db, table: str, column: str, ddl: str) -> None:
        cursor = await db.execute(f"PRAGMA table_info({table})")
        if column not in {row[1] for row in await cursor.fetchall()}:
            await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    async def record_login_result(self, user_id: str, success: bool, max_failures: int = 5,
                                  lock_seconds: int = 900) -> None:
        """Per-account brute-force protection: lock after `max_failures` wrong PINs."""
        async with self._connect() as db:
            if success:
                await db.execute("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?", (user_id,))
            else:
                await db.execute(
                    """
                    UPDATE users SET failed_logins = failed_logins + 1,
                        locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END
                    WHERE id = ?
                    """,
                    (max_failures, time.time() + lock_seconds, user_id),
                )
            await db.commit()

    async def set_push_token(self, user_id: str, token: str) -> None:
        async with self._connect() as db:
            await db.execute("UPDATE users SET expo_push_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (token, user_id))
            await db.commit()

    async def set_user_role(self, user_id: str, role: str) -> None:
        async with self._connect() as db:
            await db.execute("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (role, user_id))
            await db.commit()

    # One-time codes (AUTH-1): email and SMS verification
    @staticmethod
    def _hash_code(code_key: str, code: str) -> str:
        return hashlib.sha256(f"{code_key}:{code}".encode()).hexdigest()

    async def store_code(self, code_key: str, code: str, ttl_seconds: int, resend_after_seconds: int = 30) -> bool:
        """Stores a fresh code, replacing any earlier one. False if one was issued less than `resend_after_seconds` ago."""
        now = time.time()
        async with self._connect() as db:
            cursor = await db.execute("SELECT created_at FROM verification_codes WHERE code_key = ?", (code_key,))
            row = await cursor.fetchone()
            if row and now - row[0] < resend_after_seconds:
                return False
            await db.execute(
                """
                INSERT INTO verification_codes (code_key, code_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)
                ON CONFLICT(code_key) DO UPDATE SET
                    code_hash = excluded.code_hash, created_at = excluded.created_at,
                    expires_at = excluded.expires_at, attempts = 0
                """,
                (code_key, self._hash_code(code_key, code), now, now + ttl_seconds),
            )
            await db.commit()
        return True

    async def check_code(self, code_key: str, code: str, max_attempts: int) -> bool:
        """Constant-time check; the code is burned on success and after too many failures."""
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT code_hash, expires_at, attempts FROM verification_codes WHERE code_key = ?", (code_key,)
            )
            row = await cursor.fetchone()
            if not row:
                return False
            code_hash, expires_at, attempts = row
            ok = (
                expires_at > time.time()
                and attempts < max_attempts
                and hmac.compare_digest(code_hash, self._hash_code(code_key, code))
            )
            if ok or attempts + 1 >= max_attempts:
                await db.execute("DELETE FROM verification_codes WHERE code_key = ?", (code_key,))
            else:
                await db.execute("UPDATE verification_codes SET attempts = attempts + 1 WHERE code_key = ?", (code_key,))
            await db.commit()
            return ok

    # Refresh-token sessions
    async def add_refresh_token(self, jti: str, user_id: str, expires_at: float) -> None:
        async with self._connect() as db:
            await db.execute("INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)",
                             (jti, user_id, expires_at))
            await db.commit()

    async def consume_refresh_token(self, jti: str, user_id: str) -> str:
        """Marks a refresh token used. Returns "ok", "reused" (already revoked: likely stolen) or "unknown"."""
        async with self._connect() as db:
            cursor = await db.execute("SELECT revoked, expires_at FROM refresh_tokens WHERE jti = ? AND user_id = ?",
                                      (jti, user_id))
            row = await cursor.fetchone()
            if not row or row[1] < time.time():
                return "unknown"
            if row[0]:
                return "reused"
            await db.execute("UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?", (jti,))
            await db.commit()
            return "ok"

    async def revoke_refresh_token(self, jti: str, user_id: str) -> None:
        async with self._connect() as db:
            await db.execute("UPDATE refresh_tokens SET revoked = 1 WHERE jti = ? AND user_id = ?", (jti, user_id))
            await db.commit()

    async def revoke_all_sessions(self, user_id: str) -> None:
        """Signs the account out everywhere: every refresh token and every outstanding access token."""
        async with self._connect() as db:
            await db.execute("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?", (user_id,))
            await db.execute("UPDATE users SET token_version = token_version + 1 WHERE id = ?", (user_id,))
            await db.execute("DELETE FROM refresh_tokens WHERE expires_at < ?", (time.time(),))
            await db.commit()

    async def record_pin_result(self, user_id: str, success: bool, lock_after: int, lock_seconds: int) -> int:
        """SOS PIN attempts; returns consecutive failures so far (0 after a success)."""
        async with self._connect() as db:
            if success:
                await db.execute("UPDATE users SET pin_failures = 0, pin_locked_until = 0 WHERE id = ?", (user_id,))
                await db.commit()
                return 0
            await db.execute(
                """
                UPDATE users SET pin_failures = pin_failures + 1,
                    pin_locked_until = CASE WHEN pin_failures + 1 >= ? THEN ? ELSE pin_locked_until END
                WHERE id = ?
                """,
                (lock_after, time.time() + lock_seconds, user_id),
            )
            await db.commit()
            cursor = await db.execute("SELECT pin_failures FROM users WHERE id = ?", (user_id,))
            return (await cursor.fetchone())[0]

    async def set_password(self, user_id: str, password_hash: str) -> None:
        async with self._connect() as db:
            await db.execute(
                "UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (password_hash, user_id),
            )
            await db.commit()

    # User Management
    async def create_user(self, phone_number: str, hashed_pin: str, duress_pin: Optional[str] = None, name: str = "Walker",
                          public_key: Optional[str] = None, device_id: Optional[str] = None,
                          email: Optional[str] = None, password_hash: Optional[str] = None,
                          verified: bool = False) -> Dict[str, Any]:
        """`verified`: the email and phone were both proven with one-time codes before this call."""
        user_id = str(uuid.uuid4())
        async with self._connect() as db:
            await db.execute(
                """
                INSERT INTO users (id, phone_number, name, hashed_pin, duress_pin, public_key, device_id,
                                   email, password_hash, email_verified, phone_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, phone_number, name, hashed_pin, duress_pin, public_key, device_id,
                 email, password_hash, int(verified), int(verified))
            )
            await db.commit()
        return await self.get_user_by_id(user_id)

    async def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM users WHERE email = ?", (email,))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def get_user_by_phone(self, phone_number: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM users WHERE phone_number = ?", (phone_number,))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def update_user_pins(self, user_id: str, hashed_pin: Optional[str], duress_pin: Optional[str]) -> bool:
        async with self._connect() as db:
            updates = []
            vals = []
            if hashed_pin:
                updates.append("hashed_pin = ?")
                vals.append(hashed_pin)
            if duress_pin:
                updates.append("duress_pin = ?")
                vals.append(duress_pin)
            if not updates:
                return False
            updates.append("updated_at = CURRENT_TIMESTAMP")
            vals.append(user_id)
            await db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(vals))
            await db.commit()
            return True

    async def delete_user_account(self, user_id: str) -> bool:
        """AUTH-7: Complete account and personal data deletion."""
        async with self._connect() as db:
            await db.execute("DELETE FROM walk_points WHERE walk_id IN (SELECT id FROM walks WHERE user_id = ?)", (user_id,))
            await db.execute("DELETE FROM walks WHERE user_id = ?", (user_id,))
            await db.execute("DELETE FROM alert_events WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = ?)", (user_id,))
            await db.execute("DELETE FROM alert_points WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = ?)", (user_id,))
            await db.execute("DELETE FROM false_alarm_feedback WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = ?)", (user_id,))
            await db.execute("DELETE FROM evidence_chunks WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = ?)", (user_id,))
            await db.execute("DELETE FROM ws_tickets WHERE user_id = ?", (user_id,))
            await db.execute("DELETE FROM refresh_tokens WHERE user_id = ?", (user_id,))
            await db.execute("DELETE FROM checkin_timers WHERE user_id = ?", (user_id,))
            await db.execute("DELETE FROM share_links WHERE target_id IN (SELECT id FROM alerts WHERE user_id = ?) OR target_id IN (SELECT id FROM walks WHERE user_id = ?)", (user_id, user_id))
            await db.execute("DELETE FROM alerts WHERE user_id = ?", (user_id,))
            await db.execute("DELETE FROM guardians WHERE user_id = ?", (user_id,))
            await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            await db.commit()
            return True

    # Guardian Management
    async def get_guardians(self, user_id: str) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM guardians WHERE user_id = ? ORDER BY priority ASC, created_at ASC",
                (user_id,)
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def add_or_update_guardian(self, user_id: str, name: str, phone: str, priority: int = 1, public_key: Optional[str] = None) -> Dict[str, Any]:
        # Generate fingerprint (GRD-3)
        fingerprint = uuid.uuid5(uuid.NAMESPACE_DNS, f"{phone}:{public_key or 'default'}").hex[:16].upper()
        async with self._connect() as db:
            # Check existing count limit (max 5 guardians - GRD-1)
            cursor = await db.execute("SELECT COUNT(*) FROM guardians WHERE user_id = ?", (user_id,))
            (count,) = await cursor.fetchone()
            
            # Check if this phone already exists
            cursor = await db.execute("SELECT id FROM guardians WHERE user_id = ? AND phone = ?", (user_id, phone))
            existing = await cursor.fetchone()
            
            if not existing and count >= 5:
                raise ValueError("Maximum 5 guardians allowed per walker (GRD-1).")

            guardian_id = existing[0] if existing else str(uuid.uuid4())
            await db.execute(
                """
                INSERT INTO guardians (id, user_id, name, phone, priority, public_key, key_fingerprint, verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(user_id, phone) DO UPDATE SET
                    name = excluded.name,
                    priority = excluded.priority,
                    public_key = excluded.public_key,
                    key_fingerprint = excluded.key_fingerprint
                """,
                (guardian_id, user_id, name, phone, priority, public_key, fingerprint)
            )
            await db.commit()

        return {
            "id": guardian_id,
            "user_id": user_id,
            "name": name,
            "phone": phone,
            "priority": priority,
            "verified": False,
            "public_key": public_key,
            "key_fingerprint": fingerprint
        }

    async def verify_guardian(self, guardian_id: str, guardian_phone: str) -> bool:
        """GRD-2: only the invited phone number can accept the invitation."""
        async with self._connect() as db:
            cursor = await db.execute(
                "UPDATE guardians SET verified = 1 WHERE id = ? AND phone = ?", (guardian_id, guardian_phone)
            )
            await db.commit()
            return cursor.rowcount > 0

    async def get_guardianships(self, guardian_phone: str) -> List[Dict[str, Any]]:
        """Verified guardian links where this phone number protects some walker."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM guardians WHERE phone = ? AND verified = 1", (guardian_phone,)
            )
            return [dict(r) for r in await cursor.fetchall()]

    async def get_user_alert_ids(self, user_id: str) -> List[str]:
        async with self._connect() as db:
            cursor = await db.execute("SELECT id FROM alerts WHERE user_id = ?", (user_id,))
            return [r[0] for r in await cursor.fetchall()]

    async def delete_guardian(self, guardian_id: str, user_id: str) -> bool:
        async with self._connect() as db:
            cursor = await db.execute("DELETE FROM guardians WHERE id = ? AND user_id = ?", (guardian_id, user_id))
            await db.commit()
            return cursor.rowcount > 0

    # Walks & Live Tracking
    async def create_walk(self, user_id: str, origin_name: str, destination_name: str, chosen_route_id: str, route_coords: List[Dict[str, float]], safety_score: float, fastest_time_seconds: int, shared_with: List[str],
                          mode: str = "walk", vehicle_plate: Optional[str] = None) -> Dict[str, Any]:
        walk_id = str(uuid.uuid4())
        route_json = json.dumps(route_coords)
        shared_json = json.dumps(shared_with)
        async with self._connect() as db:
            await db.execute(
                """
                INSERT INTO walks (id, user_id, origin_name, destination_name, route_json, chosen_route_id, safety_score, fastest_time_seconds, shared_with, status, mode, vehicle_plate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                """,
                (walk_id, user_id, origin_name, destination_name, route_json, chosen_route_id, safety_score, fastest_time_seconds, shared_json, mode, vehicle_plate)
            )
            await db.commit()
        return await self.get_walk(walk_id)

    async def get_walk(self, walk_id: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM walks WHERE id = ?", (walk_id,))
            row = await cursor.fetchone()
            if not row:
                return None
            data = dict(row)
            data["route"] = json.loads(data["route_json"]) if data.get("route_json") else []
            data["shared_with"] = json.loads(data["shared_with"]) if data.get("shared_with") else []
            return data

    async def add_walk_points(self, walk_id: str, points: List[Dict[str, Any]]) -> int:
        async with self._connect() as db:
            for p in points:
                pid = str(uuid.uuid4())
                await db.execute(
                    """
                    INSERT INTO walk_points (id, walk_id, lat, lon, speed, accuracy, heading, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (pid, walk_id, p["lat"], p["lon"], p.get("speed", 0.0), p.get("accuracy", 5.0), p.get("heading", 0.0), p.get("ts", datetime.utcnow().isoformat()))
                )
            await db.commit()
        return len(points)

    async def get_walk_trail(self, walk_id: str) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM walk_points WHERE walk_id = ? ORDER BY ts ASC", (walk_id,))
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def end_walk(self, walk_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            await db.execute(
                """
                UPDATE walks
                SET status = 'COMPLETED', end_time = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (walk_id, user_id)
            )
            await db.commit()
        return await self.get_walk(walk_id)

    # WS Ticket Authentication
    async def create_ws_ticket(self, walk_id: str, user_id: str, ttl_seconds: int = 60) -> str:
        ticket = f"wstk_{uuid.uuid4().hex}"
        expires_at = time.time() + ttl_seconds
        async with self._connect() as db:
            await db.execute(
                "INSERT INTO ws_tickets (ticket, walk_id, user_id, expires_at, used) VALUES (?, ?, ?, ?, 0)",
                (ticket, walk_id, user_id, expires_at)
            )
            await db.commit()
        return ticket

    async def consume_ws_ticket(self, ticket: str, walk_id: str) -> Optional[Dict[str, Any]]:
        now = time.time()
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM ws_tickets WHERE ticket = ? AND walk_id = ? AND used = 0 AND expires_at > ?",
                (ticket, walk_id, now)
            )
            row = await cursor.fetchone()
            if not row:
                return None
            # Mark ticket used (one-time ticket)
            await db.execute("UPDATE ws_tickets SET used = 1 WHERE ticket = ?", (ticket,))
            await db.commit()
            return dict(row)

    # Alert Management & Escalation
    async def sync_alert(self, alert_id: str, user_id: str, trigger_type: str, lat: float, lon: float, priority: str = "HIGH", walk_id: Optional[str] = None, initial_state: str = "ACTIVE") -> Dict[str, Any]:
        """Idempotent sync for offline and online alerts (ALERT-4, ALERT-7)."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,))
            existing = await cursor.fetchone()
            if existing:
                return {"status": "already_synced", "alert": dict(existing)}

            started_at = datetime.utcnow().isoformat()
            await db.execute(
                """
                INSERT INTO alerts (id, user_id, walk_id, trigger_type, state, priority, lat, lon, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (alert_id, user_id, walk_id, trigger_type, initial_state, priority, lat, lon, started_at)
            )
            # Log initial event
            event_id = str(uuid.uuid4())
            await db.execute(
                """
                INSERT INTO alert_events (id, alert_id, event_type, actor, meta)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event_id, alert_id, "TRIGGERED", "walker", json.dumps({"lat": lat, "lon": lon, "priority": priority}))
            )
            await db.commit()

        return {
            "status": "synced",
            "alert": {
                "id": alert_id,
                "user_id": user_id,
                "walk_id": walk_id,
                "trigger_type": trigger_type,
                "state": initial_state,
                "priority": priority,
                "lat": lat,
                "lon": lon,
                "started_at": started_at
            }
        }

    async def update_alert_state(self, alert_id: str, new_state: str, actor: str = "system", meta: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        valid_states = ["PRE_ALERT", "ACTIVE", "ACKNOWLEDGED", "ESCALATED", "RESOLVED", "FALSE_ALARM", "CANCELLED"]
        if new_state not in valid_states:
            raise ValueError(f"Invalid alert state {new_state}. Valid states: {valid_states}")

        resolved_at = datetime.utcnow().isoformat() if new_state in ["RESOLVED", "FALSE_ALARM", "CANCELLED"] else None

        async with self._connect() as db:
            await db.execute(
                """
                UPDATE alerts
                SET state = ?, resolved_at = COALESCE(?, resolved_at), updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (new_state, resolved_at, alert_id)
            )
            # Log state transition event
            event_id = str(uuid.uuid4())
            await db.execute(
                """
                INSERT INTO alert_events (id, alert_id, event_type, actor, meta)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event_id, alert_id, new_state, actor, json.dumps(meta or {}))
            )
            await db.commit()

        return await self.get_alert_by_id(alert_id)

    async def get_alert_by_id(self, alert_id: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,))
            row = await cursor.fetchone()
            if not row:
                return None
            data = dict(row)
            
            # Fetch events timeline
            cursor = await db.execute("SELECT * FROM alert_events WHERE alert_id = ? ORDER BY ts ASC", (alert_id,))
            events = [dict(r) for r in await cursor.fetchall()]
            data["events"] = events
            return data

    async def get_active_alerts(self) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT a.*, u.name as walker_name, u.phone_number as walker_phone
                FROM alerts a
                LEFT JOIN users u ON u.id = a.user_id
                WHERE a.state IN ('ACTIVE', 'PRE_ALERT', 'ESCALATED', 'ACKNOWLEDGED')
                ORDER BY a.started_at DESC
                """
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def get_unacknowledged_alerts(self, older_than_seconds: int) -> List[Dict[str, Any]]:
        """ACTIVE alerts nobody has acknowledged within the window (ALERT-8 escalation input)."""
        # started_at is stored as naive UTC ISO text, so compare against the same format
        cutoff = datetime.fromtimestamp(time.time() - older_than_seconds, timezone.utc).replace(tzinfo=None).isoformat()
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM alerts WHERE state = 'ACTIVE' AND started_at <= ? ORDER BY started_at ASC",
                (cutoff,),
            )
            return [dict(r) for r in await cursor.fetchall()]

    async def add_alert_point(self, alert_id: str, lat: float, lon: float, accuracy: Optional[float] = None,
                              speed: Optional[float] = None, heading: Optional[float] = None) -> Dict[str, Any]:
        point = {"id": str(uuid.uuid4()), "alert_id": alert_id, "lat": lat, "lon": lon, "accuracy": accuracy,
                 "speed": speed, "heading": heading, "ts": datetime.utcnow().isoformat()}
        async with self._connect() as db:
            await db.execute(
                "INSERT INTO alert_points (id, alert_id, lat, lon, accuracy, speed, heading, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (point["id"], alert_id, lat, lon, accuracy, speed, heading, point["ts"]),
            )
            await db.execute("UPDATE alerts SET lat = ?, lon = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (lat, lon, alert_id))
            await db.commit()
        return point

    async def get_alert_points(self, alert_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM (SELECT * FROM alert_points WHERE alert_id = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC",
                (alert_id, limit),
            )
            return [dict(r) for r in await cursor.fetchall()]

    async def get_last_evidence_chunk(self, alert_id: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT seq, sha256 FROM evidence_chunks WHERE alert_id = ? ORDER BY seq DESC LIMIT 1", (alert_id,)
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def record_false_alarm(self, alert_id: str, reason: str) -> bool:
        async with self._connect() as db:
            fid = str(uuid.uuid4())
            await db.execute("INSERT INTO false_alarm_feedback (id, alert_id, reason) VALUES (?, ?, ?)", (fid, alert_id, reason))
            await self.update_alert_state(alert_id, "FALSE_ALARM", actor="walker", meta={"reason": reason})
            await db.commit()
            return True

    # Evidence Chunks (EVID-1 to EVID-5)
    async def add_evidence_chunk(self, alert_id: str, seq: int, sha256: str, prev_sha256: str, storage_key: str, wrapped_keys: Dict[str, str]) -> Dict[str, Any]:
        chunk_id = str(uuid.uuid4())
        wrapped_json = json.dumps(wrapped_keys)
        async with self._connect() as db:
            await db.execute(
                """
                INSERT INTO evidence_chunks (id, alert_id, seq, sha256, prev_sha256, storage_key, wrapped_keys)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (chunk_id, alert_id, seq, sha256, prev_sha256, storage_key, wrapped_json)
            )
            await db.commit()
        return {
            "id": chunk_id,
            "alert_id": alert_id,
            "seq": seq,
            "sha256": sha256,
            "prev_sha256": prev_sha256,
            "storage_key": storage_key,
            "ts": datetime.utcnow().isoformat()
        }

    async def get_evidence_chunks(self, alert_id: str) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM evidence_chunks WHERE alert_id = ? ORDER BY seq ASC", (alert_id,))
            rows = await cursor.fetchall()
            res = []
            for r in rows:
                d = dict(r)
                d["wrapped_keys"] = json.loads(d["wrapped_keys"]) if d.get("wrapped_keys") else {}
                res.append(d)
            return res

    # Segments & Route Scoring Support
    async def get_all_segments(self) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM segments")
            rows = await cursor.fetchall()
            res = []
            for r in rows:
                d = dict(r)
                d["coordinates"] = json.loads(d["coordinates_json"]) if d.get("coordinates_json") else []
                res.append(d)
            return res

    async def get_safe_stops(self) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM safe_stops WHERE verified = 1")
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def add_rating(self, segment_id: str, user_hash: str, lit: bool, busy: bool, felt_safe: bool, walk_id: Optional[str] = None, note: Optional[str] = None) -> Dict[str, Any]:
        # Check daily limit (max 20 ratings per day - RATE-3)
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT COUNT(*) FROM ratings WHERE user_hash = ? AND ts >= datetime('now', '-1 day')",
                (user_hash,)
            )
            (daily_count,) = await cursor.fetchone()
            if daily_count >= 20:
                raise ValueError("Daily rating limit of 20 reached (RATE-3).")

            cursor = await db.execute("SELECT 1 FROM segments WHERE id = ?", (segment_id,))
            if not await cursor.fetchone():
                raise LookupError(f"Unknown segment '{segment_id}'.")

            # Check 1 rating per segment per walk (RATE-3)
            if walk_id:
                cursor = await db.execute(
                    "SELECT COUNT(*) FROM ratings WHERE walk_id = ? AND segment_id = ?",
                    (walk_id, segment_id)
                )
                (walk_seg_count,) = await cursor.fetchone()
                if walk_seg_count > 0:
                    raise ValueError("Already submitted rating for this segment on this walk.")

            rid = str(uuid.uuid4())
            await db.execute(
                """
                INSERT INTO ratings (id, walk_id, segment_id, user_hash, lit, busy, felt_safe, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (rid, walk_id, segment_id, user_hash, int(lit), int(busy), int(felt_safe), note)
            )

            # Update segment community rating using Bayesian shrunk mean (Section 6.1):
            # R = (n * mean + k * prior) / (n + k), where k=5, prior=0.5
            cursor = await db.execute(
                "SELECT COUNT(*), AVG(felt_safe) FROM ratings WHERE segment_id = ?",
                (segment_id,)
            )
            n, mean_safe = await cursor.fetchone()
            k = 5.0
            prior = 0.5
            shrunk_mean = (float(n) * float(mean_safe) + k * prior) / (float(n) + k)

            await db.execute(
                "UPDATE segments SET community_rating = ?, rating_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (shrunk_mean, n, segment_id)
            )
            await db.commit()

        return {"id": rid, "segment_id": segment_id, "new_community_rating": shrunk_mean, "rating_count": n}

    # Hazards (RATE-4)
    async def add_hazard(self, lat: float, lon: float, category: str, description: Optional[str] = None, user_hash: Optional[str] = None, photo_key: Optional[str] = None) -> Dict[str, Any]:
        hid = str(uuid.uuid4())
        async with self._connect() as db:
            await db.execute(
                """
                INSERT INTO hazards (id, user_hash, lat, lon, category, description, photo_key, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
                """,
                (hid, user_hash, lat, lon, category, description, photo_key)
            )
            await db.commit()
        return {
            "id": hid,
            "lat": lat,
            "lon": lon,
            "category": category,
            "description": description,
            "status": "ACTIVE"
        }

    async def get_recent_hazards(self, days: int) -> List[Dict[str, Any]]:
        """Active hazard reports from the last `days` days (older reports stop affecting routes)."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM hazards WHERE status = 'ACTIVE' AND ts >= datetime('now', ?) ORDER BY ts DESC",
                (f"-{int(days)} days",),
            )
            return [dict(r) for r in await cursor.fetchall()]

    # Check-in timers
    async def create_checkin(self, user_id: str, label: Optional[str], due_at: float,
                             lat: Optional[float], lon: Optional[float]) -> Dict[str, Any]:
        timer_id = str(uuid.uuid4())
        async with self._connect() as db:
            # One running timer per person: a new one replaces the old
            await db.execute("UPDATE checkin_timers SET state = 'REPLACED' WHERE user_id = ? AND state = 'ACTIVE'", (user_id,))
            await db.execute(
                "INSERT INTO checkin_timers (id, user_id, label, due_at, lat, lon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (timer_id, user_id, label, due_at, lat, lon, time.time()),
            )
            await db.commit()
        return await self.get_checkin(timer_id)

    async def get_checkin(self, timer_id: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM checkin_timers WHERE id = ?", (timer_id,))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def get_active_checkin(self, user_id: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM checkin_timers WHERE user_id = ? AND state = 'ACTIVE' ORDER BY created_at DESC LIMIT 1",
                (user_id,))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def update_checkin(self, timer_id: str, **fields: Any) -> Optional[Dict[str, Any]]:
        allowed = {"state", "due_at", "lat", "lon", "alert_id"}
        cols = [k for k in fields if k in allowed]
        if cols:
            async with self._connect() as db:
                await db.execute(f"UPDATE checkin_timers SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?",
                                 (*[fields[c] for c in cols], timer_id))
                await db.commit()
        return await self.get_checkin(timer_id)

    async def get_overdue_checkins(self) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM checkin_timers WHERE state = 'ACTIVE' AND due_at <= ?", (time.time(),))
            return [dict(r) for r in await cursor.fetchall()]

    # Guardian tracking links
    async def create_share_link(self, kind: str, target_id: str, ttl_seconds: int) -> str:
        token = secrets.token_urlsafe(24)
        async with self._connect() as db:
            await db.execute("DELETE FROM share_links WHERE expires_at < ?", (time.time(),))
            await db.execute(
                "INSERT INTO share_links (token_hash, kind, target_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
                (hashlib.sha256(token.encode()).hexdigest(), kind, target_id, time.time() + ttl_seconds, time.time()),
            )
            await db.commit()
        return token

    async def resolve_share_link(self, token: str) -> Optional[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM share_links WHERE token_hash = ? AND expires_at > ?",
                                      (hashlib.sha256(token.encode()).hexdigest(), time.time()))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def get_active_hazards(self) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM hazards WHERE status = 'ACTIVE' ORDER BY ts DESC")
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    # Audit Log (DASH-6)
    async def log_audit(self, actor: str, action: str, target: str) -> None:
        async with self._connect() as db:
            aid = str(uuid.uuid4())
            await db.execute(
                "INSERT INTO audit_log (id, actor, action, target) VALUES (?, ?, ?, ?)",
                (aid, actor, action, target)
            )
            await db.commit()

    async def get_audit_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?", (limit,))
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    # Seed data helper
    async def seed_pilot_area(self):
        """Seeds realistic pilot area segments, safe stops, and ratings."""
        async with self._connect() as db:
            cursor = await db.execute("SELECT COUNT(*) FROM segments")
            (count,) = await cursor.fetchone()
            if count > 0:
                return

            # Pilot Area: Central Delhi / University Campus corridor (approx 28.6900, 77.2100)
            base_lat = 28.6910
            base_lon = 77.2120

            sample_segments = [
                {
                    "id": "seg_univ_main_ave",
                    "osm_way_id": 1001,
                    "name": "University Main Avenue",
                    "coordinates": [[base_lon, base_lat], [base_lon + 0.003, base_lat + 0.001], [base_lon + 0.006, base_lat + 0.002]],
                    "length_m": 650.0,
                    "lamp_density": 3.8,  # Well-lit boulevard (L = 1.0)
                    "activity_index": 5.0, # Active student shops & cafes (A = 1.0)
                    "community_rating": 0.88,
                    "rating_count": 24,
                    "static_score": 85.0
                },
                {
                    "id": "seg_hostel_ring_road",
                    "osm_way_id": 1002,
                    "name": "Hostel Ring Road",
                    "coordinates": [[base_lon + 0.006, base_lat + 0.002], [base_lon + 0.008, base_lat + 0.005], [base_lon + 0.010, base_lat + 0.008]],
                    "length_m": 720.0,
                    "lamp_density": 2.2,  # Moderate lighting (L = 0.73)
                    "activity_index": 2.0, # Medium evening transit (A = 0.5)
                    "community_rating": 0.75,
                    "rating_count": 12,
                    "static_score": 72.0
                },
                {
                    "id": "seg_north_ridge_cutoff",
                    "osm_way_id": 1003,
                    "name": "Ridge Cutoff Path",
                    "coordinates": [[base_lon + 0.003, base_lat + 0.001], [base_lon + 0.005, base_lat + 0.006], [base_lon + 0.010, base_lat + 0.008]],
                    "length_m": 580.0,
                    "lamp_density": 0.3,  # Poor lighting: broken lamps (L = 0.1) -> Caution segment!
                    "activity_index": 0.0, # Desolate stretch after dark (A = 0.0)
                    "community_rating": 0.25,
                    "rating_count": 8,
                    "static_score": 32.0  # <40: Caution segment
                },
                {
                    "id": "seg_metro_connector",
                    "osm_way_id": 1004,
                    "name": "Metro Station Connector",
                    "coordinates": [[base_lon, base_lat], [base_lon + 0.002, base_lat - 0.003], [base_lon + 0.005, base_lat - 0.004]],
                    "length_m": 510.0,
                    "lamp_density": 3.2,
                    "activity_index": 6.0, # Busy transit hub
                    "community_rating": 0.82,
                    "rating_count": 30,
                    "static_score": 82.0
                },
                {
                    "id": "seg_back_alley_lane",
                    "osm_way_id": 1005,
                    "name": "Old Library Back Lane",
                    "coordinates": [[base_lon + 0.005, base_lat - 0.004], [base_lon + 0.008, base_lat - 0.002], [base_lon + 0.010, base_lat + 0.008]],
                    "length_m": 620.0,
                    "lamp_density": 0.8,
                    "activity_index": 1.0,
                    "community_rating": 0.35,
                    "rating_count": 6,
                    "static_score": 38.0  # <40: Caution segment
                }
            ]

            for s in sample_segments:
                await db.execute(
                    """
                    INSERT INTO segments (id, osm_way_id, name, coordinates_json, length_m, lamp_density, activity_index, community_rating, rating_count, static_score)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (s["id"], s["osm_way_id"], s["name"], json.dumps(s["coordinates"]), s["length_m"], s["lamp_density"], s["activity_index"], s["community_rating"], s["rating_count"], s["static_score"])
                )

            # Safe stops
            sample_stops = [
                {
                    "id": "stop_campus_police",
                    "name": "Campus Security Post & Police Booth",
                    "type": "POLICE",
                    "lat": base_lat + 0.002,
                    "lon": base_lon + 0.003,
                    "hours": "24/7"
                },
                {
                    "id": "stop_health_center",
                    "name": "University Hospital & Emergency",
                    "type": "HOSPITAL",
                    "lat": base_lat + 0.007,
                    "lon": base_lon + 0.007,
                    "hours": "24/7"
                },
                {
                    "id": "stop_apollo_pharmacy",
                    "name": "Apollo 24/7 Pharmacy",
                    "type": "PHARMACY_24H",
                    "lat": base_lat - 0.001,
                    "lon": base_lon + 0.002,
                    "hours": "24/7"
                },
                {
                    "id": "stop_metro_safe_partner",
                    "name": "Metro Helpdesk & Verified Shop",
                    "type": "VERIFIED_PARTNER",
                    "lat": base_lat - 0.003,
                    "lon": base_lon + 0.004,
                    "hours": "05:00-00:30"
                }
            ]

            for st in sample_stops:
                await db.execute(
                    """
                    INSERT INTO safe_stops (id, name, type, lat, lon, hours, verified)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                    """,
                    (st["id"], st["name"], st["type"], st["lat"], st["lon"], st["hours"])
                )

            # Sample active hazard
            await db.execute(
                """
                INSERT INTO hazards (id, user_hash, lat, lon, category, description, status)
                VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
                """,
                (str(uuid.uuid4()), "seed_hash", base_lat + 0.004, base_lon + 0.005, "broken_light", "Street lights dark between Physics block and Ridge gate")
            )

            await db.commit()
            logger.info("Pilot area seeded with realistic segments and safe stops.")

# Global storage instance
storage = ShieldStorage()
