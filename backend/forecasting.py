"""
LSTM-based Time-Series Forecasting for CDC Surveillance Data.
Predicts weekly RESP-NET hospitalization rates 1-4 weeks ahead.

Version 2 changes from the first model:
- Each sample is scaled by the mean of its own 12-week input window, so off-season
  weeks are not pulled toward the long-run average.
- The season feature is the calendar week of each data point (sin and cos of the
  ISO week), computed the same way in training and at forecast time.
- The series is split at gaps (weeks missing from the CDC file, such as the
  FluSurv-NET break from 2025-05-03 to 2025-10-04); no sample spans a gap.
"""

import json
import os
from datetime import date, timedelta
from pathlib import Path

import duckdb
import numpy as np
import torch
import torch.nn as nn

from backend.config import DB_PATH  # noqa: E402

MODEL_DIR = os.path.join(Path(__file__).parent.parent, "models")


class LSTMForecaster(nn.Module):
    """LSTM neural network for multi-step time-series forecasting."""

    def __init__(self, input_size=6, hidden_size=64, num_layers=2, output_size=4, dropout=0.2):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0
        )

        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, output_size)
        )

    def forward(self, x):
        # x shape: (batch, seq_len, features)
        lstm_out, _ = self.lstm(x)
        # Use last time step output
        last_output = lstm_out[:, -1, :]
        prediction = self.fc(last_output)
        return prediction


LOOKBACK = 12
HORIZON = 4
MODEL_VERSION = 2
SCALE_EPS = 0.1  # added to the window mean so near-zero weeks do not blow up


def season_features(d: date) -> tuple[float, float]:
    week = d.isocalendar()[1]
    return float(np.sin(2 * np.pi * week / 52)), float(np.cos(2 * np.pi * week / 52))


def split_segments(dates: list, values: np.ndarray) -> list[tuple[list, np.ndarray]]:
    """Split the series wherever consecutive dates are not exactly 7 days apart."""
    segments, start = [], 0
    for i in range(1, len(dates) + 1):
        if i == len(dates) or (dates[i] - dates[i - 1]).days != 7:
            segments.append((dates[start:i], values[start:i]))
            start = i
    return segments


def window_features(dates: list, window: np.ndarray) -> tuple[np.ndarray, float]:
    """Features for one input window, scaled by the window mean. Returns (features, scale)."""
    scale = float(np.mean(window)) + SCALE_EPS
    w = window / scale
    feats = []
    for j in range(len(w)):
        lag1 = w[j - 1] if j > 0 else w[j]
        lag2 = w[j - 2] if j > 1 else w[j]
        roll = float(np.mean(w[max(0, j - 3):j + 1]))
        s, c = season_features(dates[j])
        feats.append([w[j], lag1, lag2, roll, s, c])
    return np.array(feats, dtype=np.float32), scale


def create_samples(dates: list, values: np.ndarray) -> tuple:
    """Supervised samples from every gap-free stretch: 12 weeks in, the next 4 out (scaled)."""
    X, y = [], []
    for seg_dates, seg_vals in split_segments(dates, values):
        for i in range(LOOKBACK, len(seg_vals) - HORIZON + 1):
            feats, scale = window_features(seg_dates[i - LOOKBACK:i], seg_vals[i - LOOKBACK:i])
            X.append(feats)
            y.append(seg_vals[i:i + HORIZON] / scale)
    if not X:
        return None, None
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


def get_training_data(virus: str = "COVID-NET") -> tuple[list, np.ndarray]:
    """Weekly overall hospitalization rate series (dates, values) from DuckDB."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        rows = conn.execute("""
            SELECT week_ending_date, AVG(weekly_rate) as avg_rate
            FROM hospitalization_rates
            WHERE surveillance_network = ?
              AND age_group = 'Overall' AND site = 'Overall'
              AND sex IN ('All', 'Overall')
              AND race_ethnicity IN ('All', 'Overall')
              AND rate_type = 'Observed' AND weekly_rate IS NOT NULL
            GROUP BY week_ending_date
            ORDER BY week_ending_date
        """, [virus]).fetchall()
    finally:
        conn.close()
    return [r[0] for r in rows], np.array([r[1] for r in rows], dtype=np.float32)


def fit_lstm(dates: list, values: np.ndarray, seed: int = 0):
    """Train in memory. Returns (model, validation MAE in rate units) or (None, None)."""
    X, y = create_samples(dates, values)
    if X is None or len(X) < 10:
        return None, None
    torch.manual_seed(seed)
    split = int(len(X) * 0.8)
    Xt, Xv = torch.FloatTensor(X[:split]), torch.FloatTensor(X[split:])
    yt, yv = torch.FloatTensor(y[:split]), torch.FloatTensor(y[split:])
    model = LSTMForecaster(input_size=6, hidden_size=64, num_layers=2, output_size=HORIZON)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.MSELoss()
    best, best_state, patience = float("inf"), None, 0
    for _ in range(200):
        model.train()
        optimizer.zero_grad()
        loss = criterion(model(Xt), yt)
        loss.backward()
        optimizer.step()
        model.eval()
        with torch.no_grad():
            val = criterion(model(Xv), yv).item()
        if val < best:
            best, patience = val, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 20:
                break
    model.load_state_dict(best_state)
    model.eval()
    # validation MAE in rate units: undo each sample's scale
    with torch.no_grad():
        pred = model(Xv).numpy()
    # recover each validation sample's scale from its raw window
    raw_scales = []
    for seg_dates, seg_vals in split_segments(dates, values):
        for i in range(LOOKBACK, len(seg_vals) - HORIZON + 1):
            raw_scales.append(float(np.mean(seg_vals[i - LOOKBACK:i])) + SCALE_EPS)
    scales = np.array(raw_scales[split:])[:, None]
    mae = float(np.mean(np.abs(pred * scales - y[split:] * scales)))
    return model, mae


def predict_lstm(model, dates: list, values: np.ndarray):
    """Forecast the 4 weeks after the last point, from the last gap-free 12 weeks."""
    seg_dates, seg_vals = split_segments(dates, values)[-1]
    if len(seg_vals) < LOOKBACK:
        return None
    feats, scale = window_features(seg_dates[-LOOKBACK:], seg_vals[-LOOKBACK:])
    with torch.no_grad():
        pred = model(torch.FloatTensor(feats[None, :, :])).numpy()[0]
    return np.maximum(pred * scale, 0).tolist()


def _paths(virus: str):
    safe = virus.replace("-", "_").replace(" ", "_").lower()
    return os.path.join(MODEL_DIR, f"lstm_{safe}.pt"), os.path.join(MODEL_DIR, f"params_{safe}.json")


def train_model(virus: str = "COVID-NET") -> dict:
    """Train the LSTM for one network and save it. Run from the command line or the training endpoint."""
    dates, values = get_training_data(virus)
    if len(values) < 30:
        return {"status": "insufficient_data", "samples": len(values)}
    model, mae = fit_lstm(dates, values)
    if model is None:
        return {"status": "insufficient_data"}
    model_path, params_path = _paths(virus)
    os.makedirs(MODEL_DIR, exist_ok=True)
    torch.save(model.state_dict(), model_path)
    with open(params_path, "w") as f:
        json.dump({"virus": virus, "mae": mae, "version": MODEL_VERSION,
                   "trained_through": dates[-1].isoformat()}, f)
    return {"status": "trained", "virus": virus, "mae": round(mae, 4), "trained_through": dates[-1].isoformat()}


def generate_forecast(virus: str = "COVID-NET") -> dict:
    """4-week forecast from a saved model. Never trains; returns no_model if none is saved."""
    model_path, params_path = _paths(virus)
    if not (os.path.exists(model_path) and os.path.exists(params_path)):
        return {"status": "no_model", "detail": "No trained model. Train it from the command line (see README)."}
    with open(params_path) as f:
        params = json.load(f)
    if params.get("version") != MODEL_VERSION:
        return {"status": "no_model", "detail": "Saved model is from an older version; retrain it (see README)."}
    model = LSTMForecaster(input_size=6, hidden_size=64, num_layers=2, output_size=HORIZON)
    model.load_state_dict(torch.load(model_path, weights_only=True))
    model.eval()
    dates, values = get_training_data(virus)
    pred = predict_lstm(model, dates, values) if len(values) else None
    if pred is None:
        return {"status": "insufficient_data"}
    mae = params["mae"]
    last = dates[-1]
    forecasts = []
    for i, val in enumerate(pred):
        uncertainty = mae * (1 + i * 0.3)  # band: validation MAE with a growth factor, not a fitted interval
        forecasts.append({
            "date": (last + timedelta(weeks=i + 1)).isoformat(),
            "predicted_rate": round(float(val), 2),
            "lower_bound": round(max(0, float(val) - uncertainty), 2),
            "upper_bound": round(float(val) + uncertainty, 2),
        })
    return {
        "status": "success",
        "virus": virus,
        "mae": round(mae, 4),
        "last_data_date": last.isoformat(),
        "forecasts": forecasts,
        "historical_recent": [round(float(v), 2) for v in values[-8:]],
    }
