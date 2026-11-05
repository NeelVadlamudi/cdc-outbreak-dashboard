"""Multi-source adapters: parse/normalize only — no live network in unit tests."""

from backend.sources.cdc_burden import normalize_burden_rows
from backend.sources.owid_covid import parse_owid_weekly_deaths_csv
from backend.sources.registry import SOURCE_REGISTRY, list_sources, replace_external_series


def test_registry_has_core_and_supplements():
    assert "cdc_soda" in SOURCE_REGISTRY
    assert SOURCE_REGISTRY["cdc_soda"].role == "core"
    assert SOURCE_REGISTRY["owid_weekly_covid_deaths"].role == "supplement"
    assert SOURCE_REGISTRY["cdc_covid_burden"].role == "supplement"


def test_parse_owid_keeps_latest_per_peer():
    csv = """entity,code,day,weekly_deaths
United States,USA,2026-10-11,100
United States,USA,2026-10-18,146
Canada,CAN,2026-10-18,0
Atlantis,ATL,2026-10-18,999
United Kingdom,GBR,2026-10-18,
"""
    rows = parse_owid_weekly_deaths_csv(csv, retrieved_at="2026-11-05T00:00:00Z")
    by_geo = {r["geography"]: r for r in rows}
    assert set(by_geo) == {"United States", "Canada"}
    assert by_geo["United States"]["value"] == 146.0
    assert by_geo["United States"]["as_of"] == "2026-10-18"
    assert by_geo["United States"]["citation"]


def test_normalize_burden_latest_ranges(fixture_db):
    records = [
        {"burden": "Deaths", "season": "2024-2025", "date": "2024-10-12T00:00:00.000", "low": "1700", "high": "5500"},
        {"burden": "Hospitalizations", "season": "2024-2025", "date": "2024-10-12T00:00:00.000", "low": "15000", "high": "44000"},
        {"burden": "Deaths", "season": "2024-2025", "date": "2024-11-01T00:00:00.000", "low": "2000", "high": "6000"},
        {"burden": "Cases", "season": "2024-2025", "date": "2024-11-01T00:00:00.000", "low": "1", "high": "2"},
    ]
    rows = normalize_burden_rows(records, retrieved_at="2026-11-05T00:00:00Z")
    by_id = {r["series_id"]: r for r in rows}
    assert set(by_id) == {"burden_deaths", "burden_hospitalizations"}
    assert by_id["burden_deaths"]["as_of"] == "2024-11-01"
    assert by_id["burden_deaths"]["value"] == 2000.0
    assert by_id["burden_deaths"]["value_high"] == 6000.0
    n = replace_external_series("cdc_covid_burden", rows)
    assert n == 2
    payload = list_sources()
    assert any(s["source_id"] == "cdc_covid_burden" for s in payload["sources"])
    assert any(r["source_id"] == "cdc_covid_burden" for r in payload["series"])


def test_sources_route(fixture_db):
    from fastapi.testclient import TestClient

    from backend.main import app

    res = TestClient(app).get("/api/sources")
    assert res.status_code == 200
    body = res.json()
    assert "sources" in body
    assert "series" in body
    ids = {s["source_id"] for s in body["sources"]}
    assert "cdc_soda" in ids
    assert "owid_weekly_covid_deaths" in ids
    assert "cdc_covid_burden" in ids


def test_dashboard_summary_includes_sources(fixture_db):
    from fastapi.testclient import TestClient

    from backend.main import app

    body = TestClient(app).get("/api/dashboard-summary").json()
    assert "sources" in body
    assert isinstance(body["sources"].get("chips"), list)
