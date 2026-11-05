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

    def _refresh_supplements():
        try:
            from backend.sources import refresh_all_supplements

            refresh_all_supplements()
        except Exception:
            logger.exception("supplement source refresh failed (fail soft)")

    if INGEST_ON_STARTUP:
        # Run initial data ingestion
        await run_full_ingestion()
        _refresh_supplements()

        # Schedule periodic refresh (every 60 minutes)
        scheduler.add_job(run_full_ingestion, "interval", minutes=60, id="cdc_refresh")
        scheduler.add_job(_refresh_supplements, "interval", minutes=180, id="supplement_refresh")
        scheduler.start()
        logger.info("Scheduled data refresh every 60 minutes; supplements every 180 minutes")
    else:
        # Still try supplements once so Overview provenance chips have something to show
        # when a live DuckDB was mounted without re-ingest.
        _refresh_supplements()
        logger.info("INGEST_ON_STARTUP is false; serving the database as is (supplements attempted once)")

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


def _data_plane_meta() -> dict:
    """How the process loaded DuckDB (url vs frozen snapshot). Fail open if marker missing."""
    import json
    import os
    from pathlib import Path

    from backend import config

    url = (os.environ.get("CDC_DB_URL") or "").strip()
    on_render = os.environ.get("RENDER", "").lower() in {"true", "1"}
    meta = {
        # True when env is set OR Render will use the public release default.
        "cdc_db_url_configured": bool(url) or on_render,
        "data_plane": "unknown",
        "data_plane_detail": None,
    }
    marker = Path(config.DB_PATH).with_suffix(Path(config.DB_PATH).suffix + ".source.json")
    if marker.is_file():
        try:
            payload = json.loads(marker.read_text(encoding="utf-8"))
            source = payload.get("source")
            if source == "url":
                meta["data_plane"] = "live_release"
                meta["cdc_db_url_configured"] = True
            elif source == "snapshot":
                meta["data_plane"] = "snapshot_fallback"
            meta["data_plane_detail"] = payload.get("error") or payload.get("fetched_at")
            meta["data_plane_fetched_at"] = payload.get("fetched_at")
        except (OSError, json.JSONDecodeError):
            pass
    elif not url and not on_render:
        # Local/dev without fetch script: typically the frozen snapshot path.
        meta["data_plane"] = "snapshot_fallback"
        meta["data_plane_detail"] = "CDC_DB_URL unset; no fetch marker"
    return meta


@app.get("/api/health")
async def health():
    """Liveness check for the host (Render health check). Includes per-table as_of + stale flags."""
    from datetime import datetime, timezone

    from backend import config
    from backend.agent.tools import get_data_freshness

    checked_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    plane = _data_plane_meta()
    try:
        fresh = get_data_freshness()
        tables = fresh.get("rows") or []
        stale = [t for t in tables if t.get("stale") and not t.get("legacy")]
        latest = fresh.get("as_of")
        status = "ok" if not stale else "stale"
        return {
            "status": status,
            "database": "ok",
            "latest_week": latest,
            "as_of": latest,
            "checked_at": checked_at,
            "stale_after_days": config.STALE_AFTER_DAYS,
            "tables": tables,
            "stale_tables": [
                (t["table"] + (f" ({t['dataset']})" if t.get("dataset") else "")) for t in stale
            ],
            **plane,
        }
    except Exception as e:  # report, but keep the shape so the UI can show failure
        return {
            "status": "degraded",
            "database": f"error: {type(e).__name__}",
            "latest_week": None,
            "as_of": None,
            "checked_at": checked_at,
            "tables": [],
            "stale_tables": [],
            "error": str(e) or type(e).__name__,
            **plane,
        }


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
