"""Forecast helpers: gap splitting, calendar season feature, window scaling, no training on GET."""

import json
from datetime import date, timedelta

import numpy as np

from backend import forecasting
from backend.forecasting import LOOKBACK, create_samples, season_features, split_segments, window_features


def _weeks(start, n):
    return [start + timedelta(weeks=i) for i in range(n)]


def test_split_segments_breaks_at_gap():
    dates = _weeks(date(2025, 1, 4), 18) + _weeks(date(2025, 10, 4), 10)
    vals = np.arange(len(dates), dtype=np.float32)
    segs = split_segments(dates, vals)
    assert [len(s[1]) for s in segs] == [18, 10]
    assert segs[1][0][0] == date(2025, 10, 4)


def test_samples_never_cross_gap():
    dates = _weeks(date(2025, 1, 4), 18) + _weeks(date(2025, 10, 4), 20)
    vals = np.ones(len(dates), dtype=np.float32)
    X, y = create_samples(dates, vals)
    # 18-12-4+1 = 3 samples before the gap, 20-12-4+1 = 5 after
    assert len(X) == 8


def test_season_feature_uses_calendar_week():
    a = season_features(date(2023, 1, 7))
    b = season_features(date(2025, 1, 4))
    assert np.allclose(a, b, atol=0.13)  # ISO week 1 both years
    assert not np.allclose(season_features(date(2025, 7, 5)), b, atol=0.5)


def test_window_scaling_is_local():
    dates = _weeks(date(2025, 1, 4), LOOKBACK)
    low, s_low = window_features(dates, np.full(LOOKBACK, 0.5, dtype=np.float32))
    high, s_high = window_features(dates, np.full(LOOKBACK, 5.0, dtype=np.float32))
    assert s_high > s_low
    assert np.allclose(low[:, 4:], high[:, 4:])


def test_generate_forecast_does_not_train(tmp_path, monkeypatch):
    monkeypatch.setattr(forecasting, "MODEL_DIR", str(tmp_path))
    called = []
    monkeypatch.setattr(forecasting, "fit_lstm", lambda *a, **k: called.append(1))
    assert forecasting.generate_forecast("COVID-NET")["status"] == "no_model"
    assert not called and not list(tmp_path.iterdir())


def test_xgb_forecast_does_not_train(tmp_path, monkeypatch):
    import backend.ensemble as ensemble

    monkeypatch.setattr(ensemble, "MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(ensemble, "train_xgboost", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    assert ensemble.xgb_forecast("COVID-NET")["status"] == "no_model"


def test_backtest_vs_last_value(tmp_path, monkeypatch):
    from backend import config
    from backend.agent.tools import backtest_vs_last_value

    bt = {"run_at": "x", "models": [
        {"model": "LSTM · COVID-NET", "horizons": [{"h": 1, "mae": 0.3}, {"h": 2, "mae": 0.3}]},
        {"model": "XGBoost · COVID-NET", "horizons": [{"h": 1, "mae": 0.05}, {"h": 2, "mae": 0.5}]},
        {"model": "Last value · COVID-NET", "horizons": [{"h": 1, "mae": 0.1}, {"h": 2, "mae": 0.2}]},
    ]}
    p = tmp_path / "bt.json"
    p.write_text(json.dumps(bt))
    monkeypatch.setattr(config, "BACKTEST_PATH", str(p))
    out = backtest_vs_last_value("COVID-NET")
    assert out["lstm"]["beats_last_value"] is False
    assert "did not beat" in out["lstm"]["note"]
    assert out["xgboost"]["beats_last_value"] is False
    assert "1 of 2" in out["xgboost"]["note"]
