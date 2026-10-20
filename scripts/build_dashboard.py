"""Write site/data/dashboard.json (DATA_CONTRACT.md section 1) from a DuckDB file."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402

PATHOGENS = [("COVID-19", "positivity_covid19"), ("Influenza", "positivity_influenza"), ("RSV", "positivity_rsv")]
NETWORKS = [("Combined", "Combined hospitalizations (Combined)", "hosp_combined"),
            ("COVID-NET", "COVID-19 hospitalizations (COVID-NET)", "hosp_covidnet"),
            ("FluSurv-NET", "Influenza hospitalizations (FluSurv-NET)", "hosp_flusurvnet"),
            ("RSV-NET", "RSV hospitalizations (RSV-NET)", "hosp_rsvnet")]
ARI_ORDER = ["Very Low", "Low", "Moderate", "High", "Very High"]


def build(db_path: str) -> dict:
    con = duckdb.connect(db_path, read_only=True)
    metrics, dates = [], []
    try:
        for pathogen, mid in PATHOGENS:
            rows = con.execute("""SELECT week_end, percent_test_positivity FROM test_positivity
                                  WHERE pathogen = ? AND percent_test_positivity IS NOT NULL
                                  ORDER BY week_end DESC LIMIT 2""", [pathogen]).fetchall()
            if not rows:
                continue
            dates.append(rows[0][0])
            m = {"id": mid, "label": f"{pathogen} test positivity", "value": round(rows[0][1] / 100, 4),
                 "format": "pct", "decimals": 1}
            if len(rows) > 1:
                m["change_text"] = f"{rows[1][1]:g}% the week ending {rows[1][0].isoformat()}"
            metrics.append(m)
        for net, label, mid in NETWORKS:
            row = con.execute("""SELECT week_ending_date, AVG(weekly_rate) FROM hospitalization_rates
                                 WHERE surveillance_network = ? AND age_group = 'Overall' AND site = 'Overall'
                                   AND sex IN ('All', 'Overall') AND race_ethnicity IN ('All', 'Overall')
                                   AND rate_type = 'Observed' AND weekly_rate IS NOT NULL
                                 GROUP BY 1 ORDER BY 1 DESC LIMIT 1""", [net]).fetchone()
            if row:
                dates.append(row[0])
                metrics.append({"id": mid, "label": label, "value": round(row[1], 1),
                                "unit": "per 100,000 per week", "decimals": 1})
        latest = con.execute("SELECT MAX(week_end) FROM ari_activity").fetchone()[0]
        if latest:
            dates.append(latest)
            counts = dict(con.execute("SELECT label, COUNT(*) FROM ari_activity WHERE week_end = ? GROUP BY 1",
                                      [latest]).fetchall())
            for level in ARI_ORDER:
                if counts.get(level):
                    metrics.append({"id": "ari_" + level.lower().replace(" ", "_"),
                                    "label": f"States and territories at {level} ARI activity",
                                    "value": counts[level]})
    finally:
        con.close()
    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "as_of": max(dates).isoformat() if dates else None,
        "metrics": metrics,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=config.DB_PATH)
    ap.add_argument("--out", type=Path, default=ROOT / "site" / "data" / "dashboard.json")
    args = ap.parse_args()
    args.out.write_text(json.dumps(build(args.db), indent=2) + "\n")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
