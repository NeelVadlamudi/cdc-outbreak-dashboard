"""
LSTM-based Time-Series Forecasting for CDC Surveillance Data.
Uses PyTorch to predict hospitalization rates and test positivity trends.
"""

import numpy as np
import torch
import torch.nn as nn
from datetime import datetime, timedelta
import duckdb
import os
from pathlib import Path
import json

DB_PATH = os.path.join(Path(__file__).parent.parent, "data", "cdc_surveillance.duckdb")
MODEL_DIR = os.path.join(Path(__file__).parent.parent, "models")


class LSTMForecaster(nn.Module):
    """LSTM neural network for multi-step time-series forecasting."""

    def __init__(self, input_size=5, hidden_size=64, num_layers=2, output_size=4, dropout=0.2):
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


def create_features(series: np.ndarray, lookback: int = 12) -> tuple:
    """
    Create supervised learning features from time series.
    Features: raw value, lag-1, lag-2, 4-week rolling avg, week-of-year sine encoding.
    """
    if len(series) < lookback + 4:
        return None, None

    X, y = [], []
    for i in range(lookback, len(series) - 4):
        window = series[i - lookback:i]
        # Features per timestep
        features = []
        for j in range(len(window)):
            val = window[j]
            lag1 = window[j - 1] if j > 0 else val
            lag2 = window[j - 2] if j > 1 else val
            roll_avg = np.mean(window[max(0, j - 3):j + 1])
            # Seasonal encoding (approximate week position in year)
            week_sin = np.sin(2 * np.pi * (i - lookback + j) / 52)
            features.append([val, lag1, lag2, roll_avg, week_sin])

        X.append(features)
        # Target: next 4 weeks
        y.append(series[i:i + 4])

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


def get_training_data(virus: str = "COVID-NET") -> np.ndarray:
    """Extract weekly hospitalization rate time series from DuckDB."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        df = conn.execute("""
            SELECT week_ending_date, AVG(weekly_rate) as avg_rate
            FROM hospitalization_rates
            WHERE surveillance_network = ?
              AND age_group = 'Overall'
              AND sex = 'Overall'
              AND race_ethnicity = 'Overall'
              AND rate_type = 'Observed'
            GROUP BY week_ending_date
            ORDER BY week_ending_date
        """, [virus]).fetchdf()

        if len(df) < 20:
            return np.array([])

        return df["avg_rate"].values.astype(np.float32)
    finally:
        conn.close()


def train_model(virus: str = "COVID-NET") -> dict:
    """Train LSTM model on historical data for a specific virus network."""
    series = get_training_data(virus)
    if len(series) < 30:
        return {"status": "insufficient_data", "samples": len(series)}

    # Normalize
    mean_val = float(np.mean(series))
    std_val = float(np.std(series)) + 1e-8
    normalized = (series - mean_val) / std_val

    X, y = create_features(normalized)
    if X is None:
        return {"status": "insufficient_data"}

    # Train/val split (time-series aware — no shuffling)
    split = int(len(X) * 0.8)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    X_train_t = torch.FloatTensor(X_train)
    y_train_t = torch.FloatTensor(y_train)
    X_val_t = torch.FloatTensor(X_val)
    y_val_t = torch.FloatTensor(y_val)

    # Model
    model = LSTMForecaster(input_size=5, hidden_size=64, num_layers=2, output_size=4)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.MSELoss()

    best_val_loss = float("inf")
    patience_counter = 0
    epochs = 100

    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        pred = model(X_train_t)
        loss = criterion(pred, y_train_t)
        loss.backward()
        optimizer.step()

        # Validation
        model.eval()
        with torch.no_grad():
            val_pred = model(X_val_t)
            val_loss = criterion(val_pred, y_val_t).item()

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            # Save best model
            os.makedirs(MODEL_DIR, exist_ok=True)
            safe_name = virus.replace("-", "_").replace(" ", "_").lower()
            torch.save(model.state_dict(), os.path.join(MODEL_DIR, f"lstm_{safe_name}.pt"))
        else:
            patience_counter += 1
            if patience_counter >= 15:
                break

    # Compute MAE on validation set (denormalized)
    model.eval()
    with torch.no_grad():
        val_pred_np = model(X_val_t).numpy() * std_val + mean_val
        val_actual_np = y_val * std_val + mean_val
        mae = float(np.mean(np.abs(val_pred_np - val_actual_np)))

    # Save normalization params
    params = {"mean": mean_val, "std": std_val, "virus": virus, "mae": mae}
    with open(os.path.join(MODEL_DIR, f"params_{safe_name}.json"), "w") as f:
        json.dump(params, f)

    return {
        "status": "trained",
        "virus": virus,
        "epochs": epoch + 1,
        "val_loss": best_val_loss,
        "mae": round(mae, 4),
        "train_samples": len(X_train),
        "val_samples": len(X_val),
    }


def generate_forecast(virus: str = "COVID-NET") -> dict:
    """Generate 4-week forecast using trained LSTM model."""
    safe_name = virus.replace("-", "_").replace(" ", "_").lower()
    model_path = os.path.join(MODEL_DIR, f"lstm_{safe_name}.pt")
    params_path = os.path.join(MODEL_DIR, f"params_{safe_name}.json")

    # Load params
    if not os.path.exists(params_path):
        # Try training first
        result = train_model(virus)
        if result.get("status") != "trained":
            return {"status": "no_model", "detail": "Insufficient data to train model"}

    with open(params_path, "r") as f:
        params = json.load(f)

    mean_val = params["mean"]
    std_val = params["std"]
    mae = params.get("mae", 0)

    # Get latest data
    series = get_training_data(virus)
    if len(series) < 12:
        return {"status": "insufficient_data"}

    normalized = (series - mean_val) / std_val

    # Create input from last 12 weeks
    lookback = 12
    window = normalized[-lookback:]
    features = []
    for j in range(len(window)):
        val = window[j]
        lag1 = window[j - 1] if j > 0 else val
        lag2 = window[j - 2] if j > 1 else val
        roll_avg = float(np.mean(window[max(0, j - 3):j + 1]))
        week_sin = float(np.sin(2 * np.pi * j / 52))
        features.append([val, lag1, lag2, roll_avg, week_sin])

    X_input = torch.FloatTensor(np.array([features], dtype=np.float32))

    # Load model
    model = LSTMForecaster(input_size=5, hidden_size=64, num_layers=2, output_size=4)
    model.load_state_dict(torch.load(model_path, weights_only=True))
    model.eval()

    with torch.no_grad():
        pred = model(X_input).numpy()[0]

    # Denormalize
    pred_values = pred * std_val + mean_val
    pred_values = np.maximum(pred_values, 0)  # rates can't be negative

    # Generate forecast dates (weekly from last data point)
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        last_date = conn.execute("""
            SELECT MAX(week_ending_date) FROM hospitalization_rates
            WHERE surveillance_network = ?
        """, [virus]).fetchone()[0]
    finally:
        conn.close()

    if last_date is None:
        last_date = datetime.now().strftime("%Y-%m-%d")

    base_date = datetime.strptime(str(last_date)[:10], "%Y-%m-%d")
    forecast_dates = [(base_date + timedelta(weeks=i + 1)).strftime("%Y-%m-%d") for i in range(4)]

    # Confidence intervals (using MAE as proxy)
    forecasts = []
    for i, (date, val) in enumerate(zip(forecast_dates, pred_values)):
        uncertainty = mae * (1 + i * 0.3)  # Growing uncertainty
        forecasts.append({
            "date": date,
            "predicted_rate": round(float(val), 2),
            "lower_bound": round(max(0, float(val) - uncertainty), 2),
            "upper_bound": round(float(val) + uncertainty, 2),
        })

    return {
        "status": "success",
        "virus": virus,
        "mae": round(mae, 4),
        "last_data_date": str(last_date)[:10],
        "forecasts": forecasts,
        "historical_recent": [round(float(v), 2) for v in series[-8:]],
    }
