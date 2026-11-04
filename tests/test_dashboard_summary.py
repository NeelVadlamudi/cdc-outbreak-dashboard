"""Contract tests for /api/dashboard-summary enrichment and /api/health checked_at."""

from fastapi.testclient import TestClient


def test_dashboard_summary_dual_layer(fixture_db):
    from backend.main import app

    body = TestClient(app).get("/api/dashboard-summary").json()
    assert body["week_ending"] == "2026-10-10"
    assert body["high_risk_states"] == 2
    assert body["total_states_tracked"] == 3
    assert "metrics" in body and "briefing" in body

    covid = body["metrics"]["positivity_covid"]
    assert covid["value"] == 3.6
    assert covid["unit"] == "%"
    assert covid["plain"] == "about 1 in 28 tests positive"
    assert covid["week_ending"] == "2026-10-10"
    assert covid["source_table"] == "test_positivity"
    assert "down from 4.1%" in (covid.get("insight") or "")

    high = body["metrics"]["high_risk"]
    assert high["value"] == 2
    assert high["plain"] == "2 of 3 states/territories at High or Very High activity"

    briefing = body["briefing"]
    assert briefing["known"]
    assert "2026-10-10" in briefing["this_week"]
    assert "implication" in briefing


def test_health_includes_checked_at(fixture_db):
    from backend.main import app

    body = TestClient(app).get("/api/health").json()
    assert body["as_of"] == "2026-10-10"
    assert body["checked_at"]
    assert body["checked_at"].endswith("Z")
    assert isinstance(body.get("tables"), list)
