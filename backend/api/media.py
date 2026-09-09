import os
from fastapi import APIRouter, HTTPException, Depends, status, Request
from pydantic import BaseModel
from typing import Dict
from security import get_current_user
from rate_limiter import limiter

# Normally this would upload to S3 or Google Cloud Storage.
# We store locally for demonstration.
UPLOAD_DIR = "/var/lib/shield/storage/audio"
os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/api/v1/media", tags=["Media"])

class EncryptedAudioPayload(BaseModel):
    alert_id: str
    audio_base64: str                  # AES-encrypted audio blob (server cannot decrypt)
    encrypted_keys: Dict[str, str]     # Map of Contact user_id -> RSA-encrypted AES key

@router.post("/upload_audio", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def upload_encrypted_audio(request: Request, payload: EncryptedAudioPayload, current_user: dict = Depends(get_current_user)):
    """
    Receives extreme-privacy End-to-End Encrypted audio packets.
    The server mathematically cannot listen to this file. It acts purely as a dumb relay
    for the emergency contacts who possess the correct private RSA keys.
    """
    db_pool = request.app.state.db_pool

    # 1. Verify the alert actually exists and belongs to the user
    async with db_pool.acquire() as conn:
        alert = await conn.fetchrow(
            "SELECT id FROM alerts WHERE id = $1 AND user_id = $2", 
            payload.alert_id, current_user['user_id']
        )
        
        if not alert:
            # We silently drop it to avoid leaking if an alert ID is valid or not.
            raise HTTPException(status_code=403, detail="Not authorized to upload for this alert")

        # 2. Store the encrypted audio file to "S3"
        # We save the raw base64 string because it's just AES cipher-text
        audio_path_url = f"s3://shield-secure-media/{payload.alert_id}_audio.enc"
        
        # Write to local disk simulation
        file_path = os.path.join(UPLOAD_DIR, f"{payload.alert_id}.enc")
        with open(file_path, "w") as f:
            f.write(payload.audio_base64)

        # 3. Store the RSA-encrypted symmetric keys in PostgreSQL so contacts can fetch them
        # We loop through the map of contacts provided by the phone and save their specific key
        for contact_id, encrypted_key in payload.encrypted_keys.items():
            await conn.execute(
                """
                INSERT INTO encrypted_audio_keys (alert_id, contact_id, encrypted_symmetric_key)
                VALUES ($1, $2, $3)
                ON CONFLICT DO NOTHING
                """,
                payload.alert_id, contact_id, encrypted_key
            )
            
        # 4. Update the alert row to point to the new audio path
        await conn.execute(
            "UPDATE alerts SET audio_path = $1 WHERE id = $2",
            audio_path_url, payload.alert_id
        )

    return {"status": "success", "storage_url": audio_path_url}
