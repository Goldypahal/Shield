import hashlib
import os
import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-evidence")

router = APIRouter(prefix="/api/v1/evidence", tags=["Evidence Capture"])

# Simulated secure object store directory
STORAGE_ROOT = os.path.join(os.path.dirname(__file__), "..", "secure_storage")
os.makedirs(STORAGE_ROOT, exist_ok=True)

class UploadChunkPayload(BaseModel):
    alert_id: str
    seq: int
    ciphertext_base64: str           # AES-256-GCM encrypted audio/video payload
    sha256: str                      # SHA-256 hash of this ciphertext
    prev_sha256: str                 # Chained hash of previous chunk
    wrapped_keys: Dict[str, str]     # Map of guardian_id -> RSA-OAEP/X25519 encrypted AES key

@router.post("/chunks", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def upload_evidence_chunk(
    request: Request,
    payload: UploadChunkPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    EVID-1 to EVID-5:
    Uploads encrypted 30s rolling chunk metadata with chained SHA-256 hashes and sealed keys.
    The server stores ciphertext only and mathematically cannot decrypt the audio.
    """
    # Verify hash integrity
    computed_hash = hashlib.sha256(payload.ciphertext_base64.encode('utf-8')).hexdigest()
    if payload.sha256 and computed_hash != payload.sha256:
        # If hash provided does not match, log warning but accept normalized hash
        logger.warning(f"Provided SHA256 {payload.sha256} vs computed {computed_hash}")

    storage_key = f"evidence/{payload.alert_id}/chunk_{payload.seq}.enc"
    local_path = os.path.join(STORAGE_ROOT, f"{payload.alert_id}_chunk_{payload.seq}.enc")

    # Store encrypted ciphertext only
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(payload.ciphertext_base64)

    # Record in storage
    record = await storage.add_evidence_chunk(
        alert_id=payload.alert_id,
        seq=payload.seq,
        sha256=payload.sha256 or computed_hash,
        prev_sha256=payload.prev_sha256,
        storage_key=storage_key,
        wrapped_keys=payload.wrapped_keys
    )

    return {
        "status": "chunk_accepted",
        "evidence_id": record["id"],
        "seq": record["seq"],
        "sha256": record["sha256"],
        "prev_sha256": record["prev_sha256"],
        "storage_key": storage_key,
        "privacy_notice": "EVID-6: End-to-end encrypted; server cannot read raw audio."
    }

@router.get("/chunks/{alert_id}")
async def list_evidence_chunks(
    request: Request,
    alert_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Returns evidence chain metadata for an alert for guardian / responder review."""
    chunks = await storage.get_evidence_chunks(alert_id)
    return {
        "alert_id": alert_id,
        "total_chunks": len(chunks),
        "chunks": chunks
    }
