import asyncio
import json
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import redis.asyncio as redis
import asyncpg
import logging
from auth import router as auth_router
from media import router as media_router
from risk_router import router as ml_risk_router
from community import router as community_router
from incident import router as incident_router
from contacts import router as contacts_router
from security import SECRET_KEY, ALGORITHM
from jose import jwt, JWTError
from fastapi import Request
from rate_limiter import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Configure structured logging for observability
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("shield-core")

app = FastAPI(title="SHIELD Core Safety Service")

# Attach Rate Limiter Exception Handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Allowed origins for API Gateway / Clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Update for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the Week 1 & 2 Auth Router
app.include_router(auth_router)
# Mount the Media router for End-to-End Encrypted audio uploads
app.include_router(media_router)
# Mount the ML Risk Assessment endpoint
app.include_router(ml_risk_router)
# Mount the Network Effects (Moat) API
app.include_router(community_router)
# Mount the Incident Lifecycle layer
app.include_router(incident_router)
# Mount emergency contacts CRUD
app.include_router(contacts_router)

# Global variables for connection pools
redis_pool = None
db_pool = None

@app.on_event("startup")
async def startup_event():
    global redis_pool, db_pool
    # Initialize Redis for pub/sub and caching
    redis_pool = redis.Redis(host='localhost', port=6380, db=0, decode_responses=True)
    app.state.redis_pool = redis_pool
    
    # Initialize connection to PostgreSQL (PostGIS)
    db_pool = await asyncpg.create_pool(
        dsn="postgresql://postgres:postgres_password@localhost:5432/shield_db"
    )
    # Store the pool on the app state so routers can access it
    app.state.db_pool = db_pool
    logger.info("Core Data dependencies connected (Redis, PostgreSQL)")

@app.on_event("shutdown")
async def shutdown_event():
    await redis_pool.close()
    await db_pool.close()

# Models
class LocationUpdate(BaseModel):
    alert_id: str
    user_id: str
    lat: float
    lon: float
    accuracy: float
    speed: float = 0.0
    heading: float = 0.0

@app.websocket("/ws/location/{alert_id}")
async def location_stream(websocket: WebSocket, alert_id: str):
    """
    Week 3: WebSocket with Auth Guard.
    Requires token in the URL or headers (browsers prevent JS from setting custom headers for WS, 
    so typically token is passed in query param ?token=JWT).
    """
    await websocket.accept()
    logger.info(f"New WebSocket connection attempt for alert tracking: {alert_id}")
    
    # Authenticate WebSocket Connection
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="Missing Token")
        return
        
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        # Ensure the user requesting this WebSocket has permission to view this alert
        # (Omitted strict permission check logic for brevity)
    except JWTError:
        await websocket.close(code=1008, reason="Invalid Token")
        return
        
    logger.info(f"User {user_id} authenticated for WebSocket {alert_id}")
    pubsub = redis_pool.pubsub()
    await pubsub.subscribe(f"location:{alert_id}")
    
    try:
        async for message in pubsub.listen():
            if message['type'] == 'message':
                # Forward the location coordinates directly to the frontend/contacts
                data = json.loads(message['data'])
                await websocket.send_json(data)
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for alert: {alert_id}")
        await pubsub.unsubscribe(f"location:{alert_id}")
    except Exception as e:
        logger.error(f"WebSocket Error: {str(e)}")
        if pubsub.subscribed:
            await pubsub.unsubscribe(f"location:{alert_id}")

@app.post("/api/v1/location")
@limiter.limit("60/minute") # Only enough for 1 update per second max
async def push_location(request: Request, update: LocationUpdate):
    """
    Mobile client pushes live location here every 2 seconds during an active alert.
    1. Publish to Redis for sub-50ms latency distribution to WebSockets.
    2. Insert into PostGIS database for the permanent location trail.
    """
    current_time = time.time()
    
    # 1. Publish to Redis for real-time subscribers
    payload = {
        'lat': update.lat,
        'lon': update.lon,
        'accuracy': update.accuracy,
        'speed': update.speed,
        'heading': update.heading,
        'timestamp': current_time
    }
    
    await redis_pool.publish(f"location:{update.alert_id}", json.dumps(payload))
    
    # 2. Store in PostGIS
    try:
        async with db_pool.acquire() as conn:
            # Create a PostGIS point format: ST_SetSRID(ST_MakePoint(lon, lat), 4326)
            query = """
                INSERT INTO location_trail 
                (alert_id, user_id, location, accuracy, speed, heading, device_timestamp)
                VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, to_timestamp($8))
            """
            await conn.execute(
                query, 
                update.alert_id, 
                update.user_id, 
                update.lon,        # PostGIS takes Lon then Lat
                update.lat, 
                update.accuracy, 
                update.speed, 
                update.heading, 
                current_time
            )
    except Exception as e:
        logger.error(f"Database insertion failed for location trail: {e}")
        # Not throwing an exception here so the critical WebSocket path still succeeds
    
    return {"status": "success", "latency_ms": (time.time() - current_time) * 1000}

# Health check
@app.get("/health")
@limiter.limit("10/minute")
def health_check(request: Request):
    return {"status": "healthy", "service": "shield-core-service"}
