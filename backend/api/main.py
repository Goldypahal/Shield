import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
import json
import time
import logging
from typing import Dict, Any, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import redis.asyncio as redis
from jose import jwt, JWTError

from auth import router as auth_router
from contacts import router as contacts_router
from route_router import router as route_router
from walk_router import router as walk_router
from alerts_router import router as alerts_router
from evidence_router import router as evidence_router
from ratings_router import router as ratings_router
from dashboard_router import router as dashboard_router
from report_router import router as report_router
from media import router as media_router
from risk_router import router as ml_risk_router
from community import router as community_router

from security import SECRET_KEY, ALGORITHM
from rate_limiter import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from db.storage import storage

# Configure structured logging for observability (NFR-18)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("shield-core")

app = FastAPI(
    title="SHIELD Walk Core Safety Platform",
    description="Backend services for safe routes, live sharing, alerts, evidence and authority dashboard (SRS v1.0)",
    version="1.0.0"
)

# Rate Limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS Middleware (supports mobile app and web authority dashboard)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all routers
app.include_router(auth_router)
app.include_router(contacts_router)
app.include_router(route_router)
app.include_router(walk_router)
app.include_router(alerts_router)
app.include_router(evidence_router)
app.include_router(ratings_router)
app.include_router(dashboard_router)
app.include_router(report_router)
app.include_router(media_router)
app.include_router(ml_risk_router)
app.include_router(community_router)

# Mount Authority Dashboard Web App (SRS Deliverable 5 & DASH-1 to 6)
from fastapi.staticfiles import StaticFiles
dashboard_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dashboard"))
if os.path.exists(dashboard_dir):
    app.mount("/dashboard", StaticFiles(directory=dashboard_dir, html=True), name="dashboard")


# In-memory pub/sub broker for active walks (when Redis is optional/offline)
class InMemoryWalkBroker:
    def __init__(self):
        self._connections: Dict[str, list[WebSocket]] = {}

    async def register(self, walk_id: str, ws: WebSocket):
        if walk_id not in self._connections:
            self._connections[walk_id] = []
        self._connections[walk_id].append(ws)

    async def unregister(self, walk_id: str, ws: WebSocket):
        if walk_id in self._connections and ws in self._connections[walk_id]:
            self._connections[walk_id].remove(ws)
            if not self._connections[walk_id]:
                del self._connections[walk_id]

    async def broadcast(self, walk_id: str, data: Dict[str, Any]):
        if walk_id in self._connections:
            dead = []
            for ws in self._connections[walk_id]:
                try:
                    await ws.send_json(data)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                await self.unregister(walk_id, ws)

walk_broker = InMemoryWalkBroker()
redis_pool = None

@app.on_event("startup")
async def startup_event():
    global redis_pool
    # 1. Initialize persistent storage engine with SRS entities and pilot seed data
    await storage.init_db()
    app.state.storage = storage

    # 2. Try Redis connection if available
    try:
        redis_pool = redis.Redis(host='localhost', port=6380, db=0, decode_responses=True)
        await asyncio.wait_for(redis_pool.ping(), timeout=1.0)
        app.state.redis_pool = redis_pool
        logger.info("Connected to Redis Pub/Sub")
    except Exception:
        redis_pool = None
        app.state.redis_pool = None
        logger.info("Using high-performance in-memory pub/sub broker")

@app.on_event("shutdown")
async def shutdown_event():
    if redis_pool:
        await redis_pool.close()

# WebSocket for Live Location Streaming (WALK-3, NFR-10)
@app.websocket("/ws/walk/{walk_id}")
async def walk_live_stream(websocket: WebSocket, walk_id: str):
    """
    WALK-3 & NFR-10:
    WebSocket stream for live location updates with one-time short-lived tickets.
    Never exposes JWT token in WebSocket URLs.
    """
    ticket = websocket.query_params.get("ticket")
    if not ticket:
        await websocket.close(code=1008, reason="Missing WS Ticket")
        return

    # Authenticate one-time ticket
    ticket_record = await storage.consume_ws_ticket(ticket, walk_id)
    if not ticket_record:
        await websocket.close(code=1008, reason="Invalid or Expired WS Ticket")
        return

    await websocket.accept()
    await walk_broker.register(walk_id, websocket)
    logger.info(f"Guardian connected to live walk {walk_id} with verified ticket")

    try:
        while True:
            # Handle client heartbeats or incoming location pings
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
                # If walker sends location over WS, broadcast to all guardians
                await walk_broker.broadcast(walk_id, parsed)
            except Exception:
                pass
    except WebSocketDisconnect:
        await walk_broker.unregister(walk_id, websocket)
        logger.info(f"WebSocket client disconnected for walk {walk_id}")
    except Exception as e:
        await walk_broker.unregister(walk_id, websocket)
        logger.error(f"WebSocket error on walk {walk_id}: {e}")

# Location websocket route with one-time ticket support (NFR-10)
@app.websocket("/ws/location/{alert_id}")
async def legacy_location_stream(websocket: WebSocket, alert_id: str):
    ticket = websocket.query_params.get("ticket")
    if ticket:
        ticket_record = await storage.consume_ws_ticket(ticket, alert_id)
        if not ticket_record:
            await websocket.close(code=1008, reason="Invalid or Expired WS Ticket")
            return
    else:
        # Fallback check for backward compatibility
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=1008, reason="Missing WS Ticket (NFR-10)")
            return
        try:
            jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except JWTError:
            await websocket.close(code=1008, reason="Invalid Token")
            return

    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass

# Health Check Endpoint
@app.get("/health")
@limiter.limit("30/minute")
def health_check(request: Request):
    return {
        "status": "healthy",
        "service": "shield-walk-core",
        "srs_version": "1.0",
        "timestamp": time.time()
    }
