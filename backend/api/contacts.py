from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from rate_limiter import limiter
from security import get_current_user

router = APIRouter(prefix="/api/v1/contacts", tags=["Contacts"])


class EmergencyContactPayload(BaseModel):
    name: str
    phone_number: str
    public_key: Optional[str] = None
    priority: int = 1


async def ensure_contacts_schema(conn):
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS emergency_contacts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            phone_number VARCHAR(20) NOT NULL,
            public_key TEXT,
            priority INT DEFAULT 1,
            is_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, phone_number)
        );
        """
    )


@router.get("/")
@limiter.limit("30/minute")
async def list_contacts(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    async with request.app.state.db_pool.acquire() as conn:
        await ensure_contacts_schema(conn)
        rows = await conn.fetch(
            """
            SELECT id, name, phone_number, public_key, priority, is_verified
            FROM emergency_contacts
            WHERE user_id = $1
            ORDER BY priority ASC, created_at ASC
            """,
            current_user["user_id"],
        )

    return {
        "contacts": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "phone_number": row["phone_number"],
                "public_key": row["public_key"],
                "priority": row["priority"],
                "is_verified": row["is_verified"],
            }
            for row in rows
        ]
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def create_or_update_contact(
    request: Request,
    payload: EmergencyContactPayload,
    current_user: dict = Depends(get_current_user),
):
    async with request.app.state.db_pool.acquire() as conn:
        await ensure_contacts_schema(conn)
        row = await conn.fetchrow(
            """
            INSERT INTO emergency_contacts (user_id, name, phone_number, public_key, priority, is_verified)
            VALUES ($1, $2, $3, $4, $5, FALSE)
            ON CONFLICT (user_id, phone_number)
            DO UPDATE SET
                name = EXCLUDED.name,
                public_key = EXCLUDED.public_key,
                priority = EXCLUDED.priority
            RETURNING id, name, phone_number, public_key, priority, is_verified
            """,
            current_user["user_id"],
            payload.name,
            payload.phone_number,
            payload.public_key,
            payload.priority,
        )

    return {
        "contact": {
            "id": str(row["id"]),
            "name": row["name"],
            "phone_number": row["phone_number"],
            "public_key": row["public_key"],
            "priority": row["priority"],
            "is_verified": row["is_verified"],
        }
    }


@router.delete("/{contact_id}")
@limiter.limit("20/minute")
async def delete_contact(
    request: Request,
    contact_id: str,
    current_user: dict = Depends(get_current_user),
):
    async with request.app.state.db_pool.acquire() as conn:
        await ensure_contacts_schema(conn)
        result = await conn.execute(
            """
            DELETE FROM emergency_contacts
            WHERE id = $1 AND user_id = $2
            """,
            contact_id,
            current_user["user_id"],
        )

    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Contact not found")

    return {"status": "deleted", "contact_id": contact_id}
