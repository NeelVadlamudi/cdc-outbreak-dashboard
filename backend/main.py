"""
CDC Respiratory Virus Dashboard: FastAPI application
Main entry point with lifespan events, CORS, and route mounting.
"""

import logging
import time
import uuid
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.cdc_ingestion import run_full_ingestion
from backend.config import ALLOWED_ORIGINS, ENABLE_API_DOCS, INGEST_ON_STARTUP, configure_logging, request_id_var
from backend.database import init_database
from backend.routes import router

configure_logging()
logger = logging.getLogger(__name__)

# Scheduler for periodic data refresh
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — initialize DB and fetch initial data."""
    logger.info("CDC Outbreak Dashboard starting up")

    # Initialize database
    init_database()

    if INGEST_ON_STARTUP:
        # Run initial data ingestion
        await run_full_ingestion()

        # Schedule periodic refresh (every 60 minutes)
        scheduler.add_job(run_full_ingestion, "interval", minutes=60, id="cdc_refresh")
        scheduler.start()
        logger.info("Scheduled data refresh every 60 minutes")
    else:
        logger.info("INGEST_ON_STARTUP is false; serving the database as is")

    yield

    # Shutdown
    if scheduler.running:
        scheduler.shutdown()
    logger.info("Dashboard shutting down")


app = FastAPI(
    title="CDC Respiratory Virus Dashboard",
    description="Live CDC respiratory surveillance data, forecasts and a live data question box",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if ENABLE_API_DOCS else None,
    redoc_url="/redoc" if ENABLE_API_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_API_DOCS else None,
)

# CORS — only the frontend origin(s) set in ALLOWED_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)



@app.middleware("http")
async def request_log(request: Request, call_next):
    """Tag every log line in a request with a request id and log one line per request."""
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    token = request_id_var.set(rid)
    start = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        logger.info("request", extra={"event": "request", "method": request.method, "path": request.url.path,
                                      "status": response.status_code,
                                      "elapsed_s": round(time.perf_counter() - start, 3)})
        return response
    finally:
        request_id_var.reset(token)


# Mount routes
app.include_router(router)


@app.get("/api/health")
async def health():
    """Liveness check for the host (Render health check). Opens the database read-only."""
    import duckdb

    from backend import config

    try:
        con = duckdb.connect(config.DB_PATH, read_only=True)
        latest = con.execute("SELECT MAX(week_end) FROM test_positivity").fetchone()[0]
        con.close()
    except Exception as e:  # report, but keep the shape
        return {"status": "degraded", "database": f"error: {type(e).__name__}"}
    return {"status": "ok", "database": "ok", "latest_week": latest.isoformat() if latest else None}


@app.get("/")
async def root():
    return {
        "name": "CDC Respiratory Virus Dashboard",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs" if ENABLE_API_DOCS else None,
        "endpoints": {
            "dashboard_summary": "/api/dashboard-summary",
            "ari_activity": "/api/ari-activity",
            "hospitalizations": "/api/hospitalizations",
            "test_positivity": "/api/test-positivity",
            "forecast": "/api/forecast/{virus}",
            "live_stream": "/api/events/stream",
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
