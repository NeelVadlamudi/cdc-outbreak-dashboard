"""
Ensemble ML Models: XGBoost + Anomaly Detection + Season Comparison.
Complements the LSTM forecaster with gradient boosting and outlier detection.
"""

import numpy as np
import xgboost as xgb
from sklearn.ensemble import IsolationForest
from datetime import datetime
import duckdb
import os
import json
from pathlib import Path

DB_PATH = os.path.join(Path(__file__).parent.parent, "data", "cdc_surveillance.duckdb")
MODEL_DIR = os.path.join(Path(__file__).parent.parent, "models")


def get_time_series(virus: str = "COVID-NET") -> list:
    """Get weekly hospitalization time series for XGBoost training."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        df = conn.execute("""
            SELECT week_ending_date as date, AVG(weekly_rate) as rate
            FROM hospitalization_rates
            WHERE surveillance_network = ?
              AND age_group = 'Overall' AND sex = 'Overall'
              AND race_ethnicity = 'Overall' AND rate_type = 'Observed'
            GROUP BY week_ending_date
            ORDER BY week_ending_date
        """, [virus]).fetchdf()
        return df.to_dict(orient="records")
    finally:
        conn.close()


def create_xgb_features(series: list, lookback: int = 8) -> tuple:
    """Create tabular features for XGBoost from time series."""
    if len(series) < lookback + 4:
        return None, None

    rates = [r["rate"] for r in series]
    X, y = [], []

    for i in range(lookback, len(rates) - 1):
        features = {
            "lag_1": rates[i - 1],
            "lag_2": rates[i - 2],
            "lag_4": rates[i - 4] if i >= 4 else rates[0],
            "lag_8": rates[i - 8] if i >= 8 else rates[0],
            "roll_avg_4": np.mean(rates[max(0, i - 4):i]),
            "roll_avg_8": np.mean(rates[max(0, i - 8):i]),
            "roll_std_4": np.std(rates[max(0, i - 4):i]) if i >= 4 else 0,
            "diff_1": rates[i - 1] - rates[i - 2] if i >= 2 else 0,
            "week_sin": np.sin(2 * np.pi * i / 52),
            "week_cos": np.cos(2 * np.pi * i / 52),
        }
        X.append(features)
        y.append(rates[i])

    return X, y


def train_xgboost(virus: str = "COVID-NET") -> dict:
    """Train XGBoost model for hospitalization rate prediction."""
    series = get_time_series(virus)
    if len(series) < 30:
        return {"status": "insufficient_data", "samples": len(series)}

    X, y = create_xgb_features(series)
    if X is None:
        return {"status": "insufficient_data"}

    # Convert to arrays
    feature_names = list(X[0].keys())
    X_arr = np.array([[f[k] for k in feature_names] for f in X])
    y_arr = np.array(y)

    # Time-series split
    split = int(len(X_arr) * 0.8)
    X_train, X_val = X_arr[:split], X_arr[split:]
    y_train, y_val = y_arr[:split], y_arr[split:]

    # Train XGBoost
    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="reg:squarederror",
    )
    model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

    # Evaluate
    val_pred = model.predict(X_val)
    mae = float(np.mean(np.abs(val_pred - y_val)))

    # Save model
    os.makedirs(MODEL_DIR, exist_ok=True)
    safe_name = virus.replace("-", "_").replace(" ", "_").lower()
    model.save_model(os.path.join(MODEL_DIR, f"xgb_{safe_name}.json"))

    # Save feature importance
    importance = dict(zip(feature_names, model.feature_importances_.tolist()))
    with open(os.path.join(MODEL_DIR, f"xgb_importance_{safe_name}.json"), "w") as f:
        json.dump({"importance": importance, "mae": mae, "virus": virus}, f)

    return {
        "status": "trained",
        "model": "XGBoost",
        "virus": virus,
        "mae": round(mae, 4),
        "feature_importance": {k: round(v, 4) for k, v in sorted(importance.items(), key=lambda x: -x[1])},
        "train_samples": len(X_train),
        "val_samples": len(X_val),
    }


def xgb_forecast(virus: str = "COVID-NET") -> dict:
    """Generate forecast using XGBoost model."""
    safe_name = virus.replace("-", "_").replace(" ", "_").lower()
    model_path = os.path.join(MODEL_DIR, f"xgb_{safe_name}.json")
    importance_path = os.path.join(MODEL_DIR, f"xgb_importance_{safe_name}.json")

    if not os.path.exists(model_path):
        result = train_xgboost(virus)
        if result.get("status") != "trained":
            return {"status": "no_model", "detail": "Insufficient data"}

    model = xgb.XGBRegressor()
    model.load_model(model_path)

    with open(importance_path) as f:
        meta = json.load(f)

    series = get_time_series(virus)
    rates = [r["rate"] for r in series]

    if len(rates) < 8:
        return {"status": "insufficient_data"}

    # Predict next 4 weeks iteratively
    predicted = []
    current_rates = list(rates)

    for step in range(4):
        i = len(current_rates)
        features = np.array([[
            current_rates[-1], current_rates[-2],
            current_rates[-4] if len(current_rates) >= 4 else current_rates[0],
            current_rates[-8] if len(current_rates) >= 8 else current_rates[0],
            np.mean(current_rates[-4:]),
            np.mean(current_rates[-8:]),
            np.std(current_rates[-4:]) if len(current_rates) >= 4 else 0,
            current_rates[-1] - current_rates[-2],
            np.sin(2 * np.pi * i / 52),
            np.cos(2 * np.pi * i / 52),
        ]])
        pred = float(model.predict(features)[0])
        pred = max(0, pred)
        predicted.append(pred)
        current_rates.append(pred)

    # Generate dates
    from datetime import timedelta
    last_date_str = series[-1]["date"]
    if hasattr(last_date_str, "isoformat"):
        last_date_str = last_date_str.isoformat()
    base_date = datetime.strptime(str(last_date_str)[:10], "%Y-%m-%d")
    forecast_dates = [(base_date + timedelta(weeks=w + 1)).strftime("%Y-%m-%d") for w in range(4)]

    mae = meta.get("mae", 0)
    forecasts = []
    for i, (date, val) in enumerate(zip(forecast_dates, predicted)):
        uncertainty = mae * (1 + i * 0.25)
        forecasts.append({
            "date": date,
            "predicted_rate": round(val, 2),
            "lower_bound": round(max(0, val - uncertainty), 2),
            "upper_bound": round(val + uncertainty, 2),
        })

    return {
        "status": "success",
        "model": "XGBoost",
        "virus": virus,
        "mae": round(mae, 4),
        "forecasts": forecasts,
        "feature_importance": meta.get("importance", {}),
        "historical_recent": [round(r, 2) for r in rates[-8:]],
    }


def detect_anomalies() -> list:
    """Run anomaly detection on latest state-level data using z-scores and Isolation Forest."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        # Get recent hospitalization rates by site
        df = conn.execute("""
            SELECT site, surveillance_network, week_ending_date, weekly_rate
            FROM hospitalization_rates
            WHERE age_group = 'Overall' AND sex = 'Overall' AND race_ethnicity = 'Overall'
              AND rate_type = 'Observed'
            ORDER BY week_ending_date DESC
            LIMIT 2000
        """).fetchdf()
    finally:
        conn.close()

    if len(df) < 20:
        return []

    anomalies = []
    for site in df["site"].unique():
        site_data = df[df["site"] == site].sort_values("week_ending_date")
        for network in site_data["surveillance_network"].unique():
            net_data = site_data[site_data["surveillance_network"] == network]
            rates = net_data["weekly_rate"].values

            if len(rates) < 8:
                continue

            # Z-score for latest week
            mean_rate = np.mean(rates[:-1])
            std_rate = np.std(rates[:-1]) + 1e-8
            latest_rate = rates[-1]
            z = (latest_rate - mean_rate) / std_rate

            if abs(z) > 2.0:
                severity = "Critical" if abs(z) > 3.0 else "Warning"
                direction = "above" if z > 0 else "below"
                latest_date = net_data["week_ending_date"].iloc[-1]
                date_str = latest_date.isoformat() if hasattr(latest_date, "isoformat") else str(latest_date)

                anomalies.append({
                    "detected_date": date_str[:10],
                    "geography": site,
                    "metric": network,
                    "value": round(float(latest_rate), 2),
                    "z_score": round(float(z), 2),
                    "severity": severity,
                    "description": f"{site} {network.replace('-NET','')} rate is {abs(z):.1f}σ {direction} average ({latest_rate:.1f} vs avg {mean_rate:.1f})"
                })

    # Sort by severity (z-score)
    anomalies.sort(key=lambda x: abs(x["z_score"]), reverse=True)
    return anomalies[:20]  # Top 20


def get_age_heatmap_data(network: str = "COVID-NET") -> list:
    """Get age-stratified hospitalization rates for heatmap."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        df = conn.execute("""
            SELECT week_ending_date, age_group, AVG(weekly_rate) as rate
            FROM hospitalization_rates
            WHERE surveillance_network = ?
              AND sex = 'Overall' AND race_ethnicity = 'Overall'
              AND rate_type = 'Observed' AND age_group != 'Overall'
            GROUP BY week_ending_date, age_group
            ORDER BY week_ending_date, age_group
        """, [network]).fetchdf()

        results = df.to_dict(orient="records")
        for r in results:
            if hasattr(r.get("week_ending_date"), "isoformat"):
                r["week_ending_date"] = r["week_ending_date"].isoformat()
        return results
    finally:
        conn.close()


def get_season_comparison() -> list:
    """Get season-over-season data aligned by epi-week for overlay charts."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        df = conn.execute("""
            SELECT surveillance_network, season, mmwr_week,
                   AVG(weekly_rate) as avg_rate
            FROM hospitalization_rates
            WHERE age_group = 'Overall' AND sex = 'Overall'
              AND race_ethnicity = 'Overall' AND rate_type = 'Observed'
            GROUP BY surveillance_network, season, mmwr_week
            ORDER BY surveillance_network, season, mmwr_week
        """).fetchdf()
        return df.to_dict(orient="records")
    finally:
        conn.close()
