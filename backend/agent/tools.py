"""Read-only data tools used by the agent and served over MCP.

Every tool returns a dict with ``as_of``, ``rows`` and ``source_table``, or a dict
with ``error`` (and the allowed values when an input is not recognised).
"""

import json
import os
from datetime import date, datetime

import duckdb
from pydantic import BaseModel, Field

from backend import config
from backend.insights import hosp_per_100k_plain, positivity_one_in_n, positivity_plain

ARI_LEVELS = ["Very Low", "Low", "Moderate", "High", "Very High", "Data Unavailable"]

# Common phrasings → RESP-NET age_group labels in the database.
AGE_ALIASES = {
    "pediatric": "Pediatrics",
    "pediatrics": "Pediatrics",
    "children": "Pediatrics",
    "child": "Pediatrics",
    "kids": "Pediatrics",
}


def _connect():
    return duckdb.connect(config.DB_PATH, read_only=True)


def _jsonable(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if isinstance(value, float):
        return round(value, 4)
    return value


def _rows(cursor) -> list[dict]:
    cols = [d[0] for d in cursor.description]
    return [{c: _jsonable(v) for c, v in zip(cols, row)} for row in cursor.fetchall()]


def _distinct(conn, table: str, column: str) -> list[str]:
    # table and column come from this module only, never from user input
    return [r[0] for r in conn.execute(f"SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL ORDER BY 1").fetchall()]


def _match(value: str, allowed: list[str]):
    lookup = {a.lower(): a for a in allowed}
    return lookup.get(value.strip().lower())


def _match_age(value: str, allowed: list[str]):
    """Match an age_group, including pediatric/children aliases."""
    hit = _match(value, allowed)
    if hit:
        return hit
    alias = AGE_ALIASES.get(value.strip().lower())
    return _match(alias, allowed) if alias else None


def _unknown(kind: str, value, allowed: list) -> dict:
    return {"error": f"Unknown {kind} '{value}'.", "allowed": allowed}


def _week_not_covered(table: str, week, latest) -> dict:
    return {
        "error": f"No data in {table} for week {_jsonable(week)}.",
        "requested_week": _jsonable(week),
        "latest_available": _jsonable(latest),
    }


def _result(rows, source_table, as_of, **extra) -> dict:
    return {"as_of": _jsonable(as_of), "source_table": source_table, "rows": rows, **extra}


def _parse_week(week):
    if week is None:
        return None
    try:
        return datetime.strptime(week[:10], "%Y-%m-%d").date()
    except ValueError:
        return "invalid"


# ---------- input schemas ----------

class AriLevelInput(BaseModel):
    state: str = Field(description="State or territory name, e.g. 'Ohio'")
    week: str | None = Field(default=None, description="Week-ending date YYYY-MM-DD; latest if omitted")


class StatesAtLevelInput(BaseModel):
    level: str = Field(description="Activity level: Very Low, Low, Moderate, High, Very High")
    week: str | None = Field(default=None, description="Week-ending date YYYY-MM-DD; latest if omitted")


class HospitalizationInput(BaseModel):
    network: str = Field(description="COVID-NET, FluSurv-NET, RSV-NET or Combined")
    age_group: str = Field(
        default="Overall",
        description="Age group, e.g. 'Overall', 'Pediatrics', '0-4 yr', '5-17 yr', '50-64 yr', '65+ yr'. "
        "Required for pediatric/children questions — do not leave as Overall.",
    )
    weeks: int = Field(default=4, ge=1, le=52, description="Number of most recent weeks when week is omitted")
    week: str | None = Field(
        default=None,
        description="Exact week-ending date YYYY-MM-DD. When set, returns that week only (or an error if missing).",
    )


class PositivityInput(BaseModel):
    pathogen: str | None = Field(default=None, description="COVID-19, Influenza or RSV; all if omitted")
    week: str | None = Field(default=None, description="Week-ending date YYYY-MM-DD; latest if omitted")


class WastewaterInput(BaseModel):
    state: str | None = Field(default=None, description="State or territory name; national totals if omitted")
    pathogen: str | None = Field(default=None, description="SARS-CoV-2, Influenza A virus or RSV; all if omitted")
    county_fips: str | None = Field(default=None, description="5-digit county FIPS (legacy SARS-CoV-2 metrics only)")


class ForecastInput(BaseModel):
    virus: str = Field(description="COVID-NET, FluSurv-NET, RSV-NET or Combined")


class NoInput(BaseModel):
    pass


# ---------- tools ----------

def get_ari_level(state: str, week: str | None = None) -> dict:
    """Acute respiratory illness activity level for one state and week."""
    with _connect() as conn:
        allowed = _distinct(conn, "ari_activity", "geography")
        name = _match(state, allowed)
        if not name:
            return _unknown("state", state, allowed)
        wk = _parse_week(week)
        if wk == "invalid":
            return {"error": "week must be YYYY-MM-DD"}
        latest = conn.execute("SELECT MAX(week_end) FROM ari_activity WHERE geography = ?", [name]).fetchone()[0]
        requested = week is not None
        if wk is None:
            wk = latest
        cur = conn.execute(
            "SELECT week_end, geography AS state, label AS level FROM ari_activity WHERE geography = ? AND week_end = ?",
            [name, wk],
        )
        rows = _rows(cur)
        if requested and not rows:
            return _week_not_covered("ari_activity", wk, latest)
        return _result(rows, "ari_activity", wk)


def list_states_at_level(level: str, week: str | None = None) -> dict:
    """States at a given acute respiratory illness activity level."""
    lvl = _match(level, ARI_LEVELS)
    if not lvl:
        return _unknown("level", level, ARI_LEVELS)
    with _connect() as conn:
        wk = _parse_week(week)
        if wk == "invalid":
            return {"error": "week must be YYYY-MM-DD"}
        latest = conn.execute("SELECT MAX(week_end) FROM ari_activity").fetchone()[0]
        requested = week is not None
        if wk is None:
            wk = latest
        cur = conn.execute(
            "SELECT geography AS state FROM ari_activity WHERE label = ? AND week_end = ? ORDER BY 1", [lvl, wk]
        )
        rows = _rows(cur)
        if requested and not rows:
            return _week_not_covered("ari_activity", wk, latest)
        return _result(rows, "ari_activity", wk, count=len(rows))


def get_hospitalization_rate(
    network: str, age_group: str = "Overall", weeks: int = 4, week: str | None = None
) -> dict:
    """Weekly RESP-NET hospitalization rates per 100,000 (all sites, all sexes and races)."""
    weeks = max(1, min(int(weeks), 52))
    with _connect() as conn:
        nets = _distinct(conn, "hospitalization_rates", "surveillance_network")
        net = _match(network, nets)
        if not net:
            return _unknown("network", network, nets)
        ages = _distinct(conn, "hospitalization_rates", "age_group")
        age = _match_age(age_group, ages)
        if not age:
            return _unknown("age_group", age_group, ages)
        latest = conn.execute(
            """
            SELECT MAX(week_ending_date) FROM hospitalization_rates
            WHERE surveillance_network = ? AND age_group = ? AND site = 'Overall'
              AND sex IN ('All', 'Overall') AND race_ethnicity IN ('All', 'Overall')
            """,
            [net, age],
        ).fetchone()[0]
        wk = _parse_week(week)
        if wk == "invalid":
            return {"error": "week must be YYYY-MM-DD"}
        if wk is not None:
            cur = conn.execute(
                """
                SELECT week_ending_date AS week_end, weekly_rate AS rate_per_100k, cumulative_rate AS cumulative_per_100k
                FROM hospitalization_rates
                WHERE surveillance_network = ? AND age_group = ? AND site = 'Overall'
                  AND sex IN ('All', 'Overall') AND race_ethnicity IN ('All', 'Overall')
                  AND week_ending_date = ?
                """,
                [net, age, wk],
            )
            rows = _rows(cur)
            if not rows:
                return _week_not_covered("hospitalization_rates", wk, latest)
            for row in rows:
                plain = hosp_per_100k_plain(row.get("rate_per_100k"))
                if plain is not None:
                    row["plain"] = plain
            return _result(rows, "hospitalization_rates", wk, network=net, age_group=age, units="rate per 100,000")
        cur = conn.execute(
            """
            SELECT week_ending_date AS week_end, weekly_rate AS rate_per_100k, cumulative_rate AS cumulative_per_100k
            FROM hospitalization_rates
            WHERE surveillance_network = ? AND age_group = ? AND site = 'Overall'
              AND sex IN ('All', 'Overall') AND race_ethnicity IN ('All', 'Overall')
            ORDER BY week_ending_date DESC
            LIMIT ?
            """,
            [net, age, weeks],
        )
        rows = _rows(cur)
        as_of = rows[0]["week_end"] if rows else None
        for row in rows:
            plain = hosp_per_100k_plain(row.get("rate_per_100k"))
            if plain is not None:
                row["plain"] = plain
        return _result(rows, "hospitalization_rates", as_of, network=net, age_group=age, units="rate per 100,000")


def get_test_positivity(pathogen: str | None = None, week: str | None = None) -> dict:
    """Percent of tests positive for respiratory pathogens."""
    with _connect() as conn:
        allowed = _distinct(conn, "test_positivity", "pathogen")
        params = []
        where = []
        if pathogen:
            p = _match(pathogen, allowed)
            if not p:
                return _unknown("pathogen", pathogen, allowed)
            where.append("pathogen = ?")
            params.append(p)
        wk = _parse_week(week)
        if wk == "invalid":
            return {"error": "week must be YYYY-MM-DD"}
        latest_sql = "SELECT MAX(week_end) FROM test_positivity"
        latest_params = []
        if pathogen:
            latest_sql += " WHERE pathogen = ?"
            latest_params.append(p)
        latest = conn.execute(latest_sql, latest_params).fetchone()[0]
        requested = week is not None
        if wk is None:
            wk = latest
        where.append("week_end = ?")
        params.append(wk)
        cur = conn.execute(
            "SELECT week_end, pathogen, percent_test_positivity AS percent_positive FROM test_positivity WHERE "
            + " AND ".join(where) + " ORDER BY pathogen",
            params,
        )
        rows = _rows(cur)
        if requested and not rows:
            return _week_not_covered("test_positivity", wk, latest)
        # Dual-layer fields so “1 in N” can appear alongside the source table and reporting week (grounding-safe).
        for row in rows:
            pct = row.get("percent_positive")
            n = positivity_one_in_n(pct)
            plain = positivity_plain(pct)
            if n is not None:
                row["one_in_n"] = n
            if plain is not None:
                row["plain"] = plain
        return _result(rows, "test_positivity", wk)


# The legacy NWSS metric file uses sentinel codes, not real values: percentile 999
# and ptc_15d of -99 or 2147483647. They are excluded here.
_VALID_PERCENTILE = "percentile BETWEEN 0 AND 100"
_VALID_PTC = "ptc_15d NOT IN (-99, 2147483647)"
CURRENT_WW = "source_dataset = 'atcp-73re'"
LEGACY_WW = "source_dataset = '2ew6-ywp6'"


def _legacy_wastewater(conn, col, val) -> dict | None:
    """SARS-CoV-2 metrics from the legacy NWSS file (no records after 2025-09-07)."""
    where, params = (LEGACY_WW, []) if col is None else (f"{LEGACY_WW} AND {col} = ?", [val])
    latest = conn.execute(f"SELECT MAX(date_end) FROM wastewater_sites WHERE {where}", params).fetchone()[0]
    if latest is None:
        return None
    row = conn.execute(
        f"""
        SELECT COUNT(DISTINCT wwtp_id) AS site_count,
               ROUND(AVG(CASE WHEN {_VALID_PERCENTILE} THEN percentile END), 1) AS avg_percentile,
               MEDIAN(CASE WHEN {_VALID_PTC} THEN ptc_15d END) AS median_ptc_15d
        FROM wastewater_sites WHERE {where} AND date_end = ?
        """,
        params + [latest],
    ).fetchone()
    return {
        "source_dataset": "2ew6-ywp6 (legacy)",
        "pathogen": "SARS-CoV-2",
        "date_end": _jsonable(latest),
        "site_count": row[0],
        "avg_percentile": row[1],
        "median_ptc_15d_percent": row[2],
        "note": "Legacy NWSS SARS-CoV-2 metrics; CDC stopped updating this file after 2025-09-07.",
    }


def get_wastewater(state: str | None = None, pathogen: str | None = None, county_fips: str | None = None) -> dict:
    """Latest wastewater viral activity level (WVAL) and site counts, nationally or for a state,
    plus legacy SARS-CoV-2 15-day percent change and percentile where available."""
    with _connect() as conn:
        legacy_col, legacy_val = None, None
        if county_fips:
            allowed = [r[0] for r in conn.execute(
                f"SELECT DISTINCT county_fips FROM wastewater_sites WHERE {LEGACY_WW} AND county_fips IS NOT NULL"
            ).fetchall()]
            if county_fips not in allowed:
                return {"error": f"Unknown county_fips '{county_fips}'.", "allowed_count": len(allowed)}
            legacy = _legacy_wastewater(conn, "county_fips", county_fips)
            return _result([], "wastewater_sites", legacy and legacy["date_end"], legacy=legacy)

        where, params = [CURRENT_WW], []
        scope = "national"
        if state:
            allowed = [r[0] for r in conn.execute(
                f"SELECT DISTINCT wwtp_jurisdiction FROM wastewater_sites WHERE {CURRENT_WW} ORDER BY 1").fetchall()]
            name = _match(state, allowed)
            if not name:
                return _unknown("state", state, allowed)
            where.append("wwtp_jurisdiction = ?")
            params.append(name)
            scope = name
            legacy_states = [r[0] for r in conn.execute(
                f"SELECT DISTINCT wwtp_jurisdiction FROM wastewater_sites WHERE {LEGACY_WW}").fetchall()]
            legacy_val = _match(name, legacy_states)
            legacy_col = "wwtp_jurisdiction" if legacy_val else None
        if pathogen:
            allowed = [r[0] for r in conn.execute(
                f"SELECT DISTINCT pathogen FROM wastewater_sites WHERE {CURRENT_WW} ORDER BY 1").fetchall()]
            p = _match(pathogen, allowed)
            if not p:
                return _unknown("pathogen", pathogen, allowed)
            where.append("pathogen = ?")
            params.append(p)
        clause = " AND ".join(where)
        as_of = conn.execute(f"SELECT MAX(date_end) FROM wastewater_sites WHERE {clause}", params).fetchone()[0]
        if as_of is None:
            return {"error": "The data does not cover wastewater for that selection."}
        cur = conn.execute(
            f"""
            SELECT date_end AS week_end, pathogen, COUNT(DISTINCT wwtp_id) AS site_count,
                   ROUND(MEDIAN(wval), 2) AS median_wval,
                   COUNT(DISTINCT CASE WHEN wval_category IN ('High', 'Very High') THEN wwtp_id END)
                       AS sites_high_or_very_high
            FROM wastewater_sites WHERE {clause} AND date_end = ?
            GROUP BY date_end, pathogen ORDER BY pathogen
            """,
            params + [as_of],
        )
        rows = _rows(cur)
        total_sites = conn.execute(
            f"SELECT COUNT(DISTINCT wwtp_id) FROM wastewater_sites WHERE {clause} AND date_end = ?", params + [as_of]
        ).fetchone()[0]
        legacy = None
        if not pathogen or "sars" in pathogen.lower():
            legacy = _legacy_wastewater(conn, legacy_col, legacy_val) if (legacy_col or not state) else None
        return _result(rows, "wastewater_sites", as_of, scope=scope, total_sites=total_sites, legacy=legacy)


def backtest_vs_last_value(net: str) -> dict:
    """Per model: did it beat the last-week value in the latest backtest, horizon by horizon."""
    try:
        with open(config.BACKTEST_PATH) as f:
            bt = json.load(f)
    except (OSError, ValueError):
        return {}
    by_name = {m["model"]: {p["h"]: p["mae"] for p in m["horizons"]} for m in bt.get("models", [])}
    base = by_name.get(f"Last value · {net}")
    if not base:
        return {}
    out = {}
    for key, label in (("lstm", "LSTM"), ("xgboost", "XGBoost")):
        maes = by_name.get(f"{label} · {net}")
        if not maes:
            continue
        beaten = [h for h, mae in maes.items() if mae is not None and base.get(h) is not None and mae < base[h]]
        if not beaten:
            note = "In the backtest this model did not beat simply repeating last week's value at any horizon (1-4 weeks)."
        elif len(beaten) == len(maes):
            note = "In the backtest this model beat repeating last week's value at every horizon."
        else:
            note = (f"In the backtest this model beat repeating last week's value only at {len(beaten)} of "
                    f"{len(maes)} horizons; at the others last week's value was more accurate.")
        out[key] = {"beats_last_value": len(beaten) == len(maes), "note": note,
                    "backtest_run_at": bt.get("run_at")}
    return out


def get_forecast(virus: str) -> dict:
    """Last-value primary outlook plus any stored LSTM/XGBoost rows. Never trains."""
    with _connect() as conn:
        nets = _distinct(conn, "hospitalization_rates", "surveillance_network")
    net = _match(virus, nets)
    if not net:
        return _unknown("virus", virus, nets)
    from backend.forecasting import last_value_outlook

    primary = last_value_outlook(net)
    if primary.get("status") != "success":
        return {"error": primary.get("detail") or f"No outlook available for {net}."}
    as_of = primary["last_data_date"]
    rows = [{"model": "last_value", "role": "primary", **f} for f in primary["forecasts"]]
    safe = net.replace("-", "_").replace(" ", "_").lower()
    from backend.forecasting import MODEL_DIR as model_dir

    if os.path.exists(os.path.join(model_dir, f"params_{safe}.json")):
        from backend.forecasting import generate_forecast

        res = generate_forecast(net)
        if res.get("status") == "success":
            rows += [{"model": "lstm", "role": "experimental", "validation_mae": res["mae"], **f}
                     for f in res["forecasts"]]
    if os.path.exists(os.path.join(model_dir, f"xgb_{safe}.json")):
        from backend.ensemble import xgb_forecast

        res = xgb_forecast(net)
        if res.get("status") == "success":
            rows += [{"model": "xgboost", "role": "experimental", "validation_mae": res["mae"], **f}
                     for f in res.get("forecasts", [])]
    vs = backtest_vs_last_value(net)
    for r in rows:
        if r["model"] in vs:
            r["beats_last_value"] = vs[r["model"]]["beats_last_value"]
            r["underperforms_baseline"] = not vs[r["model"]]["beats_last_value"]
    extra = {
        "primary": "last_value",
        "last_observed_rate": primary.get("last_observed_rate"),
        "note": primary.get("note"),
    }
    if vs:
        extra["backtest"] = vs
    return _result(rows, "models", as_of, virus=net, units="rate per 100,000", **extra)


def get_data_freshness() -> dict:
    """Latest week loaded per table (and per wastewater dataset) and its age in days."""
    checks = [
        ("ari_activity", "week_end", "1=1", None),
        ("hospitalization_rates", "week_ending_date", "1=1", None),
        ("test_positivity", "week_end", "1=1", None),
        ("wastewater_sites", "date_end", CURRENT_WW, "atcp-73re"),
        ("wastewater_sites", "date_end", LEGACY_WW, "2ew6-ywp6 (legacy)"),
    ]
    rows = []
    today = date.today()
    with _connect() as conn:
        for table, col, where, dataset in checks:
            latest = conn.execute(f"SELECT MAX({col}) FROM {table} WHERE {where}").fetchone()[0]
            age = (today - latest).days if latest else None
            row = {
                "table": table,
                "latest_week": _jsonable(latest),
                "age_days": age,
                "stale": age is None or age > config.STALE_AFTER_DAYS,
            }
            if dataset:
                row["dataset"] = dataset
                row["legacy"] = "legacy" in dataset
            rows.append(row)
    as_of = max((r["latest_week"] for r in rows if r["latest_week"]), default=None)
    return _result(rows, "all", as_of)


TOOLS = {
    "get_ari_level": (get_ari_level, AriLevelInput),
    "list_states_at_level": (list_states_at_level, StatesAtLevelInput),
    "get_hospitalization_rate": (get_hospitalization_rate, HospitalizationInput),
    "get_test_positivity": (get_test_positivity, PositivityInput),
    "get_wastewater": (get_wastewater, WastewaterInput),
    "get_forecast": (get_forecast, ForecastInput),
    "get_data_freshness": (get_data_freshness, NoInput),
}


def call_tool(name: str, args: dict) -> dict:
    """Validate the inputs with the tool's schema and run it."""
    if name not in TOOLS:
        return {"error": f"Unknown tool '{name}'."}
    fn, schema = TOOLS[name]
    try:
        parsed = schema(**(args or {}))
    except Exception as e:
        return {"error": f"Invalid inputs: {e}"}
    try:
        return fn(**parsed.model_dump())
    except duckdb.Error as e:
        return {"error": f"Database error: {e}"}


def dumps(result: dict) -> str:
    return json.dumps(result, default=str)
