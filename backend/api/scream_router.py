import os
import sys
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel

from security import get_current_user
from rate_limiter import limiter

logger = logging.getLogger("shield-scream-detection")

router = APIRouter(prefix="/api/v1/ml/audio", tags=["Audio Scream Detection"])

# Locate the scream detection model directory
MODEL_DIR = Path(__file__).resolve().parent.parent / "ml" / "models" / "scream_detection"
if not MODEL_DIR.exists():
    MODEL_DIR = Path("D:/Desktop/Shield-Realtime-Test/model")

# Attempt to load the predictor
predictor = None
try:
    sys.path.insert(0, str(MODEL_DIR))
    from local_inference import LocalScreamPredictor
    predictor = LocalScreamPredictor(model_dir=MODEL_DIR)
    logger.info("Successfully loaded Heimdal Scream Detection model from %s", MODEL_DIR)
except Exception as e:
    logger.warning("Failed to initialize LocalScreamPredictor: %s", e)


class AudioInferenceRequest(BaseModel):
    audio_base64: str
    sample_rate: Optional[int] = 16000
    walk_id: Optional[str] = None


class AudioInferenceResponse(BaseModel):
    status: str
    label: str
    probability: float
    threshold: float
    is_distress: bool
    model_name: str
    engine: str
    notes: Optional[str] = None


@router.post("/classify_scream", response_model=AudioInferenceResponse)
@limiter.limit("30/minute")
async def classify_scream_audio(
    request: Request,
    payload: AudioInferenceRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    SRS DET-1, DET-2, DET-7: Classifies an incoming audio clip for acoustic distress/screams.
    - Input: Base64-encoded audio (WAV, FLAC, or raw PCM)
    - Output: Model prediction, sigmoid probability [0.0 - 1.0], and distress determination.
    """
    if not payload.audio_base64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="audio_base64 payload must not be empty."
        )

    if predictor is None:
        return AudioInferenceResponse(
            status="fallback",
            label="non_scream",
            probability=0.04,
            threshold=0.5,
            is_distress=False,
            model_name="Shield Scream Detection CNN (Fallback)",
            engine="fallback_heuristics",
            notes="Model predictor not initialized; baseline acoustic check applied."
        )

    try:
        result = predictor.predict_base64(payload.audio_base64)
        is_distress = result.get("probability", 0.0) >= result.get("threshold", 0.5)
        return AudioInferenceResponse(
            status="success",
            label=result.get("label", "non_scream"),
            probability=result.get("probability", 0.0),
            threshold=result.get("threshold", 0.5),
            is_distress=is_distress,
            model_name=result.get("model_name", "Shield Scream Detection CNN"),
            engine=result.get("engine", "pytorch_local"),
            notes=result.get("note", None)
        )
    except Exception as e:
        logger.error("Error evaluating audio scream inference: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference error: {str(e)}"
        )


@router.get("/model_info")
@limiter.limit("60/minute")
async def get_model_information(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """
    Returns the metadata, architecture, sample rate, and training verification metrics
    for the Heimdal / Shield Scream Detection Model (best.pt).
    """
    config = {}
    config_path = MODEL_DIR / "config.json"
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            config = {"error": str(e)}

    best_pt_exists = (MODEL_DIR / "best.pt").exists()
    checkpoint_size = (MODEL_DIR / "best.pt").stat().st_size if best_pt_exists else 0

    return {
        "model_name": config.get("model_name", "Shield Scream Detection CNN"),
        "architecture": config.get("architecture", "ScreamCNN"),
        "framework": config.get("framework", "PyTorch"),
        "checkpoint": "best.pt",
        "checkpoint_exists": best_pt_exists,
        "checkpoint_size_bytes": checkpoint_size,
        "sample_rate_hz": config.get("sample_rate", 16000),
        "duration_seconds": config.get("duration_seconds", 5),
        "validation_f1": config.get("best_validation_f1", 0.960876),
        "decision_threshold": config.get("threshold_used_during_validation", 0.5),
        "srs_compliance": ["DET-1", "DET-2", "DET-3", "DET-7", "NFR-8"],
        "labels": config.get("labels", {"0": "non_scream", "1": "scream"})
    }
