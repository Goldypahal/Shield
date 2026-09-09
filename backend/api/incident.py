import json
import os
import uuid
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from rate_limiter import limiter
from security import get_current_user

log = structlog.get_logger("shield-incident-manager")

router = APIRouter(tags=["Incidents"])


class IncidentCreate(BaseModel):
    alert_id: str
    lat: float
    lon: float
    threat_level: str
    reason: str
    contacts: List[str]


class IncidentUpdate(BaseModel):
    state: str


class SyncedAlert(BaseModel):
    id: str
    type: str
    lat: float
    lon: float
    message: str
    contacts: List[str]
    threat_score: Optional[float] = None
    threat_level: Optional[str] = "high"


class IncidentService:
    def __init__(self, db_pool, redis_pool):
        self.db_pool = db_pool
        self.redis_pool = redis_pool

    async def ensure_incident_schema(self, conn):
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS incidents (
                incident_id UUID PRIMARY KEY,
                alert_id UUID,
                user_id UUID,
                state VARCHAR(50),
                threat_level VARCHAR(50),
                reason TEXT,
                start_location geometry(Point, 4326),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            """
        )

    async def sync_mobile_alert(self, user_id: str, payload: SyncedAlert):
        incident_id = str(uuid.uuid4())
        normalized_level = (payload.threat_level or "high").lower()
        initial_state = "active" if normalized_level == "high" else "pending"

        async with self.db_pool.acquire() as conn:
            await self.ensure_incident_schema(conn)

            await conn.execute(
                """
                INSERT INTO alerts (id, user_id, threat_type, status, initial_location, started_at)
                VALUES ($1, $2, $3, 'ACTIVE', ST_SetSRID(ST_MakePoint($4, $5), 4326), NOW())
                ON CONFLICT (id) DO UPDATE
                SET status = 'ACTIVE',
                    initial_location = EXCLUDED.initial_location,
                    started_at = NOW()
                """,
                payload.id,
                user_id,
                payload.type,
                payload.lon,
                payload.lat,
            )

            existing_incident = await conn.fetchrow(
                "SELECT incident_id FROM incidents WHERE alert_id = $1",
                payload.id,
            )
            if existing_incident:
                return {
                    "status": "already_synced",
                    "alert_id": payload.id,
                    "incident_id": str(existing_incident["incident_id"]),
                }

            await conn.execute(
                """
                INSERT INTO incidents (incident_id, alert_id, user_id, state, threat_level, reason, start_location)
                VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326))
                """,
                incident_id,
                payload.id,
                user_id,
                initial_state,
                normalized_level,
                payload.message,
                payload.lon,
                payload.lat,
            )

        await self.notify_guardians(incident_id, user_id, payload.contacts, payload.message)

        return {
            "status": "synced",
            "alert_id": payload.id,
            "incident_id": incident_id,
            "state": initial_state,
        }

    async def create_incident(self, user_id: str, data: IncidentCreate):
        initial_state = "active" if data.threat_level == "high" else "pending"
        incident_id = str(uuid.uuid4())

        async with self.db_pool.acquire() as conn:
            await self.ensure_incident_schema(conn)
            await conn.execute(
                """
                INSERT INTO incidents (incident_id, alert_id, user_id, state, threat_level, reason, start_location)
                VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326))
                """,
                incident_id,
                data.alert_id,
                user_id,
                initial_state,
                data.threat_level,
                data.reason,
                data.lon,
                data.lat,
            )

        if initial_state == "active":
            await self.notify_guardians(incident_id, user_id, data.contacts, data.reason)

        return {
            "incident_id": incident_id,
            "state": initial_state,
            "explainable_reason": data.reason,
        }

    async def notify_guardians(self, incident_id: str, victim_id: str, contacts: List[str], reason: str):
        account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
        api_key = os.environ.get("TWILIO_API_KEY")
        api_secret = os.environ.get("TWILIO_API_SECRET")
        phone_number = os.environ.get("TWILIO_PHONE_NUMBER")

        if account_sid and api_key and api_secret and phone_number and contacts:
            try:
                from twilio.rest import Client

                client = Client(username=api_key, password=api_secret, account_sid=account_sid)
                message_body = (
                    f"SHIELD emergency alert.\n"
                    f"User {victim_id} triggered SOS.\n"
                    f"Reason: {reason}\n"
                    f"Track live: https://shield.app/track/{incident_id}"
                )

                for target in contacts:
                    if not target.strip():
                        continue
                    message = client.messages.create(
                        body=message_body,
                        from_=phone_number,
                        to=target,
                    )
                    log.info("twilio.sms.sent", sid=message.sid, to=target)
            except Exception as exc:
                log.error("twilio.sms.failed", error=str(exc))
        else:
            log.info("twilio.sms.skipped", configured=False, contacts=len(contacts))

        if self.redis_pool:
            await self.redis_pool.publish(
                "guardian_alerts",
                json.dumps({"incident_id": incident_id, "victim_id": victim_id, "reason": reason}),
            )

    async def update_state(self, incident_id: str, user_id: str, state: str):
        valid_states = ["pending", "verified", "active", "resolved", "cancelled"]
        if state not in valid_states:
            raise HTTPException(status_code=400, detail="Invalid state")

        async with self.db_pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE incidents
                SET state = $1, updated_at = NOW()
                WHERE incident_id = $2
                """,
                state,
                incident_id,
            )
            if result == "UPDATE 0":
                raise HTTPException(status_code=404, detail="Incident not found")

        log.info("incident.state.updated", incident_id=incident_id, requested_by=user_id, new_state=state)
        return {"status": "success", "new_state": state}

    async def list_active_incidents(self):
        async with self.db_pool.acquire() as conn:
            await self.ensure_incident_schema(conn)
            rows = await conn.fetch(
                """
                SELECT
                    i.incident_id,
                    i.alert_id,
                    i.threat_level,
                    i.reason,
                    i.state,
                    ST_Y(i.start_location) AS lat,
                    ST_X(i.start_location) AS lon,
                    COALESCE(u.phone_number, 'Unknown user') AS victim_name
                FROM incidents i
                LEFT JOIN users u ON u.id = i.user_id
                WHERE i.state IN ('pending', 'verified', 'active')
                ORDER BY i.created_at DESC
                LIMIT 20
                """
            )

        incidents = [
            {
                "incident_id": str(row["incident_id"]),
                "alert_id": str(row["alert_id"]) if row["alert_id"] else "",
                "victim_name": row["victim_name"],
                "threat_level": row["threat_level"],
                "explainable_reason": row["reason"],
                "lat": row["lat"],
                "lon": row["lon"],
                "state": row["state"],
            }
            for row in rows
        ]
        return {"incidents": incidents}

    async def list_user_history(self, user_id: str):
        async with self.db_pool.acquire() as conn:
            await self.ensure_incident_schema(conn)
            rows = await conn.fetch(
                """
                SELECT
                    incident_id,
                    alert_id,
                    threat_level,
                    reason,
                    state,
                    created_at,
                    ST_Y(start_location) AS lat,
                    ST_X(start_location) AS lon
                FROM incidents
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 50
                """,
                user_id,
            )

        return {
            "incidents": [
                {
                    "incident_id": str(row["incident_id"]),
                    "alert_id": str(row["alert_id"]) if row["alert_id"] else "",
                    "threat_level": row["threat_level"],
                    "explainable_reason": row["reason"],
                    "lat": row["lat"],
                    "lon": row["lon"],
                    "state": row["state"],
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                }
                for row in rows
            ]
        }


@router.post("/api/v1/alerts/sync")
@limiter.limit("10/minute")
async def sync_alert(
    request: Request,
    payload: SyncedAlert,
    current_user: dict = Depends(get_current_user),
):
    service = IncidentService(request.app.state.db_pool, getattr(request.app.state, "redis_pool", None))
    return await service.sync_mobile_alert(str(current_user["user_id"]), payload)


@router.post("/api/v1/incidents/")
@limiter.limit("5/minute")
async def create_incident(
    request: Request,
    data: IncidentCreate,
    current_user: dict = Depends(get_current_user),
):
    service = IncidentService(request.app.state.db_pool, getattr(request.app.state, "redis_pool", None))
    return await service.create_incident(str(current_user["user_id"]), data)


@router.get("/api/v1/incidents/active")
@limiter.limit("20/minute")
async def list_active_incidents(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    service = IncidentService(request.app.state.db_pool, getattr(request.app.state, "redis_pool", None))
    return await service.list_active_incidents()


@router.get("/api/v1/incidents/history")
@limiter.limit("20/minute")
async def list_history(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    service = IncidentService(request.app.state.db_pool, getattr(request.app.state, "redis_pool", None))
    return await service.list_user_history(str(current_user["user_id"]))


@router.put("/api/v1/incidents/{incident_id}/state")
@limiter.limit("10/minute")
async def update_incident_state(
    request: Request,
    incident_id: str,
    data: IncidentUpdate,
    current_user: dict = Depends(get_current_user),
):
    service = IncidentService(request.app.state.db_pool, getattr(request.app.state, "redis_pool", None))
    return await service.update_state(incident_id, str(current_user["user_id"]), data.state)
