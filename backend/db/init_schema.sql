-- Enable PostGIS extension for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable UUID extension for offline-generated unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: users (AUTH-1, AUTH-3, AUTH-4)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) DEFAULT 'Walker',
    hashed_pin VARCHAR(255) NOT NULL, -- PIN for normal unlock / cancel
    duress_pin VARCHAR(255),          -- Silent alarm duress PIN
    public_key TEXT,                  -- Base64 encoded public key for E2E audio encryption
    device_id VARCHAR(255),           -- For FCM push notifications
    expo_push_token TEXT,
    language VARCHAR(10) DEFAULT 'en', -- en, hi, pa
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table: guardians (GRD-1 to GRD-6)
CREATE TABLE IF NOT EXISTS guardians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    priority INT DEFAULT 1,           -- 1 to 5 priority order
    verified BOOLEAN DEFAULT FALSE,   -- Verified via SMS invitation link
    public_key TEXT,                  -- Guardian public key (for wrapping audio AES key)
    key_fingerprint VARCHAR(64),      -- Out-of-band verification fingerprint (GRD-3)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_guardians_user ON guardians(user_id, priority);

-- Table: walks (WALK-1 to WALK-8)
CREATE TABLE IF NOT EXISTS walks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    origin_name VARCHAR(255),
    destination_name VARCHAR(255),
    route geometry(LineString, 4326),
    chosen_route_id VARCHAR(50),
    safety_score FLOAT,
    fastest_time_seconds INT,
    status VARCHAR(30) DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, CANCELLED, SOS_ACTIVE
    shared_with JSONB DEFAULT '[]'::jsonb,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_walks_user ON walks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_walks_geom ON walks USING GIST(route);

-- Table: walk_points (WALK-2, WALK-3)
CREATE TABLE IF NOT EXISTS walk_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    walk_id UUID REFERENCES walks(id) ON DELETE CASCADE,
    geom geometry(Point, 4326) NOT NULL,
    speed FLOAT DEFAULT 0.0,
    accuracy FLOAT DEFAULT 5.0,
    heading FLOAT DEFAULT 0.0,
    ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_walk_points_walk_ts ON walk_points(walk_id, ts);
CREATE INDEX IF NOT EXISTS idx_walk_points_geom ON walk_points USING GIST(geom);

-- Table: alerts (ALERT-1 to ALERT-11, Section 6.3)
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY,                   -- Client-generated UUID (ALERT-4, ALERT-7)
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    walk_id UUID REFERENCES walks(id) ON DELETE SET NULL,
    trigger_type VARCHAR(50) NOT NULL,    -- SOS_BUTTON, AUDIO, MOTION, FALL, DEVIATION, DURESS_PIN, CHECKIN_TIMEOUT
    state VARCHAR(50) NOT NULL DEFAULT 'PRE_ALERT', -- PRE_ALERT, ACTIVE, ACKNOWLEDGED, ESCALATED, RESOLVED, FALSE_ALARM, CANCELLED
    priority VARCHAR(20) DEFAULT 'HIGH',   -- NORMAL, HIGH (duress is always HIGH)
    geom geometry(Point, 4326),            -- Last known / trigger coordinates
    audio_path VARCHAR(500),
    battery_level FLOAT,
    network_strength VARCHAR(20) DEFAULT 'ONLINE',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_geom ON alerts USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts(state);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

-- Table: alert_events (ALERT-10 state transitions & audit log)
CREATE TABLE IF NOT EXISTS alert_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,      -- TRIGGERED, PRE_ALERT_COUNTDOWN, CANCELLED, ACTIVE, ACKNOWLEDGED, ESCALATED, RESOLVED, FALSE_ALARM
    actor VARCHAR(100) NOT NULL,          -- walker, guardian_1, guardian_2, responder_id, system
    ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    meta JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert ON alert_events(alert_id, ts);

-- Table: evidence_chunks (EVID-1 to EVID-5)
CREATE TABLE IF NOT EXISTS evidence_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
    seq INT NOT NULL,                     -- 0, 1, 2... 30-second rolling chunks
    sha256 VARCHAR(64) NOT NULL,          -- SHA-256 hash of this encrypted chunk
    prev_sha256 VARCHAR(64) NOT NULL,     -- SHA-256 hash chaining
    storage_key VARCHAR(500) NOT NULL,    -- Object storage key (ciphertext only)
    wrapped_keys JSONB NOT NULL,          -- Map of guardian_id -> RSA/X25519 sealed AES key
    ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_alert_seq ON evidence_chunks(alert_id, seq);

-- Table: segments (ROUTE-3, Section 6.1)
CREATE TABLE IF NOT EXISTS segments (
    id VARCHAR(100) PRIMARY KEY,          -- seg_osm_...
    osm_way_id BIGINT,
    geom geometry(LineString, 4326) NOT NULL,
    length_m FLOAT NOT NULL,
    lamp_density FLOAT DEFAULT 0.0,       -- Lamps per 100m within 25m
    activity_index FLOAT DEFAULT 0.0,     -- Open shops, bus stops, transit within 50m
    community_rating FLOAT DEFAULT 0.5,   -- Prior = 0.5
    rating_count INT DEFAULT 0,
    static_score FLOAT DEFAULT 60.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_segments_geom ON segments USING GIST(geom);

-- Table: ratings (RATE-1 to RATE-3)
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    walk_id UUID REFERENCES walks(id) ON DELETE CASCADE,
    segment_id VARCHAR(100) REFERENCES segments(id) ON DELETE CASCADE,
    user_hash VARCHAR(64) NOT NULL,       -- Anonymized hashed user ID
    lit BOOLEAN NOT NULL,
    busy BOOLEAN NOT NULL,
    felt_safe BOOLEAN NOT NULL,
    note TEXT,
    ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ratings_segment ON ratings(segment_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_hash_ts ON ratings(user_hash, ts);

-- Table: hazards (RATE-4)
CREATE TABLE IF NOT EXISTS hazards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_hash VARCHAR(64),
    geom geometry(Point, 4326) NOT NULL,
    category VARCHAR(50) NOT NULL,        -- broken_light, harassment_spot, blocked_path, dark_alley, other
    description TEXT,
    photo_key VARCHAR(500),
    status VARCHAR(30) DEFAULT 'ACTIVE',  -- ACTIVE, VERIFIED, RESOLVED, REJECTED
    ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hazards_geom ON hazards USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_hazards_status ON hazards(status);

-- Table: safe_stops (ROUTE-7)
CREATE TABLE IF NOT EXISTS safe_stops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,            -- POLICE, HOSPITAL, PHARMACY_24H, CONVENIENCE_24H, VERIFIED_PARTNER
    geom geometry(Point, 4326) NOT NULL,
    hours VARCHAR(50) DEFAULT '24/7',
    verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_safe_stops_geom ON safe_stops USING GIST(geom);

-- Table: audit_log (DASH-6)
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor VARCHAR(100) NOT NULL,          -- User ID or responder ID
    action VARCHAR(100) NOT NULL,         -- VIEW_ALERTS, ACKNOWLEDGE, ESCALATE, RESOLVE, EXPORT_CSV, VIEW_TRAIL
    target VARCHAR(255) NOT NULL,         -- Resource accessed
    ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);

-- Table: false_alarm_feedback (ALERT-11)
CREATE TABLE IF NOT EXISTS false_alarm_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_false_alarm_alert ON false_alarm_feedback(alert_id);
