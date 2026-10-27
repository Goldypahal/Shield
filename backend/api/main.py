import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
import json
import time
import uuid
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import redis.asyncio as redis
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import settings
from auth import router as auth_router
from contacts import router as contacts_router
from route_router import router as route_router
from walk_router import router as walk_router
from alerts_router import router as alerts_router, guardian_router
from evidence_router import router as evidence_router
from ratings_router import router as ratings_router
from dashboard_router import router as dashboard_router
from report_router import router as report_router
from scream_router import router as scream_router
from track_router import router as track_router
from checkin_router import router as checkin_router
from safety_router import router as safety_router
from police_router import router as police_router
from nav_router import router as nav_router
from escalation import run_escalation_loop
from live import broker
from rate_limiter import limiter
from db.storage import storage

# Structured logging for observability (NFR-18)
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format='%(asctime)s %(levelname)s %(name)s %(message)s',
)
logger = logging.getLogger("shield-core")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await storage.init_db()
    app.state.storage = storage
    app.state.redis_pool = None
    try:
        pool = redis.from_url(settings.REDIS_URL, decode_responses=True)
        await asyncio.wait_for(pool.ping(), timeout=1.0)
        app.state.redis_pool = pool
        logger.info("Connected to Redis pub/sub")
    except Exception:
        logger.info("Redis unavailable; using the in-process live broker")
    stop = asyncio.Event()
    sweeper = asyncio.create_task(run_escalation_loop(stop)) if settings.ESCALATION_LOOP else None
    logger.info("SHIELD API started env=%s demo_mode=%s", settings.ENV, settings.DEMO_MODE)
    yield
    stop.set()
    if sweeper:
        await sweeper
    if app.state.redis_pool:
        await app.state.redis_pool.close()


app = FastAPI(
    title="SHIELD Walk Core Safety Platform",
    description="Backend services for safe routes, live sharing, alerts, evidence and authority dashboard (SRS v1.0)",
    version="1.1.0",
    lifespan=lifespan,
    docs_url=None if settings.IS_PROD else "/docs",
    redoc_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,  # bearer tokens, not cookies
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


MAX_BODY_BYTES = settings.MAX_EVIDENCE_CHUNK_BYTES + 64 * 1024  # largest legitimate body: one evidence chunk


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """Rejects oversized bodies before they are read into memory (DoS)."""
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
        return JSONResponse(status_code=413, content={"detail": "Request body too large."})
    return await call_next(request)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Request id, access log line and baseline security headers on every response."""
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    if settings.IS_PROD:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    logger.info("%s %s -> %s %.0fms rid=%s", request.method, request.url.path, response.status_code, elapsed_ms, request_id)
    return response


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    """Never leak stack traces or internals; the request id links the client report to the log."""
    request_id = getattr(request.state, "request_id", "-")
    logger.exception("Unhandled error rid=%s", request_id)
    return JSONResponse(status_code=500, content={"detail": "Internal server error", "request_id": request_id})


# police_router first: its /api/v1/alerts/mine must win over /api/v1/alerts/{alert_id}
for r in (police_router, auth_router, contacts_router, route_router, walk_router, alerts_router, guardian_router,
          evidence_router, ratings_router, dashboard_router, report_router, scream_router, track_router,
          checkin_router, safety_router, nav_router):
    app.include_router(r)

# Community buddy matching, server-side risk and media relay need PostgreSQL/PostGIS
# (asyncpg pool). They stay unmounted until that deployment exists; see docs/ROADMAP.md.
if settings.POSTGRES_DSN:
    logger.warning("POSTGRES_DSN is set, but PostGIS routers are not wired to a pool yet; they remain disabled")

# Authority Dashboard web app (DASH-1 to DASH-6)
dashboard_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "dashboard"))
if os.path.isdir(dashboard_dir):
    app.mount("/dashboard", StaticFiles(directory=dashboard_dir, html=True), name="dashboard")


async def _accept_with_ticket(websocket: WebSocket, channel_id: str):
    """Validates the one-time ticket (NFR-10) and accepts; returns the ticket record or None."""
    ticket = websocket.query_params.get("ticket")
    record = await storage.consume_ws_ticket(ticket, channel_id) if ticket else None
    if not record:
        await websocket.close(code=1008, reason="Missing, invalid or expired ticket")
        return None
    await websocket.accept()
    await broker.register(channel_id, websocket)
    return record


@app.websocket("/ws/walk/{walk_id}")
async def walk_live_stream(websocket: WebSocket, walk_id: str):
    """
    WALK-3: Live location for a walk. Guardians subscribe read-only; only the
    walker's own connection may publish location frames.
    """
    record = await _accept_with_ticket(websocket, walk_id)
    if not record:
        return
    walk = await storage.get_walk(walk_id)
    is_walker = bool(walk) and walk["user_id"] == record["user_id"]
    try:
        while True:
            data = await websocket.receive_text()
            if not is_walker:
                continue  # subscribers may send keep-alives; nothing is relayed
            try:
                frame = json.loads(data)
                lat, lon = float(frame["lat"]), float(frame["lon"])
            except (ValueError, KeyError, TypeError):
                continue
            await broker.broadcast(walk_id, {"type": "location", "walk_id": walk_id, "lat": lat, "lon": lon,
                                             "ts": frame.get("ts")})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WebSocket error on walk %s: %s", walk_id, e)
    finally:
        await broker.unregister(walk_id, websocket)


@app.websocket("/ws/alert/{alert_id}")
@app.websocket("/ws/location/{alert_id}")  # legacy path used by older app builds
async def alert_live_stream(websocket: WebSocket, alert_id: str):
    """Read-only live trail of an SOS; the walker publishes via POST /api/v1/alerts/{id}/location."""
    if not await _accept_with_ticket(websocket, alert_id):
        return
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await broker.unregister(alert_id, websocket)


@app.get("/api/v1/config/maps")
@limiter.limit("60/minute")
def map_config(request: Request):
    """Basemap settings for the dashboard and app, so the CARTO key lives in server config, not in source files."""
    if settings.CARTO_API_KEY:
        key = settings.CARTO_API_KEY
        return {
            "provider": "carto",
            "raster_url": f"https://basemaps.cartocdn.com/rastertiles/voyager/{{z}}/{{x}}/{{y}}.png?key={key}",
            "vector_style_url": f"https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json?key={key}",
            "attribution": '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap contributors',
        }
    # CARTO's keyless tiles now render "API KEY REQUIRED"; OpenStreetMap tiles need no key.
    return {
        "provider": "osm",
        "raster_url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "vector_style_url": None,
        "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }


@app.get("/health")
@limiter.limit("60/minute")
def health_check(request: Request):
    """Liveness: the process is up."""
    return {"status": "healthy", "service": "shield-walk-core", "srs_version": "1.0"}


@app.get("/ready")
async def readiness(request: Request):
    """Readiness: dependencies answer. Load balancers should route on this."""
    db_ok = await storage.ping()
    body = {"database": db_ok, "redis": request.app.state.redis_pool is not None}
    return JSONResponse(status_code=200 if db_ok else 503, content={"status": "ready" if db_ok else "degraded", **body})
