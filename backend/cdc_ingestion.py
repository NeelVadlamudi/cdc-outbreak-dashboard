"""
CDC SODA API Data Ingestion Pipeline.
Fetches live data from 4 CDC datasets (incl. county-level wastewater), transforms, and loads into DuckDB.
"""

import logging
from datetime import datetime, timedelta

import duckdb
import httpx
import pandas as pd

logger = logging.getLogger(__name__)

from backend.config import DB_PATH  # noqa: E402

# CDC SODA API endpoints (no auth required)
CDC_DATASETS = {
    "ari_activity": {
        "url": "https://data.cdc.gov/resource/f3zz-zga5.json",
        "description": "Level of Acute Respiratory Illness Activity by State",
    },
    "hospitalization_rates": {
        "url": "https://data.cdc.gov/resource/kvib-3txy.json",
        "description": "RESP-NET Hospitalization Rates (RSV, COVID-19, Flu)",
    },
    "test_positivity": {
        "url": "https://data.cdc.gov/resource/seuz-s2cv.json",
        "description": "Percent Positive Tests for Viral Respiratory Pathogens",
    },
    # Legacy NWSS SARS-CoV-2 metric dataset; CDC stopped adding records after 2025-09-07.
    # Kept for the frozen eval snapshot and the older wastewater pages; no longer ingested.
    "wastewater_sites": {
        "url": "https://data.cdc.gov/resource/2ew6-ywp6.json",
        "description": "NWSS Wastewater Surveillance — County-Level Viral Activity (legacy)",
    },
    # Current NWSS dataset: weekly site-level Wastewater Viral Activity Level (WVAL)
    # for SARS-CoV-2, influenza A and RSV.
    "wastewater_activity": {
        "url": "https://data.cdc.gov/resource/atcp-73re.json",
        "description": "CDC Wastewater Viral Activity Level for SARS-CoV-2, Influenza A and RSV",
    },
}


async def fetch_dataset(dataset_key: str, limit: int = 50000, offset: int = 0) -> list:
    """Fetch a CDC dataset via SODA API with pagination."""
    config = CDC_DATASETS[dataset_key]
    url = f"{config['url']}?$limit={limit}&$offset={offset}&$order=:id"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()
        logger.info(f"Fetched {len(data)} records from {config['description']}")
        return data


async def fetch_all_pages(dataset_key: str, limit: int = 50000) -> list:
    """Fetch all pages of a CDC dataset."""
    all_data = []
    offset = 0
    while True:
        batch = await fetch_dataset(dataset_key, limit=limit, offset=offset)
        if not batch:
            break
        all_data.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return all_data


def ingest_ari_activity(data: list):
    """Load ARI activity data into DuckDB."""
    if not data:
        return

    conn = duckdb.connect(DB_PATH)
    try:
        # Clean and insert
        for record in data:
            week_end = record.get("week_end", "")[:10] if record.get("week_end") else None
            geography = record.get("geography")
            label = record.get("label")
            buildnumber = record.get("buildnumber", "")

            if week_end and geography and label:
                conn.execute("""
                    INSERT OR REPLACE INTO ari_activity (week_end, geography, label, buildnumber)
                    VALUES (?, ?, ?, ?)
                """, [week_end, geography, label, buildnumber])

        count = conn.execute("SELECT COUNT(*) FROM ari_activity").fetchone()[0]
        logger.info(f"ARI Activity: {count} total records in DB")
    finally:
        conn.close()


async def fetch_hospitalization_recent(since: str = "2023-09-01") -> list:
    """Fetch observed weekly RESP-NET rates since a date (current CDC schema)."""
    config = CDC_DATASETS["hospitalization_rates"]
    where = (
        "date_type='Week Ending Date' AND data_type in ('Weekly Rate','Cumulative Rate') "
        f"AND rate_type='Observed' AND date>'{since}'"
    )
    all_data = []
    offset = 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        while True:
            response = await client.get(
                config["url"],
                params={"$where": where, "$limit": 50000, "$offset": offset, "$order": ":id"},
            )
            response.raise_for_status()
            batch = response.json()
            all_data.extend(batch)
            logger.info(f"Fetched {len(batch)} hospitalization records (total: {len(all_data)})")
            if len(batch) < 50000:
                break
            offset += 50000
    return all_data


def ingest_hospitalization_rates(data: list):
    """Load RESP-NET observed rates into DuckDB, one row per week with weekly and cumulative rates."""
    if not data:
        return
    raw = pd.DataFrame(data)
    raw = raw[raw["date"].str.len() >= 10].copy()
    raw["estimate"] = pd.to_numeric(raw["estimate"], errors="coerce")
    keys = ["surveillance_network", "season", "date", "age_category", "sex", "race", "state"]
    wide = raw.pivot_table(index=keys, columns="data_type", values="estimate", aggfunc="first").reset_index()
    df = pd.DataFrame({  # noqa: F841 (read by DuckDB below)
        "surveillance_network": wide["surveillance_network"],
        "season": wide["season"],
        "week_ending_date": pd.to_datetime(wide["date"].str[:10]).dt.date,
        "mmwr_year": pd.to_datetime(wide["date"].str[:10]).dt.year,
        "mmwr_week": 0,
        "age_group": wide["age_category"],
        "sex": wide["sex"],
        "race_ethnicity": wide["race"],
        "site": wide["state"],
        "weekly_rate": wide.get("Weekly Rate"),
        "cumulative_rate": wide.get("Cumulative Rate"),
        "rate_type": "Observed",
    }).drop_duplicates(
        subset=["surveillance_network", "week_ending_date", "age_group", "sex", "race_ethnicity", "site"], keep="last"
    )
    conn = duckdb.connect(DB_PATH)
    try:
        conn.execute("DELETE FROM hospitalization_rates")
        conn.execute("INSERT INTO hospitalization_rates SELECT * FROM df")
        count = conn.execute("SELECT COUNT(*) FROM hospitalization_rates").fetchone()[0]
        logger.info(f"Hospitalization Rates: {count} total records in DB")
    finally:
        conn.close()


def ingest_test_positivity(data: list):
    """Load test positivity data into DuckDB."""
    if not data:
        return

    conn = duckdb.connect(DB_PATH)
    try:
        for record in data:
            week_end = record.get("week_end", "")[:10] if record.get("week_end") else None
            pathogen = record.get("pathogen")
            pct = record.get("percent_test_positivity")

            if week_end and pathogen and pct is not None:
                try:
                    conn.execute("""
                        INSERT OR REPLACE INTO test_positivity (week_end, pathogen, percent_test_positivity)
                        VALUES (?, ?, ?)
                    """, [week_end, pathogen, float(pct)])
                except (ValueError, TypeError):
                    continue

        count = conn.execute("SELECT COUNT(*) FROM test_positivity").fetchone()[0]
        logger.info(f"Test Positivity: {count} total records in DB")
    finally:
        conn.close()


async def fetch_wastewater_recent(days: int = 90) -> list:
    """Fetch only recent wastewater data using SODA $where date filter."""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00")
    config = CDC_DATASETS["wastewater_sites"]
    url = f"{config['url']}?$where=date_end>'{cutoff}'&$limit=50000&$order=:id"

    all_data = []
    offset = 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        while True:
            page_url = f"{url}&$offset={offset}"
            response = await client.get(page_url)
            response.raise_for_status()
            batch = response.json()
            if not batch:
                break
            all_data.extend(batch)
            logger.info(f"Fetched {len(batch)} wastewater records (total: {len(all_data)})")
            if len(batch) < 50000:
                break
            offset += 50000
    return all_data


def ingest_wastewater(data: list):
    """Load NWSS wastewater data into DuckDB using fast batch insert."""
    if not data:
        return

    # Clean data into a DataFrame for fast batch insert
    rows = []
    for record in data:
        try:
            date_end = record.get("date_end", "")[:10] if record.get("date_end") else None
            wwtp_id = record.get("wwtp_id")
            if not date_end or not wwtp_id:
                continue
            rows.append({
                "wwtp_jurisdiction": record.get("wwtp_jurisdiction", ""),
                "wwtp_id": wwtp_id,
                "county_names": record.get("county_names", ""),
                "county_fips": record.get("county_fips", ""),
                "population_served": int(record.get("population_served", 0)) if record.get("population_served") else 0,
                "date_start": record.get("date_start", "")[:10] if record.get("date_start") else None,
                "date_end": date_end,
                "ptc_15d": float(record.get("ptc_15d", 0)) if record.get("ptc_15d") else 0.0,
                "detect_prop_15d": float(record.get("detect_prop_15d", 0)) if record.get("detect_prop_15d") else 0.0,
                "percentile": float(record.get("percentile", 0)) if record.get("percentile") else 0.0,
                "sampling_prior": record.get("sampling_prior", ""),
                "first_sample_date": record.get("first_sample_date", "")[:10] if record.get("first_sample_date") else None,
            })
        except (ValueError, TypeError):
            continue

    if not rows:
        return

    df = pd.DataFrame(rows)
    # Deduplicate — CDC data can have duplicate (wwtp_id, date_end) entries
    df = df.drop_duplicates(subset=["wwtp_id", "date_end"], keep="last")
    conn = duckdb.connect(DB_PATH)
    try:
        # Clear and batch insert (much faster than individual INSERT OR REPLACE)
        conn.execute("DELETE FROM wastewater_sites")
        conn.execute("INSERT INTO wastewater_sites SELECT * FROM df")
        count = conn.execute("SELECT COUNT(*) FROM wastewater_sites").fetchone()[0]
        counties = conn.execute("SELECT COUNT(DISTINCT county_fips) FROM wastewater_sites").fetchone()[0]
        logger.info(f"Wastewater: {count} records across {counties} counties")
    finally:
        conn.close()


async def fetch_wastewater_activity(days: int = 120) -> list:
    """Fetch recent site-level wastewater viral activity levels."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    config = CDC_DATASETS["wastewater_activity"]
    all_data, offset = [], 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        while True:
            response = await client.get(
                config["url"],
                params={"$where": f"week_end>='{since}'", "$limit": 50000, "$offset": offset, "$order": ":id"},
            )
            response.raise_for_status()
            batch = response.json()
            all_data.extend(batch)
            logger.info(f"Fetched {len(batch)} wastewater activity records (total: {len(all_data)})")
            if len(batch) < 50000:
                break
            offset += 50000
    return all_data


def wastewater_activity_frame(data: list) -> pd.DataFrame:
    """Shape raw atcp-73re records into the wastewater_activity table."""
    w = pd.DataFrame(data)
    if w.empty:
        return w
    df = pd.DataFrame({
        "week_end": pd.to_datetime(w["week_end"].str[:10]).dt.date,
        "state_territory": w.get("state_territory"),
        "site": w.get("site"),
        "counties_served": w.get("counties_served"),
        "population_served": pd.to_numeric(w.get("population_served"), errors="coerce").astype("Int64"),
        "source": w.get("source"),
        "pathogen": w.get("pathogen_target"),
        "wval": pd.to_numeric(w.get("site_wval"), errors="coerce"),
        "wval_category": w.get("site_wval_category"),
    })
    return df.drop_duplicates(subset=["week_end", "site", "pathogen"], keep="last")


def ingest_wastewater_activity(data: list):
    """Replace the wastewater_activity table with freshly fetched records."""
    df = wastewater_activity_frame(data)  # noqa: F841 (read by DuckDB below)
    if df.empty:
        return
    conn = duckdb.connect(DB_PATH)
    try:
        conn.execute("DELETE FROM wastewater_activity")
        conn.execute("INSERT INTO wastewater_activity SELECT * FROM df")
        count = conn.execute("SELECT COUNT(*) FROM wastewater_activity").fetchone()[0]
        logger.info(f"Wastewater activity: {count} records")
    finally:
        conn.close()


async def run_full_ingestion():
    """Run complete data ingestion pipeline for all CDC datasets."""
    logger.info("CDC data ingestion started at %s", datetime.now().isoformat())

    steps = [
        ("ari_activity", lambda: fetch_all_pages("ari_activity"), ingest_ari_activity),
        ("hospitalization_rates", fetch_hospitalization_recent, ingest_hospitalization_rates),
        ("test_positivity", lambda: fetch_all_pages("test_positivity"), ingest_test_positivity),
        ("wastewater_activity", fetch_wastewater_activity, ingest_wastewater_activity),
    ]
    ok = True
    for name, fetch, ingest in steps:
        # Each dataset loads on its own so one failure does not block the others.
        try:
            ingest(await fetch())
        except Exception as e:
            ok = False
            logger.exception("Ingestion failed for %s: %s", name, e)
    logger.info("CDC data ingestion finished at %s", datetime.now().isoformat())
    return ok
