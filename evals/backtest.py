"""Rolling-origin backtest of the app's LSTM and XGBoost forecasts.

For each virus and each of the last N forecast origins, both models are trained
only on weeks up to the origin, using the same features, training loop,
inference and uncertainty band as backend/forecasting.py and backend/ensemble.py,
then scored against the next 1-4 observed weeks. A last-value baseline is
scored on the same origins for reference.

    python evals/backtest.py                      # reads CDC_DB_PATH
    python evals/backtest.py --origins 12 --out site/data/backtest.json

Scores per model and horizon: MAE (rate per 100,000), WMAPE (sum |error| /
sum actual, 0-1) and coverage (share of actuals inside the app's band, 0-1).
"""

import argparse
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import torch
import torch.nn as nn
import xgboost as xgb

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend import config  # noqa: E402
from backend.ensemble import create_xgb_features  # noqa: E402
from backend.forecasting import LSTMForecaster, create_features  # noqa: E402

VIRUSES = ["COVID-NET", "FluSurv-NET", "RSV-NET", "Combined"]
H = 4


def load_series(con, virus):
    rows = con.execute(
        """
        SELECT week_ending_date, AVG(weekly_rate)
        FROM hospitalization_rates
        WHERE surveillance_network = ? AND age_group = 'Overall' AND site = 'Overall'
          AND sex IN ('All', 'Overall') AND race_ethnicity IN ('All', 'Overall')
          AND rate_type = 'Observed' AND weekly_rate IS NOT NULL
        GROUP BY 1 ORDER BY 1
        """,
        [virus],
    ).fetchall()
    return [r[0] for r in rows], np.array([r[1] for r in rows], dtype=np.float32)


# ---- LSTM: same steps as forecasting.train_model and generate_forecast ----

def lstm_fit_predict(series):
    mean_val = float(np.mean(series))
    std_val = float(np.std(series)) + 1e-8
    norm = (series - mean_val) / std_val
    X, y = create_features(norm)
    split = int(len(X) * 0.8)
    Xt, Xv = torch.FloatTensor(X[:split]), torch.FloatTensor(X[split:])
    yt, yv = torch.FloatTensor(y[:split]), torch.FloatTensor(y[split:])
    model = LSTMForecaster(input_size=5, hidden_size=64, num_layers=2, output_size=4)
    opt = torch.optim.Adam(model.parameters(), lr=0.001)
    loss_fn = nn.MSELoss()
    best, best_state, patience = float("inf"), None, 0
    for _ in range(100):
        model.train()
        opt.zero_grad()
        loss = loss_fn(model(Xt), yt)
        loss.backward()
        opt.step()
        model.eval()
        with torch.no_grad():
            v = loss_fn(model(Xv), yv).item()
        if v < best:
            best, best_state, patience = v, copy.deepcopy(model.state_dict()), 0
        else:
            patience += 1
            if patience >= 15:
                break
    # train_model reports MAE from the final weights and saves the best ones
    with torch.no_grad():
        mae = float(np.mean(np.abs(model(Xv).numpy() * std_val + mean_val - (y[split:] * std_val + mean_val))))
    model.load_state_dict(best_state)
    model.eval()
    window = norm[-12:]
    feats = []
    for j in range(len(window)):
        val = window[j]
        lag1 = window[j - 1] if j > 0 else val
        lag2 = window[j - 2] if j > 1 else val
        feats.append([val, lag1, lag2, float(np.mean(window[max(0, j - 3):j + 1])), float(np.sin(2 * np.pi * j / 52))])
    with torch.no_grad():
        pred = model(torch.FloatTensor(np.array([feats], dtype=np.float32))).numpy()[0]
    pred = np.maximum(pred * std_val + mean_val, 0)
    bands = [mae * (1 + i * 0.3) for i in range(H)]
    return pred.tolist(), bands


# ---- XGBoost: same steps as ensemble.train_xgboost and xgb_forecast ----

def xgb_fit_predict(series):
    X, y = create_xgb_features([{"rate": float(v)} for v in series])
    names = list(X[0].keys())
    Xa = np.array([[f[k] for k in names] for f in X])
    ya = np.array(y)
    split = int(len(Xa) * 0.8)
    model = xgb.XGBRegressor(n_estimators=200, max_depth=5, learning_rate=0.05, subsample=0.8,
                             colsample_bytree=0.8, objective="reg:squarederror", random_state=0)
    model.fit(Xa[:split], ya[:split], eval_set=[(Xa[split:], ya[split:])], verbose=False)
    mae = float(np.mean(np.abs(model.predict(Xa[split:]) - ya[split:])))
    cur = [float(v) for v in series]
    out = []
    for _ in range(H):
        i = len(cur)
        f = np.array([[cur[-1], cur[-2], cur[-4], cur[-8], np.mean(cur[-4:]), np.mean(cur[-8:]),
                       np.std(cur[-4:]), cur[-1] - cur[-2], np.sin(2 * np.pi * i / 52), np.cos(2 * np.pi * i / 52)]])
        p = max(0.0, float(model.predict(f)[0]))
        out.append(p)
        cur.append(p)
    return out, [mae * (1 + i * 0.25) for i in range(H)]


def naive_predict(series):
    return [float(series[-1])] * H, None


MODELS = {"LSTM": lstm_fit_predict, "XGBoost": xgb_fit_predict, "Last value": naive_predict}


def run(db_path, n_origins):
    torch.manual_seed(0)
    np.random.seed(0)
    con = duckdb.connect(db_path, read_only=True)
    results, details = [], {}
    data_through = None
    for virus in VIRUSES:
        dates, series = load_series(con, virus)
        if len(series) < 40:
            continue
        data_through = max(data_through or dates[-1], dates[-1])
        origins = range(len(series) - H - n_origins + 1, len(series) - H + 1)
        for name, fn in MODELS.items():
            err = [[] for _ in range(H)]
            act = [[] for _ in range(H)]
            cov = [[] for _ in range(H)]
            for o in origins:
                torch.manual_seed(o)
                pred, band = fn(series[:o])
                for h in range(H):
                    a = float(series[o + h])
                    err[h].append(abs(pred[h] - a))
                    act[h].append(a)
                    if band is not None:
                        cov[h].append(pred[h] - band[h] <= a <= pred[h] + band[h])
            horizons = []
            for h in range(H):
                total = sum(act[h])
                horizons.append({
                    "h": h + 1,
                    "mae": round(float(np.mean(err[h])), 3),
                    "wmape": round(float(sum(err[h]) / total), 3) if total > 0 else None,
                    "coverage": round(float(np.mean(cov[h])), 3) if cov[h] else None,
                })
            results.append({"model": f"{name} · {virus}", "horizons": horizons})
        details[virus] = {
            "weeks": len(series),
            "first_week": dates[0].isoformat(),
            "last_week": dates[-1].isoformat(),
            "origins": [dates[o - 1].isoformat() for o in origins],
        }
    con.close()
    return {
        "run_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "target": "Weekly RESP-NET hospitalization rate, overall population, 1-4 weeks ahead",
        "mae_unit": "rate per 100,000",
        "n_origins": n_origins,
        "data_through": data_through.isoformat() if data_through else None,
        "coverage_note": "Share of actual values inside the app's band (validation MAE times a growth factor).",
        "series": details,
        "models": results,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default=config.DB_PATH)
    ap.add_argument("--origins", type=int, default=12)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "results" / "backtest.json")
    ap.add_argument("--site-out", type=Path, help="also write the site/data/backtest.json subset (DATA_CONTRACT.md section 3)")
    args = ap.parse_args()
    result = run(args.db, args.origins)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2))
    if args.site_out:
        site = {k: result[k] for k in ("run_at", "target", "mae_unit", "n_origins")}
        site["models"] = [{"model": m["model"], "horizons": [{k: p[k] for k in ("h", "mae", "wmape")} for p in m["horizons"]]}
                          for m in result["models"]]
        args.site_out.write_text(json.dumps(site, indent=2))
    for m in result["models"]:
        cells = "  ".join(f"h{p['h']} mae={p['mae']} wmape={p['wmape']} cov={p['coverage']}" for p in m["horizons"])
        print(f"{m['model']:<26} {cells}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
