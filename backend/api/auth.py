from fastapi import APIRouter, HTTPException, Depends, status, Request
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta
import uuid
from security import verify_password, get_password_hash, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES, get_current_user
from rate_limiter import limiter
from incident import IncidentService, SyncedAlert

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])

class RegisterUser(BaseModel):
    phone_number: str
    pin: str
    duress_pin: Optional[str] = None
    public_key: Optional[str] = None
    device_id: Optional[str] = None

class LoginUser(BaseModel):
    phone_number: str
    pin: str
    device_id: Optional[str] = None


class PushTokenPayload(BaseModel):
    expo_push_token: str


class SecuritySettingsPayload(BaseModel):
    duress_pin: Optional[str] = None


async def ensure_user_extensions(conn):
    await conn.execute(
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS expo_push_token TEXT
        """
    )

@router.post("/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("3/hour")
async def register(request: Request, user: RegisterUser):
    """
    Week 1: Create user with hashed PIN in PostgreSQL.
    """
    db_pool = request.app.state.db_pool # Extract the asyncpg connection pool added to app state
    
    hashed_pin = get_password_hash(user.pin)
    duress_hashed = get_password_hash(user.duress_pin) if user.duress_pin else None
    
    try:
        async with db_pool.acquire() as conn:
            await ensure_user_extensions(conn)
            # Check if phone number exists first
            existing = await conn.fetchrow("SELECT id FROM users WHERE phone_number = $1", user.phone_number)
            if existing:
                raise HTTPException(status_code=400, detail="Phone number already registered")
                
            # Insert new user
            row = await conn.fetchrow(
                """
                INSERT INTO users (phone_number, hashed_pin, duress_pin, public_key, device_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                """,
                user.phone_number, hashed_pin, duress_hashed, user.public_key, user.device_id
            )
            
            # Auto-generate a JWT upon successful registration
            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = create_access_token(
                data={"sub": str(row['id']), "phone_number": user.phone_number}, 
                expires_delta=access_token_expires
            )
            
            return {
                "user_id": str(row['id']), 
                "access_token": access_token, 
                "token_type": "bearer"
            }
            
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, credentials: LoginUser):
    """
    Week 1: Issue JWT to authenticated user.
    """
    db_pool = request.app.state.db_pool
    
    incident_service = IncidentService(db_pool, getattr(request.app.state, "redis_pool", None))
    duress_contacts: list[str] = []

    async with db_pool.acquire() as conn:
        await ensure_user_extensions(conn)
        user = await conn.fetchrow(
            "SELECT id, phone_number, hashed_pin, duress_pin FROM users WHERE phone_number = $1", 
            credentials.phone_number
        )
        
        if not user:
            raise HTTPException(status_code=400, detail="Incorrect phone number or PIN")
            
        # Is this the normal PIN?
        is_normal_pin = verify_password(credentials.pin, user['hashed_pin'])
        # Is this the Duress PIN (looks real, but alerts cops silently)?
        is_duress_pin = False
        if user['duress_pin']:
            is_duress_pin = verify_password(credentials.pin, user['duress_pin'])
            
        if not is_normal_pin and not is_duress_pin:
             raise HTTPException(status_code=400, detail="Incorrect phone number or PIN")
             
        # If it was a Duress PIN, we would kick off a background task here to silently start an SOS
        if is_duress_pin:
             rows = await conn.fetch(
                 """
                 SELECT phone_number
                 FROM emergency_contacts
                 WHERE user_id = $1
                 ORDER BY priority ASC, created_at ASC
                 """,
                 user["id"],
             )
             duress_contacts = [row["phone_number"] for row in rows]
             
        # Update device ID if provided
        if credentials.device_id:
            await conn.execute("UPDATE users SET device_id = $1 WHERE id = $2", credentials.device_id, user['id'])
            
        # Issue standard JWT
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": str(user['id']), "phone_number": user['phone_number']}, expires_delta=access_token_expires
        )
        
        response = {
            "user_id": str(user['id']), 
            "access_token": access_token, 
            "token_type": "bearer",
            "duress_mode_active": is_duress_pin # Do not return this in production, just for debugging
        }

    if is_duress_pin:
        await incident_service.sync_mobile_alert(
            str(user["id"]),
            SyncedAlert(
                id=str(uuid.uuid4()),
                type="DURESS_LOGIN",
                lat=0.0,
                lon=0.0,
                message="Silent duress PIN used during login.",
                contacts=duress_contacts,
                threat_score=100,
                threat_level="high",
            ),
        )

    return response

@router.get("/me")
async def get_my_profile(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Week 2: Returns the currently authenticated user's profile.
    This demonstrates the JWT Auth Guard working perfectly.
    """
    db_pool = request.app.state.db_pool
    async with db_pool.acquire() as conn:
        await ensure_user_extensions(conn)
        user = await conn.fetchrow(
            "SELECT id, phone_number, created_at, expo_push_token FROM users WHERE id = $1",
            current_user['user_id'],
        )
        return dict(user)


@router.post("/push-token")
@limiter.limit("20/minute")
async def register_push_token(
    request: Request,
    payload: PushTokenPayload,
    current_user: dict = Depends(get_current_user),
):
    async with request.app.state.db_pool.acquire() as conn:
        await ensure_user_extensions(conn)
        await conn.execute(
            """
            UPDATE users
            SET expo_push_token = $1, updated_at = NOW()
            WHERE id = $2
            """,
            payload.expo_push_token,
            current_user["user_id"],
        )

    return {"status": "registered"}


@router.post("/security-settings")
@limiter.limit("20/minute")
async def update_security_settings(
    request: Request,
    payload: SecuritySettingsPayload,
    current_user: dict = Depends(get_current_user),
):
    updates = []
    values = []

    if payload.duress_pin:
        updates.append(f"duress_pin = ${len(values) + 1}")
        values.append(get_password_hash(payload.duress_pin))

    if not updates:
        return {"status": "noop"}

    values.append(current_user["user_id"])
    query = f"""
        UPDATE users
        SET {", ".join(updates)}, updated_at = NOW()
        WHERE id = ${len(values)}
    """

    async with request.app.state.db_pool.acquire() as conn:
        await ensure_user_extensions(conn)
        await conn.execute(query, *values)

    return {"status": "updated"}
