-- TimescaleDB extension for time-series sensor data
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Table: sensor_logs
-- This table receives high-frequency sensor snapshots (e.g., every few seconds when alert is active).
-- Using TimescaleDB for partition management and fast time-based aggregation.
CREATE TABLE sensor_logs (
    time TIMESTAMPTZ NOT NULL,            -- The exact device timestamp
    user_id UUID NOT NULL,               -- The person wearing the device
    alert_id UUID,                       -- If the data belongs to an active alert period
    heart_rate INT CHECK (heart_rate >= 0 AND heart_rate <= 300),
    motion_x FLOAT,                      -- Accelerometer data
    motion_y FLOAT,
    motion_z FLOAT,
    gyro_x FLOAT,                        -- Gyroscope data
    gyro_y FLOAT,
    gyro_z FLOAT,
    audio_decibel FLOAT,                 -- Raw decibel measure (no actual audio recorded unless alert triggers)
    temperature FLOAT,                   -- Contextual info
    device_model VARCHAR(100),           -- For calibration across different phone hardware
    
    PRIMARY KEY(time, user_id)           -- Timescale requires time to be part of PK
);

-- Convert standard table into a TimescaleDB hypertable
-- We chunk by 1 day because sensor data grows massively (billions of rows easily)
SELECT create_hypertable('sensor_logs', 'time', chunk_time_interval => INTERVAL '1 day');

-- Fast index for querying a specific user's historical sensor data
CREATE INDEX idx_sensor_logs_user_time ON sensor_logs (user_id, time DESC);

-- Automatic continuous aggregation: compute 5-minute rollups for training the Personal Baseline Model
-- e.g. "What is this user's average heart rate moving vs resting?"
CREATE MATERIALIZED VIEW sensor_5min_rollup
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    user_id,
    AVG(heart_rate) as avg_heart_rate,
    MAX(heart_rate) as max_heart_rate,
    AVG(SQRT(motion_x^2 + motion_y^2 + motion_z^2)) as avg_motion_magnitude,
    AVG(audio_decibel) as avg_decibel
FROM sensor_logs
GROUP BY bucket, user_id;

-- Add a retention policy: Keep raw sensor logs for 30 days (due to storage costs),
-- but keep the 5-minute rollup forever for establishing the personal baseline.
SELECT add_retention_policy('sensor_logs', INTERVAL '30 days');
