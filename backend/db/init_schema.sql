-- Enable PostGIS extension for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable UUID extension for offline-generated unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    hashed_pin VARCHAR(255) NOT NULL, -- PIN for biometric fallback
    duress_pin VARCHAR(255),          -- Silent alarm PIN
    public_key TEXT,                  -- Base64 encoded public key for E2E audio encryption
    device_id VARCHAR(255),           -- For FCM push notifications
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table: emergency_contacts
CREATE TABLE emergency_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    public_key TEXT,                  -- Contact's public key (to encrypt symmetric audio key)
    priority INT DEFAULT 1,           -- Contact order
    is_verified BOOLEAN DEFAULT FALSE,-- Did the contact accept the invitation?
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, phone_number)
);

-- Table: alerts
-- When an alert is triggered (even offline), it generates a UUID locally to avoid duplicates
CREATE TABLE alerts (
    id UUID PRIMARY KEY,            -- UUID explicitly provided by mobile app
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    threat_type VARCHAR(50) NOT NULL, -- SOS_BUTTON, AUDIO, MOTION, FALL
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, RESOLVED, FALSE_ALARM
    initial_location geometry(Point, 4326),     -- PostGIS exact starting location
    audio_path VARCHAR(500),         -- S3/GCS URL for encrypted audio payload
    battery_level FLOAT,
    network_strength VARCHAR(20),    -- HIGH, MEDIUM, LOW, OFFLINE
    started_at TIMESTAMP WITH TIME ZONE NOT NULL, -- Device timestamp
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- Server timestamp
);

-- Index for spatial queries on alerts (e.g., finding nearby incidents)
CREATE INDEX idx_alerts_location ON alerts USING GIST (initial_location);
CREATE INDEX idx_alerts_status ON alerts(status);

-- Table: location_trail
-- Real-time location during an alert (fed from Redis into PostGIS)
CREATE TABLE location_trail (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    location geometry(Point, 4326) NOT NULL,
    accuracy FLOAT NOT NULL,
    speed FLOAT,
    heading FLOAT,
    device_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    server_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for spatial path rendering
CREATE INDEX idx_location_trail_geom ON location_trail USING GIST (location);
CREATE INDEX idx_location_trail_alert ON location_trail(alert_id, device_timestamp);

-- Table: historical_incidents (for Contextual Risk Model)
CREATE TABLE historical_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_type VARCHAR(100) NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    severity SMALLINT CHECK (severity >= 1 AND severity <= 10),
    reported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE -- Community or police verified
);

CREATE INDEX idx_historical_incidents_geom ON historical_incidents USING GIST (location);
CREATE INDEX idx_historical_incidents_time ON historical_incidents(reported_at);

-- Table: community_safe_zones
CREATE TABLE community_safe_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zone_polygon geometry(Polygon, 4326) NOT NULL,
    name VARCHAR(255),
    safety_score FLOAT NOT NULL,
    verification_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_safe_zones_geom ON community_safe_zones USING GIST (zone_polygon);
