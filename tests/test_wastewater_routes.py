from fastapi.testclient import TestClient


def _client():
    from backend.main import app

    return TestClient(app)  # no context manager: skips startup ingestion


def test_wastewater_latest_defaults_to_current_dataset(fixture_db):
    body = _client().get("/api/wastewater/latest?pathogen=RSV").json()
    assert body["source_dataset"] == "atcp-73re"
    assert body["count"] == 3
    assert "legacy_percentile" not in body["data"][0]
    assert {"wval", "wval_category", "pathogen"} <= set(body["data"][0])


def test_wastewater_legacy_fields_are_labelled(fixture_db):
    body = _client().get("/api/wastewater/latest?dataset=legacy").json()
    assert body["dataset"] == "legacy"
    assert "2025-09-07" in body["note"]
    pct = sorted(r["legacy_percentile"] for r in body["data"] if r["legacy_percentile"] is not None)
    assert pct == [40.0, 60.0]  # the 999 sentinel is excluded


def test_wastewater_states_current(fixture_db):
    body = _client().get("/api/wastewater/states?pathogen=RSV").json()
    by_state = {r["state"]: r for r in body["data"]}
    assert by_state["Ohio"]["sites"] == 2 and by_state["Ohio"]["sites_high"] == 1


def test_wastewater_rejects_unknown_dataset(fixture_db):
    assert _client().get("/api/wastewater?dataset=other").status_code == 400
