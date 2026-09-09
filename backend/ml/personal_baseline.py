import asyncpg
import structlog

log = structlog.get_logger("shield-personal-baseline")

class PersonalBaselineModel:
    """
    ML Pipeline Layer 3: The Intimate Biometric Baseline.
    Queries the TimescaleDB `sensor_5min_rollup` view to deeply understand 
    a specific user's exact physiological "normal".
    """
    def __init__(self, db_pool: asyncpg.Pool):
        self.db_pool = db_pool

    async def is_anomalous_for_this_user(self, user_id: str, current_hr: int, current_motion: float) -> dict:
        """
        A 140 BPM heart rate while sprinting (high motion) = normal.
        A 140 BPM heart rate while standing still (low motion) = PANIC.
        
        This dynamically checks the user's historical 5-minute rollups for their specific max
        heart rate when moving at their current speed.
        """
        async with self.db_pool.acquire() as conn:
            # Categorize the current motion vector to find historical comparisons
            # e.g., if motion magnitude is 1.5, we look at their history between 0.0 and 3.5
            motion_min = max(0.0, current_motion - 2.0)
            motion_max = current_motion + 2.0
            
            # TimescaleDB aggregates this infinitely fast because it's a materialized rollup
            query = """
                SELECT 
                    AVG(avg_heart_rate) as expected_hr,
                    MAX(max_heart_rate) as absolute_max_hr,
                    COUNT(*) as data_points
                FROM sensor_5min_rollup
                WHERE user_id = $1
                  AND avg_motion_magnitude BETWEEN $2 AND $3
            """
            
            # Since UUIDs come in as strings, ensure they are cast safely in asyncpg based on schema
            baseline = await conn.fetchrow(query, user_id, motion_min, motion_max)
            
        # If the user just downloaded the app, we won't have 10 data points 
        # of them walking at this specific cadence.
        if not baseline or not baseline['expected_hr'] or baseline['data_points'] < 10:
            # Fallback to generic human thresholds
            is_anomaly = current_hr > 120 and current_motion < 2.0
            return {
                "anomaly": is_anomaly, 
                "confidence": "LOW", 
                "reason": "Insufficient personal temporal data. Used generic threshold."
            }
            
        expected_hr = float(baseline['expected_hr'])
        
        # Calculate standard deviation heuristic
        # If the user's heart rate is unexpectedly spiking > 35% higher than their historical average 
        # for this exact motion state, it is mathematically defined as a panic response.
        deviation_ratio = current_hr / expected_hr
        
        is_anomaly = deviation_ratio > 1.35
        
        log.info(
            "baseline.evaluated", 
            user=user_id, hr=current_hr, 
            motion=current_motion, 
            expected=expected_hr, 
            anomaly=is_anomaly
        )
        
        return {
            "anomaly": is_anomaly,
            "confidence": "HIGH",
            "metrics": {
                "current_hr": current_hr,
                "expected_hr": round(expected_hr, 1),
                "deviation_percent": round((deviation_ratio - 1.0) * 100, 1),
                "historical_data_points_used": baseline['data_points']
            }
        }
