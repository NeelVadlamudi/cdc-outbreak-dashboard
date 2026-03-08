"""
CDC Live Respiratory Virus AI Dashboard — FastAPI Application
Main entry point with lifespan events, CORS, and route mounting.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from backend.database import init_database
from backend.cdc_ingestion import run_full_ingestion
from backend.routes import router

# Scheduler for periodic data refresh
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — initialize DB and fetch initial data."""
    print("\n🏥 CDC Outbreak Dashboard — Starting up...")

    # Initialize database
    init_database()

    # Run initial data ingestion
    await run_full_ingestion()

    # Schedule periodic refresh (every 60 minutes)
    scheduler.add_job(run_full_ingestion, "interval", minutes=60, id="cdc_refresh")
    scheduler.start()
    print("⏰ Scheduled data refresh every 60 minutes\n")

    yield

    # Shutdown
    scheduler.shutdown()
    print("\n🛑 Dashboard shutting down...")


app = FastAPI(
    title="CDC Live Respiratory Virus AI Dashboard",
    description="Real-time outbreak prediction using CDC SODA API data + LSTM neural networks",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(router)


@app.get("/")
async def root():
    return {
        "name": "CDC Live Respiratory Virus AI Dashboard",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs",
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
