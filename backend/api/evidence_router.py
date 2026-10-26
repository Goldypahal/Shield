import hashlib
import os
import logging
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

import settings
from access import alert_for_owner, alert_for_viewer
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage

logger = logging.getLogger("shield-evidence")

router = APIRouter(prefix="/api/v1/evidence", tags=["Evidence Capture"])

GENESIS_HASH = "0" * 64
STORAGE_ROOT = os.path.abspath(settings.EVIDENCE_DIR)
os.makedirs(STORAGE_ROOT, exist_ok=True)


class UploadChunkPayload(BaseModel):
    alert_id: str
    seq: int = Field(ge=0, le=100_000)
    ciphertext_base64: str = Field(min_length=1, max_length=settings.MAX_EVIDENCE_CHUNK_BYTES)  # AES-256-GCM payload
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")       # SHA-256 of this ciphertext
    prev_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")  # hash of chunk seq-1, or 64 zeros for seq 0
    wrapped_keys: Dict[str, str] = Field(max_length=10)  # guardian_id -> sealed AES key


@router.post("/chunks", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def upload_evidence_chunk(request: Request, payload: UploadChunkPayload,
                                current_user: dict = Depends(get_current_user)):
    """
    EVID-1 to EVID-5: Stores one encrypted 30 s chunk. The server keeps
    ciphertext only and enforces the hash chain: chunks arrive in order and
    each must reference the hash of the one before it.
    """
    alert = await alert_for_owner(current_user, payload.alert_id)
    alert_id = alert["id"]  # canonical id from the database, never raw input, goes into the file name

    computed_hash = hashlib.sha256(payload.ciphertext_base64.encode('utf-8')).hexdigest()
    if computed_hash != payload.sha256:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Evidence hash integrity violation: submitted '{payload.sha256}' does not match computed '{computed_hash}'",
        )

    last = await storage.get_last_evidence_chunk(alert_id)
    expected_seq = 0 if last is None else last["seq"] + 1
    expected_prev = GENESIS_HASH if last is None else last["sha256"]
    if payload.seq != expected_seq:
        raise HTTPException(status_code=409, detail=f"Expected chunk seq {expected_seq}.")
    if payload.prev_sha256 != expected_prev:
        raise HTTPException(status_code=409, detail="Hash chain broken: prev_sha256 does not match the previous chunk.")

    storage_key = f"evidence/{alert_id}/chunk_{payload.seq}.enc"
    local_path = os.path.join(STORAGE_ROOT, f"{alert_id}_chunk_{payload.seq}.enc")
    with open(local_path, "x", encoding="utf-8") as f:  # "x": never overwrite existing evidence
        f.write(payload.ciphertext_base64)

    record = await storage.add_evidence_chunk(
        alert_id=alert_id, seq=payload.seq, sha256=payload.sha256, prev_sha256=payload.prev_sha256,
        storage_key=storage_key, wrapped_keys=payload.wrapped_keys,
    )
    return {
        "status": "chunk_accepted",
        "evidence_id": record["id"],
        "seq": record["seq"],
        "sha256": record["sha256"],
        "prev_sha256": record["prev_sha256"],
        "storage_key": storage_key,
        "privacy_notice": "EVID-6: End-to-end encrypted; server cannot read raw audio.",
    }


@router.get("/chunks/{alert_id}")
async def list_evidence_chunks(request: Request, alert_id: str, current_user: dict = Depends(get_current_user)):
    """Evidence chain metadata for the walker, their guardians and responders, with a chain check."""
    alert = await alert_for_viewer(current_user, alert_id)
    chunks = await storage.get_evidence_chunks(alert["id"])
    prev, intact = GENESIS_HASH, True
    for i, c in enumerate(chunks):
        if c["seq"] != i or c["prev_sha256"] != prev:
            intact = False
            break
        prev = c["sha256"]
    return {"alert_id": alert["id"], "total_chunks": len(chunks), "chain_intact": intact, "chunks": chunks}
