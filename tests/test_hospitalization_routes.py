"""Hospitalization list/trends must match CDC RESP-NET 'All' demographics."""

from fastapi.testclient import TestClient


def _client():
    from backend.main import app

    return TestClient(app)  # no context manager: skips startup ingestion


def test_hospitalizations_returns_all_demographics(fixture_db):
    body = _client().get("/api/hospitalizations?limit=50").json()
    assert body["count"] >= 1
    assert any(r["surveillance_network"] == "COVID-NET" for r in body["data"])


def test_hospitalization_trends_not_empty(fixture_db):
    body = _client().get("/api/hospitalizations/trends").json()
    assert len(body["data"]) >= 1
    viruses = {r["virus"] for r in body["data"]}
    assert "COVID-NET" in viruses
    assert all(r.get("avg_rate") is not None for r in body["data"])
