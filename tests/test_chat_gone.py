"""Unverified /api/chat is retired in favor of the grounded agent."""

from fastapi.testclient import TestClient


def test_chat_returns_410(fixture_db):
    from backend.main import app

    res = TestClient(app).post("/api/chat", json={"question": "hello"})
    assert res.status_code == 410
    detail = res.json()["detail"]
    assert detail["use"] == "/api/agent/ask"


def test_events_stream_returns_410(fixture_db):
    from backend.main import app

    res = TestClient(app).get("/api/events/stream")
    assert res.status_code == 410
    detail = res.json()["detail"]
    assert "/api/health" in detail["use"]


def test_weekly_brief_is_rule_based_not_ensemble(fixture_db):
    from backend.main import app

    body = TestClient(app).get("/api/weekly-brief").json()
    assert body["status"] == "success"
    assert "rule-based" in body["brief"].lower()
    # Must not claim ensemble analysis (old copy said "LSTM + XGBoost ensemble").
    assert "ensemble" not in body["brief"].lower()
    assert "not lstm/xgboost" in body["brief"].lower()


def test_last_value_forecast_primary(fixture_db):
    from backend.main import app

    body = TestClient(app).get("/api/forecast/COVID-NET").json()
    assert body["status"] == "success"
    assert body["primary"] == "last_value"
    assert body["model"] == "last_value"
    assert body["forecasts"]
