import os
import sys
from datetime import datetime
from fastapi import APIRouter, Depends, Request
from security import get_current_user
from rate_limiter import limiter

# Ensure the ML directory is discoverable
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "ml"))
from contextual_risk import ContextualRiskModel
from personal_baseline import PersonalBaselineModel

router = APIRouter(prefix="/api/v1/risk", tags=["Machine Learning"])

@router.get("/contextual")
@limiter.limit("20/minute")
async def get_environmental_risk_score(
    request: Request, 
    lat: float, 
    lon: float, 
    current_user: dict = Depends(get_current_user)
):
    """
    ML Layer 2 Endpoint.
    Given a user's current GPS location, this polls PostGIS for historical density,
    calculates the exponential decay of past crimes, and returns an Environmental Risk Score.
    
    If the score is HIGH or CRITICAL, the mobile client should silently lower the threshold
    required to trigger an emergency SOS (e.g., triggering on a minor sudden movement instead of a loud scream).
    """
    db_pool = request.app.state.db_pool
    
    # Initialize the ML Model 
    risk_model = ContextualRiskModel(db_pool=db_pool)
    
    # Calculate the exact threat coefficient
    now = datetime.now()
    risk_data = await risk_model.predict_area_risk(lat=lat, lon=lon, current_time=now)
    
    return {
        "user_id": current_user["user_id"],
        "coordinates": {"lat": lat, "lon": lon},
        "timestamp": now.isoformat(),
        "environmental_threat": risk_data
    }

@router.get("/biometric")
@limiter.limit("60/minute")
async def evaluate_biometric_anomaly(
    request: Request,
    current_hr: int,
    current_motion: float,
    current_user: dict = Depends(get_current_user)
):
    """
    ML Layer 3 Endpoint.
    Mobile device sends biometric burst data (Heart Rate, Accelerometer Magnitude).
    This asks TimescaleDB what is mathematically "normal" for this specific user in this specific state.
    """
    db_pool = request.app.state.db_pool
    
    # Initialize the ML Model
    baseline_model = PersonalBaselineModel(db_pool=db_pool)
    
    # Calculate physiological deviation
    anomaly_data = await baseline_model.is_anomalous_for_this_user(
        user_id=current_user["user_id"],
        current_hr=current_hr,
        current_motion=current_motion
    )
    
    return {
        "user_id": current_user["user_id"],
        "biometric_evaluation": anomaly_data
    }
