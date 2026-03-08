"""
FastAPI REST API routes for the CDC Outbreak Dashboard.
Phase 2: Expanded with wastewater, ensemble AI, LLM chat, anomaly detection, and simulator.
"""

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.database import query
from backend.forecasting import generate_forecast, train_model
from backend.ensemble import (
    train_xgboost, xgb_forecast, detect_anomalies,
    get_age_heatmap_data, get_season_comparison,
)
from backend.llm_engine import chat_with_data, generate_weekly_brief
from backend.simulator import run_simulation, SimulationParams, get_current_rates
import asyncio
import json
from datetime import datetime

router = APIRouter(prefix="/api")


# ─── Helper ──────────────────────────────────────────────────────────────────

def serialize_dates(results, date_fields=None):
    """Convert date objects to ISO strings for JSON serialization."""
    if date_fields is None:
        date_fields = ["week_end", "week_ending_date", "date_start", "date_end",
                       "first_sample_date", "detected_date"]
    for r in results:
        for field in date_fields:
            if field in r and hasattr(r[field], "isoformat"):
                r[field] = r[field].isoformat() if r[field] else None
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Core Endpoints (ARI, Hospitalizations, Positivity, Forecasts)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/ari-activity")
async def get_ari_activity(
    week_end: str = Query(None),
    geography: str = Query(None),
):
    """Get current ARI activity levels by state."""
    sql = "SELECT * FROM ari_activity WHERE 1=1"
    params = []

    if week_end:
        sql += " AND week_end = ?"
        params.append(week_end)
    else:
        sql += " AND week_end = (SELECT MAX(week_end) FROM ari_activity)"

    if geography:
        sql += " AND geography = ?"
        params.append(geography)

    sql += " ORDER BY geography"
    results = query(sql, params if params else None)
    serialize_dates(results)
    return {"data": results, "count": len(results)}


@router.get("/ari-activity/history")
async def get_ari_history(geography: str = Query("Alabama")):
    """Get historical ARI activity for a state."""
    results = query("""
        SELECT week_end, geography, label
        FROM ari_activity WHERE geography = ?
        ORDER BY week_end DESC LIMIT 52
    """, [geography])
    serialize_dates(results)
    return {"data": results}


@router.get("/hospitalizations")
async def get_hospitalizations(
    network: str = Query(None),
    site: str = Query(None),
    age_group: str = Query("Overall"),
    limit: int = Query(200),
):
    """Get RESP-NET hospitalization rates."""
    sql = """
        SELECT surveillance_network, season, week_ending_date, mmwr_year, mmwr_week,
               age_group, site, weekly_rate, cumulative_rate
        FROM hospitalization_rates
        WHERE age_group = ? AND sex = 'Overall' AND race_ethnicity = 'Overall'
          AND rate_type = 'Observed'
    """
    params = [age_group]
    if network:
        sql += " AND surveillance_network = ?"
        params.append(network)
    if site:
        sql += " AND site = ?"
        params.append(site)
    sql += " ORDER BY week_ending_date DESC LIMIT ?"
    params.append(limit)
    results = query(sql, params)
    serialize_dates(results)
    return {"data": results, "count": len(results)}


@router.get("/hospitalizations/trends")
async def get_hospitalization_trends():
    """Get weekly hospitalization rates grouped by virus for trend charts."""
    results = query("""
        SELECT surveillance_network as virus, week_ending_date, AVG(weekly_rate) as avg_rate
        FROM hospitalization_rates
        WHERE age_group = 'Overall' AND sex = 'Overall' AND race_ethnicity = 'Overall'
          AND rate_type = 'Observed'
        GROUP BY surveillance_network, week_ending_date
        ORDER BY week_ending_date
    """)
    serialize_dates(results)
    return {"data": results}


@router.get("/test-positivity")
async def get_test_positivity(
    pathogen: str = Query(None),
    limit: int = Query(200),
):
    """Get test positivity rates by pathogen."""
    sql = "SELECT * FROM test_positivity WHERE 1=1"
    params = []
    if pathogen:
        sql += " AND pathogen = ?"
        params.append(pathogen)
    sql += " ORDER BY week_end DESC LIMIT ?"
    params.append(limit)
    results = query(sql, params if params else None)
    serialize_dates(results)
    return {"data": results, "count": len(results)}


@router.get("/test-positivity/latest")
async def get_latest_positivity():
    """Get the most recent test positivity for all pathogens."""
    results = query("""
        SELECT pathogen, percent_test_positivity, week_end
        FROM test_positivity
        WHERE week_end = (SELECT MAX(week_end) FROM test_positivity)
        ORDER BY pathogen
    """)
    serialize_dates(results)
    return {"data": results}


@router.get("/forecast/{virus}")
async def get_forecast(virus: str = "COVID-NET"):
    """Get 4-week LSTM forecast for a specific virus."""
    return generate_forecast(virus)


@router.post("/forecast/train/{virus}")
async def trigger_training(virus: str = "COVID-NET"):
    """Trigger LSTM model training for a specific virus."""
    return train_model(virus)


@router.get("/dashboard-summary")
async def get_dashboard_summary():
    """Get aggregated dashboard summary stats."""
    risk_data = query("""
        SELECT label, COUNT(*) as count FROM ari_activity
        WHERE week_end = (SELECT MAX(week_end) FROM ari_activity)
        GROUP BY label ORDER BY count DESC
    """)

    latest_ari = query("SELECT MAX(week_end) as latest FROM ari_activity")
    latest_hosp = query("SELECT MAX(week_ending_date) as latest FROM hospitalization_rates")
    latest_positivity = query("SELECT MAX(week_end) as latest FROM test_positivity")

    positivity = query("""
        SELECT pathogen, percent_test_positivity FROM test_positivity
        WHERE week_end = (SELECT MAX(week_end) FROM test_positivity)
    """)

    total_states = query("SELECT COUNT(DISTINCT geography) as n FROM ari_activity")
    high_risk = query("""
        SELECT COUNT(*) as count FROM ari_activity
        WHERE week_end = (SELECT MAX(week_end) FROM ari_activity)
          AND label IN ('High', 'Very High')
    """)

    # Wastewater summary
    ww_summary = {}
    try:
        ww = query("""
            SELECT COUNT(DISTINCT wwtp_id) as sites,
                   COUNT(DISTINCT county_fips) as counties,
                   AVG(percentile) as avg_percentile
            FROM wastewater_sites
            WHERE date_end = (SELECT MAX(date_end) FROM wastewater_sites)
        """)
        if ww:
            ww_summary = ww[0]
    except Exception:
        pass

    def safe_date(val):
        if val and hasattr(val, "isoformat"):
            return val.isoformat()
        return str(val) if val else None

    return {
        "risk_distribution": risk_data,
        "latest_dates": {
            "ari_activity": safe_date(latest_ari[0]["latest"]) if latest_ari else None,
            "hospitalizations": safe_date(latest_hosp[0]["latest"]) if latest_hosp else None,
            "test_positivity": safe_date(latest_positivity[0]["latest"]) if latest_positivity else None,
        },
        "latest_positivity": positivity,
        "total_states_tracked": total_states[0]["n"] if total_states else 0,
        "high_risk_states": high_risk[0]["count"] if high_risk else 0,
        "wastewater_summary": ww_summary,
    }


@router.get("/states")
async def get_states():
    """Get list of all states/territories."""
    results = query("SELECT DISTINCT geography FROM ari_activity ORDER BY geography")
    return {"states": [r["geography"] for r in results]}


@router.get("/hospitalizations/sites")
async def get_sites():
    """Get list of all RESP-NET sites."""
    results = query("SELECT DISTINCT site FROM hospitalization_rates ORDER BY site")
    return {"sites": [r["site"] for r in results]}


@router.get("/events/stream")
async def event_stream():
    """Server-Sent Events for live dashboard updates."""
    async def generate():
        while True:
            summary = await get_dashboard_summary()
            yield f"data: {json.dumps(summary)}\n\n"
            await asyncio.sleep(30)
    return StreamingResponse(generate(), media_type="text/event-stream")


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2A: Wastewater Surveillance (County-Level)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/wastewater")
async def get_wastewater(
    state: str = Query(None, description="Filter by state jurisdiction"),
    county: str = Query(None, description="Filter by county name"),
    limit: int = Query(5000),
):
    """Get wastewater surveillance data — county/site level."""
    sql = """
        SELECT wwtp_jurisdiction, wwtp_id, county_names, county_fips,
               population_served, date_end, ptc_15d, detect_prop_15d, percentile
        FROM wastewater_sites WHERE 1=1
    """
    params = []
    if state:
        sql += " AND wwtp_jurisdiction = ?"
        params.append(state)
    if county:
        sql += " AND county_names LIKE ?"
        params.append(f"%{county}%")
    sql += " ORDER BY date_end DESC LIMIT ?"
    params.append(limit)
    results = query(sql, params if params else None)
    serialize_dates(results)
    return {"data": results, "count": len(results)}


@router.get("/wastewater/latest")
async def get_wastewater_latest():
    """Get the most recent wastewater data for all sites."""
    results = query("""
        SELECT wwtp_jurisdiction as state, county_names as county, county_fips as fips,
               wwtp_id, population_served, percentile, ptc_15d as pct_change,
               detect_prop_15d as detection_rate, date_end
        FROM wastewater_sites
        WHERE date_end = (SELECT MAX(date_end) FROM wastewater_sites)
        ORDER BY percentile DESC
    """)
    serialize_dates(results)
    return {"data": results, "count": len(results)}


@router.get("/wastewater/county/{fips}")
async def get_wastewater_county(fips: str):
    """Get wastewater trend for a specific county by FIPS code."""
    results = query("""
        SELECT date_end, percentile, ptc_15d, detect_prop_15d, population_served,
               county_names, wwtp_jurisdiction
        FROM wastewater_sites
        WHERE county_fips = ?
        ORDER BY date_end
    """, [fips])
    serialize_dates(results)
    return {"data": results, "county_fips": fips}


@router.get("/wastewater/states")
async def get_wastewater_states():
    """Get wastewater summary by state."""
    results = query("""
        SELECT wwtp_jurisdiction as state,
               COUNT(DISTINCT wwtp_id) as sites,
               COUNT(DISTINCT county_fips) as counties,
               AVG(percentile) as avg_percentile,
               AVG(ptc_15d) as avg_pct_change
        FROM wastewater_sites
        WHERE date_end = (SELECT MAX(date_end) FROM wastewater_sites)
        GROUP BY wwtp_jurisdiction
        ORDER BY avg_percentile DESC
    """)
    return {"data": results}


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2B: Advanced AI (XGBoost, Anomalies, Age Heatmap, Season Compare)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/ensemble/forecast/{virus}")
async def get_ensemble_forecast(virus: str = "COVID-NET"):
    """Get XGBoost forecast for a specific virus."""
    return xgb_forecast(virus)


@router.post("/ensemble/train/{virus}")
async def trigger_xgb_training(virus: str = "COVID-NET"):
    """Train XGBoost model for a specific virus."""
    return train_xgboost(virus)


@router.get("/ensemble/compare/{virus}")
async def compare_models(virus: str = "COVID-NET"):
    """Compare LSTM vs XGBoost forecasts side-by-side."""
    lstm_result = generate_forecast(virus)
    xgb_result = xgb_forecast(virus)
    return {
        "lstm": lstm_result,
        "xgboost": xgb_result,
        "virus": virus,
    }


@router.get("/anomalies")
async def get_anomalies():
    """Detect anomalies in the latest surveillance data."""
    return {"anomalies": detect_anomalies()}


@router.get("/age-heatmap/{network}")
async def get_age_heatmap(network: str = "COVID-NET"):
    """Get age-stratified hospitalization heatmap data."""
    return {"data": get_age_heatmap_data(network)}


@router.get("/season-comparison")
async def get_season_compare():
    """Get season-over-season comparison data aligned by epi-week."""
    return {"data": get_season_comparison()}


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2C: LLM + RAG Chat
# ═══════════════════════════════════════════════════════════════════════════════

class ChatMessage(BaseModel):
    question: str


@router.post("/chat")
async def chat_endpoint(msg: ChatMessage):
    """RAG-powered chat — ask questions about the surveillance data."""
    result = await chat_with_data(msg.question)
    return result


@router.get("/weekly-brief")
async def get_weekly_brief():
    """Get auto-generated weekly health brief."""
    return generate_weekly_brief()


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2D: Hospital Capacity Simulator
# ═══════════════════════════════════════════════════════════════════════════════

class SimRequest(BaseModel):
    population: int = 1_000_000
    current_rate: float = 5.0
    surge_multiplier: float = 2.0
    hospitalization_pct: float = 10.0
    icu_pct: float = 20.0
    avg_los_days: float = 5.0
    icu_los_days: float = 10.0
    beds_available: int = 500
    icu_beds_available: int = 50
    cost_per_bed_day: float = 3000.0
    cost_per_icu_day: float = 8000.0
    weeks: int = 8


@router.post("/simulator/run")
async def run_sim(req: SimRequest):
    """Run Monte Carlo hospital capacity simulation."""
    params = SimulationParams(
        population=req.population,
        current_rate_per_100k=req.current_rate,
        surge_multiplier=req.surge_multiplier,
        hospitalization_pct=req.hospitalization_pct,
        icu_pct=req.icu_pct,
        avg_los_days=req.avg_los_days,
        icu_los_days=req.icu_los_days,
        beds_available=req.beds_available,
        icu_beds_available=req.icu_beds_available,
        cost_per_bed_day=req.cost_per_bed_day,
        cost_per_icu_day=req.cost_per_icu_day,
        weeks_to_simulate=req.weeks,
    )
    return run_simulation(params)


@router.get("/simulator/defaults")
async def get_sim_defaults():
    """Get current hospitalization rates for simulation defaults."""
    rates = get_current_rates()
    return {
        "current_rates": rates,
        "defaults": {
            "population": 1_000_000,
            "hospitalization_pct": 10.0,
            "icu_pct": 20.0,
            "beds_available": 500,
            "icu_beds_available": 50,
        },
    }
