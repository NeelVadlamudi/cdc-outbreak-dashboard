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

ARI_LEVELS = ["Very Low", "Low", "Moderate", "High", "Very High", "Data Unavailable"]


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


def _unknown(kind: str, value, allowed: list) -> dict:
    return {"error": f"Unknown {kind} '{value}'.", "allowed": allowed}


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
    age_group: str = Field(default="Overall", description="Age group, e.g. 'Overall', '65+ yr'")
    weeks: int = Field(default=4, ge=1, le=52, description="Number of most recent weeks")


class PositivityInput(BaseModel):
    pathogen: str | None = Field(default=None, description="COVID-19, Influenza or RSV; all if omitted")
    week: str | None = Field(default=None, description="Week-ending date YYYY-MM-DD; latest if omitted")


class WastewaterInput(BaseModel):
    state: str | None = Field(default=None, description="Jurisdiction name or code as stored in the data")
    county_fips: str | None = Field(default=None, description="5-digit county FIPS code")


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
        if wk is None:
            wk = conn.execute("SELECT MAX(week_end) FROM ari_activity WHERE geography = ?", [name]).fetchone()[0]
        cur = conn.execute(
            "SELECT week_end, geography AS state, label AS level FROM ari_activity WHERE geography = ? AND week_end = ?",
            [name, wk],
        )
        return _result(_rows(cur), "ari_activity", wk)


def list_states_at_level(level: str, week: str | None = None) -> dict:
    """States at a given acute respiratory illness activity level."""
    lvl = _match(level, ARI_LEVELS)
    if not lvl:
        return _unknown("level", level, ARI_LEVELS)
    with _connect() as conn:
        wk = _parse_week(week)
        if wk == "invalid":
            return {"error": "week must be YYYY-MM-DD"}
        if wk is None:
            wk = conn.execute("SELECT MAX(week_end) FROM ari_activity").fetchone()[0]
        cur = conn.execute(
            "SELECT geography AS state FROM ari_activity WHERE label = ? AND week_end = ? ORDER BY 1", [lvl, wk]
        )
        rows = _rows(cur)
        return _result(rows, "ari_activity", wk, count=len(rows))


def get_hospitalization_rate(network: str, age_group: str = "Overall", weeks: int = 4) -> dict:
    """Weekly RESP-NET hospitalization rates per 100,000 (all sites, all sexes and races)."""
    weeks = max(1, min(int(weeks), 52))
    with _connect() as conn:
        nets = _distinct(conn, "hospitalization_rates", "surveillance_network")
        net = _match(network, nets)
        if not net:
            return _unknown("network", network, nets)
        ages = _distinct(conn, "hospitalization_rates", "age_group")
        age = _match(age_group, ages)
        if not age:
            return _unknown("age_group", age_group, ages)
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
        return _result(rows, "hospitalization_rates", as_of, network=net, age_group=age)


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
        if wk is None:
            wk = conn.execute("SELECT MAX(week_end) FROM test_positivity").fetchone()[0]
        where.append("week_end = ?")
        params.append(wk)
        cur = conn.execute(
            "SELECT week_end, pathogen, percent_test_positivity AS percent_positive FROM test_positivity WHERE "
            + " AND ".join(where) + " ORDER BY pathogen",
            params,
        )
        return _result(_rows(cur), "test_positivity", wk)


def get_wastewater(state: str | None = None, county_fips: str | None = None) -> dict:
    """Latest wastewater viral activity percentile and site count for a state or county."""
    if not state and not county_fips:
        return {"error": "Give a state or a county_fips."}
    with _connect() as conn:
        if not conn.execute("SELECT COUNT(*) FROM wastewater_sites").fetchone()[0]:
            return {"error": "No wastewater data is loaded; the CDC dataset has no records in the last 365 days."}
        if county_fips:
            allowed = _distinct(conn, "wastewater_sites", "county_fips")
            if county_fips not in allowed:
                return {"error": f"Unknown county_fips '{county_fips}'.", "allowed_count": len(allowed)}
            col, val = "county_fips", county_fips
        else:
            allowed = _distinct(conn, "wastewater_sites", "wwtp_jurisdiction")
            val = _match(state, allowed)
            if not val:
                return _unknown("state", state, allowed)
            col = "wwtp_jurisdiction"
        as_of = conn.execute(f"SELECT MAX(date_end) FROM wastewater_sites WHERE {col} = ?", [val]).fetchone()[0]
        cur = conn.execute(
            f"""
            SELECT MAX(date_end) AS date_end, ROUND(AVG(percentile), 1) AS avg_percentile,
                   COUNT(DISTINCT wwtp_id) AS site_count
            FROM wastewater_sites WHERE {col} = ? AND date_end = ?
            """,
            [val, as_of],
        )
        return _result(_rows(cur), "wastewater_sites", as_of)


def get_forecast(virus: str) -> dict:
    """Stored LSTM and XGBoost 4-week forecasts with their validation MAE. Never trains."""
    with _connect() as conn:
        nets = _distinct(conn, "hospitalization_rates", "surveillance_network")
    net = _match(virus, nets)
    if not net:
        return _unknown("virus", virus, nets)
    safe = net.replace("-", "_").replace(" ", "_").lower()
    from backend.forecasting import MODEL_DIR as model_dir

    rows = []
    as_of = None
    if os.path.exists(os.path.join(model_dir, f"params_{safe}.json")):
        from backend.forecasting import generate_forecast

        res = generate_forecast(net)
        if res.get("status") == "success":
            as_of = res["last_data_date"]
            rows += [{"model": "lstm", "validation_mae": res["mae"], **f} for f in res["forecasts"]]
    if os.path.exists(os.path.join(model_dir, f"xgb_{safe}.json")):
        from backend.ensemble import xgb_forecast

        res = xgb_forecast(net)
        if res.get("status") == "success":
            as_of = as_of or res.get("last_data_date")
            rows += [{"model": "xgboost", "validation_mae": res["mae"], **f} for f in res.get("forecasts", [])]
    if not rows:
        return {"error": f"No trained forecast is stored for {net}. Training runs from the command line."}
    return _result(rows, "models", as_of, virus=net)


def get_data_freshness() -> dict:
    """Latest week loaded per table and its age in days."""
    checks = [
        ("ari_activity", "week_end"),
        ("hospitalization_rates", "week_ending_date"),
        ("test_positivity", "week_end"),
        ("wastewater_sites", "date_end"),
    ]
    rows = []
    today = date.today()
    with _connect() as conn:
        for table, col in checks:
            latest = conn.execute(f"SELECT MAX({col}) FROM {table}").fetchone()[0]
            age = (today - latest).days if latest else None
            rows.append({
                "table": table,
                "latest_week": _jsonable(latest),
                "age_days": age,
                "stale": age is None or age > config.STALE_AFTER_DAYS,
            })
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
