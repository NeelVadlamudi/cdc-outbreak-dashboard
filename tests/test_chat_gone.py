"""Unverified /api/chat is retired in favor of the grounded agent."""

from fastapi.testclient import TestClient


def test_chat_returns_410(fixture_db):
    from backend.main import app

    res = TestClient(app).post("/api/chat", json={"question": "hello"})
    assert res.status_code == 410
    detail = res.json()["detail"]
    assert detail["use"] == "/api/agent/ask"


def test_last_value_forecast_primary(fixture_db):
    from backend.main import app

    body = TestClient(app).get("/api/forecast/COVID-NET").json()
    assert body["status"] == "success"
    assert body["primary"] == "last_value"
    assert body["model"] == "last_value"
    assert body["forecasts"]
