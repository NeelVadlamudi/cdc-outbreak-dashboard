"""Build a frozen copy of the CDC data for evals.

Pulls a fixed window of weeks from the same CDC SODA datasets the app ingests
and writes them to evals/snapshot.duckdb using the app's table names and
columns, so expected_sql in questions.yaml always gives the same answer.

    python evals/build_snapshot.py            # default window
    python evals/build_snapshot.py --force    # rebuild even if the file exists

The window is fixed below. Change it only on purpose, and re-check
questions.yaml after you do.
"""

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb
import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.cdc_ingestion import CDC_DATASETS, wastewater_activity_frame  # noqa: E402

OUT = Path(__file__).resolve().parent / "snapshot.duckdb"

# Fixed window. Weekly CDC data ends on Saturdays.
AS_OF = date(2026, 10, 10)          # last week in the snapshot
WEEKS = 12                          # weeks kept, ending at AS_OF
START = AS_OF - timedelta(weeks=WEEKS - 1)
# Legacy NWSS metric file (wastewater_sites) stopped at 2025-09-07; keep its last 12 weeks.
# The current viral activity file (wastewater_activity) uses the main window.
WW_END = date(2025, 9, 7)
WW_START = WW_END - timedelta(weeks=WEEKS) + timedelta(days=1)

PAGE = 50000


def fetch(key: str, where: str) -> list:
    url = CDC_DATASETS[key]["url"]
    rows, offset = [], 0
    with httpx.Client(timeout=120.0) as client:
        while True:
            r = client.get(url, params={"$where": where, "$limit": PAGE,
                                        "$offset": offset, "$order": ":id"})
            r.raise_for_status()
            batch = r.json()
            rows.extend(batch)
            if len(batch) < PAGE:
                return rows
            offset += PAGE


def day(s):
    return s[:10] if s else None


def build(path: Path) -> None:
    lo, hi = START.isoformat(), AS_OF.isoformat()
    con = duckdb.connect(str(path))

    ari = pd.DataFrame(fetch("ari_activity", f"week_end between '{lo}' and '{hi}T23:59:59'"))
    ari = pd.DataFrame({
        "week_end": pd.to_datetime(ari["week_end"].map(day)).dt.date,
        "geography": ari["geography"], "label": ari["label"],
        "buildnumber": ari.get("buildnumber", ""),
    })
    con.execute("CREATE TABLE ari_activity AS SELECT * FROM ari")

    pos = pd.DataFrame(fetch("test_positivity", f"week_end between '{lo}' and '{hi}T23:59:59'"))
    pos = pd.DataFrame({
        "week_end": pd.to_datetime(pos["week_end"].map(day)).dt.date,
        "pathogen": pos["pathogen"],
        "percent_test_positivity": pd.to_numeric(pos["percent_test_positivity"]),
    }).dropna()
    con.execute("CREATE TABLE test_positivity AS SELECT * FROM pos")

    # RESP-NET: keep observed weekly and cumulative rates. The source is long
    # format (one row per data_type); pivot into the app's columns.
    h = pd.DataFrame(fetch(
        "hospitalization_rates",
        f"date between '{lo}' and '{hi}' and rate_type='Observed' "
        "and data_type in ('Weekly Rate','Cumulative Rate')"))
    h["estimate"] = pd.to_numeric(h["estimate"], errors="coerce")
    keys = ["surveillance_network", "season", "date", "age_category", "sex", "race", "state"]
    wide = h.pivot_table(index=keys, columns="data_type", values="estimate",
                         aggfunc="first").reset_index()
    d = pd.to_datetime(wide["date"])
    iso = d.dt.isocalendar()
    hosp = pd.DataFrame({
        "surveillance_network": wide["surveillance_network"],
        "season": wide["season"],
        "week_ending_date": d.dt.date,
        "mmwr_year": iso["year"].astype(int),
        "mmwr_week": iso["week"].astype(int),
        "age_group": wide["age_category"],
        "sex": wide["sex"],
        "race_ethnicity": wide["race"],
        "site": wide["state"],
        "weekly_rate": wide.get("Weekly Rate"),
        "cumulative_rate": wide.get("Cumulative Rate"),
        "rate_type": "Observed",
    })
    con.execute("CREATE TABLE hospitalization_rates AS SELECT * FROM hosp")

    w = pd.DataFrame(fetch(
        "wastewater_sites",
        f"date_end between '{WW_START.isoformat()}' and '{WW_END.isoformat()}T23:59:59'"))
    num = lambda c: pd.to_numeric(w.get(c), errors="coerce")  # noqa: E731
    ww = pd.DataFrame({
        "wwtp_jurisdiction": w.get("wwtp_jurisdiction"),
        "wwtp_id": w.get("wwtp_id"),
        "county_names": w.get("county_names"),
        "county_fips": w.get("county_fips"),
        "population_served": num("population_served"),
        "date_start": pd.to_datetime(w.get("date_start").map(day)).dt.date,
        "date_end": pd.to_datetime(w.get("date_end").map(day)).dt.date,
        "ptc_15d": num("ptc_15d"),
        "detect_prop_15d": num("detect_prop_15d"),
        "percentile": num("percentile"),
        "sampling_prior": w.get("sampling_prior"),
        "first_sample_date": pd.to_datetime(w.get("first_sample_date").map(day), errors="coerce").dt.date,
    })
    con.execute("CREATE TABLE wastewater_sites AS SELECT * FROM ww")

    add_wastewater_activity(con)

    meta = pd.DataFrame([{
        "as_of": AS_OF, "window_start": START, "weeks": WEEKS,
        "wastewater_start": WW_START, "wastewater_end": WW_END,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }])
    con.execute("CREATE TABLE snapshot_meta AS SELECT * FROM meta")

    for t in ["ari_activity", "test_positivity", "hospitalization_rates", "wastewater_sites"]:
        print(f"{t}: {con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]} rows")
    con.close()


def add_wastewater_activity(con) -> None:
    """Current NWSS viral activity levels (atcp-73re) for the same weeks as the other tables."""
    lo, hi = START.isoformat(), AS_OF.isoformat()
    wa = wastewater_activity_frame(fetch("wastewater_activity", f"week_end between '{lo}' and '{hi}T23:59:59'"))  # noqa: F841
    con.execute("DROP TABLE IF EXISTS wastewater_activity")
    con.execute("CREATE TABLE wastewater_activity AS SELECT * FROM wa")
    print(f"wastewater_activity: {con.execute('SELECT COUNT(*) FROM wastewater_activity').fetchone()[0]} rows")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--add-wastewater-activity", action="store_true",
                    help="add or replace only the wastewater_activity table in an existing snapshot")
    args = ap.parse_args()
    if args.add_wastewater_activity:
        con = duckdb.connect(str(args.out))
        add_wastewater_activity(con)
        con.close()
        return
    if args.out.exists():
        if not args.force:
            print(f"{args.out} exists; use --force to rebuild")
            return
        args.out.unlink()
    build(args.out)
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
