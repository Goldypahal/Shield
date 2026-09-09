import math
from datetime import datetime
import asyncpg
import structlog

# Specialized observability logger for the ML risk engine
log = structlog.get_logger("shield-contextual-risk")

class ContextualRiskModel:
    """
    ML Pipeline Layer 2: The Environmental Risk Engine.
    Dynamically computes the geographic danger factor of a coordinate based on 
    the user's exact temporal context (Time, Day) over historical data density.
    """
    def __init__(self, db_pool: asyncpg.Pool):
        self.db_pool = db_pool

    async def predict_area_risk(self, lat: float, lon: float, current_time: datetime) -> dict:
        """
        Calculates the Environmental Risk Score for a specific coordinate locally and in real-time.
        Leverages PostGIS for highly optimized spatial indexing.
        """
        radius_meters = 500.0  # Search within a 500m radius
        
        async with self.db_pool.acquire() as conn:
            # Query PostGIS to find all verified incidents within 500 meters of the user.
            # We use ST_DWithin for extremely fast geographic radius searches, 
            # and ST_Distance to calculate the exact distance for heuristic weighting.
            query = """
                SELECT 
                    severity,
                    reported_at,
                    EXTRACT(HOUR FROM reported_at) as incident_hour,
                    EXTRACT(ISODOW FROM reported_at) as incident_day_of_week,
                    ST_Distance(
                        location::geography, 
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) as distance_meters
                FROM historical_incidents
                WHERE ST_DWithin(
                    location::geography, 
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
                    $3
                )
                AND is_verified = TRUE
            """
            
            # PostGIS expects parameters as (Longitude, Latitude)
            incidents = await conn.fetch(query, lon, lat, radius_meters)

        if not incidents:
            return {"risk_level": "LOW", "score": 0.0, "reason": "No historical incidents in 500m radius"}

        # Heuristic ML Algorithm: Calculate the heavily-weighted area score
        total_risk_score = 0.0
        
        current_hour = current_time.hour
        current_dow = current_time.isoweekday()
        
        for inc in incidents:
            # 1. Base Severity Weighting (1-10 scale recorded in database)
            base_score = float(inc['severity'])
            
            # 2. Recency Decay (Recent incidents matter significantly more than ones from 3 years ago)
            # Uses an exponential decay formula based on days passed.
            days_ago = (current_time.date() - inc['reported_at'].date()).days
            recency_multiplier = math.exp(-0.01 * max(0, days_ago)) 
            
            # 3. Temporal Affinity (Does this match the exact temporal profile?)
            temporal_multiplier = 1.0
            
            # If the incident historically happened within 2 hours of the user's current time, elevate risk
            hour_diff = min(abs(current_hour - inc['incident_hour']), 
                          24 - abs(current_hour - inc['incident_hour']))
            if hour_diff <= 2:
                temporal_multiplier *= 1.5
                
            # If the incident historically happened on the exact same weekend/weekday shift
            is_weekend_now = current_dow in (6, 7)
            was_weekend = inc['incident_day_of_week'] in (6, 7)
            if is_weekend_now == was_weekend:
                temporal_multiplier *= 1.2
                
            # 4. Distance Decay (Closer to the exact coordinate = exponentially higher risk)
            # 500m away = 0.1 multiplier, 10m away = 0.98 multiplier
            distance_multiplier = max(0.1, 1.0 - (inc['distance_meters'] / radius_meters))
            
            # Compress all dimensional weights to find the specific impact of this one historical event
            impact = base_score * recency_multiplier * temporal_multiplier * distance_multiplier
            total_risk_score += impact

        # Dimensionality Reduction - Normalize raw float score into App Thresholds
        # (Assuming an average baseline incident impact yields a ~3.0 float score)
        level = "LOW"
        if total_risk_score > 40:
            level = "CRITICAL"   # Extreme danger - Drop SOS trigger sensitivity to 0.
        elif total_risk_score > 20:
            level = "HIGH"       # Elevated risk - Enable background biometric polling.
        elif total_risk_score > 8:
            level = "MEDIUM"     # Caution zone.

        log.info("risk.calculated", lat=lat, lon=lon, incidents_found=len(incidents), score=total_risk_score, level=level)

        return {
            "risk_level": level,
            "score": round(total_risk_score, 2),
            "factors": {
                "historical_incidents_count": len(incidents),
                "temporal_match_penalty": "Active" if current_hour in [int(i['incident_hour']) for i in incidents] else "Inactive"
            }
        }
