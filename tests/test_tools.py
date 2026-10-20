from backend.agent.tools import call_tool


def test_ari_level_latest(fixture_db):
    out = call_tool("get_ari_level", {"state": "ohio"})
    assert out["as_of"] == "2026-10-10"
    assert out["source_table"] == "ari_activity"
    assert out["rows"] == [{"week_end": "2026-10-10", "state": "Ohio", "level": "Low"}]


def test_unknown_state_is_readable_error(fixture_db):
    out = call_tool("get_ari_level", {"state": "Narnia"})
    assert "Unknown state" in out["error"]
    assert "Ohio" in out["allowed"]


def test_states_at_level(fixture_db):
    out = call_tool("list_states_at_level", {"level": "high"})
    assert out["count"] == 2
    assert [r["state"] for r in out["rows"]] == ["Texas", "Utah"]


def test_hospitalization_rate(fixture_db):
    out = call_tool("get_hospitalization_rate", {"network": "COVID-NET", "weeks": 2})
    assert out["as_of"] == "2026-10-10"
    assert [r["rate_per_100k"] for r in out["rows"]] == [0.8, 1.1]


def test_positivity_specific_week(fixture_db):
    out = call_tool("get_test_positivity", {"pathogen": "covid-19", "week": "2026-10-03"})
    assert out["rows"][0]["percent_positive"] == 4.1


def test_wastewater_state(fixture_db):
    out = call_tool("get_wastewater", {"state": "Ohio"})
    assert out["rows"][0]["avg_percentile"] == 50.0
    assert out["rows"][0]["site_count"] == 2


def test_forecast_without_model_is_error(fixture_db, monkeypatch, tmp_path):
    import backend.forecasting as forecasting

    monkeypatch.setattr(forecasting, "MODEL_DIR", str(tmp_path / "none"))
    out = call_tool("get_forecast", {"virus": "COVID-NET"})
    assert "No trained forecast" in out["error"]


def test_freshness_flags_stale_wastewater(fixture_db):
    rows = {r["table"]: r for r in call_tool("get_data_freshness", {})["rows"]}
    assert rows["wastewater_sites"]["stale"] is True


def test_invalid_inputs(fixture_db):
    assert "Invalid inputs" in call_tool("get_hospitalization_rate", {"network": "COVID-NET", "weeks": 500})["error"]
    assert "Unknown tool" in call_tool("drop_tables", {})["error"]
