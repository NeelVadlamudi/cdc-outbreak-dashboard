"""
CDC SODA API Data Ingestion Pipeline.
Fetches live data from 4 CDC datasets (incl. county-level wastewater), transforms, and loads into DuckDB.
"""

import httpx
import duckdb
import os
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = os.path.join(Path(__file__).parent.parent, "data", "cdc_surveillance.duckdb")

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
    "wastewater_sites": {
        "url": "https://data.cdc.gov/resource/2ew6-ywp6.json",
        "description": "NWSS Wastewater Surveillance — County-Level Viral Activity",
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
        print(f"📡 Fetched {len(data)} records from {config['description']}")
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
        print(f"✅ ARI Activity: {count} total records in DB")
    finally:
        conn.close()


def ingest_hospitalization_rates(data: list):
    """Load RESP-NET hospitalization data into DuckDB."""
    if not data:
        return

    conn = duckdb.connect(DB_PATH)
    try:
        for record in data:
            try:
                conn.execute("""
                    INSERT OR REPLACE INTO hospitalization_rates
                    (surveillance_network, season, week_ending_date, mmwr_year, mmwr_week,
                     age_group, sex, race_ethnicity, site, weekly_rate, cumulative_rate, rate_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    record.get("surveillance_network", ""),
                    record.get("season", ""),
                    record.get("week_ending_date", "")[:10] if record.get("week_ending_date") else None,
                    int(record.get("mmwr_year", 0)),
                    int(record.get("mmwr_week", 0)),
                    record.get("age_group", "Overall"),
                    record.get("sex", "Overall"),
                    record.get("race_ethnicity", "Overall"),
                    record.get("site", ""),
                    float(record.get("weekly_rate", 0)) if record.get("weekly_rate") else 0,
                    float(record.get("cumulative_rate", 0)) if record.get("cumulative_rate") else 0,
                    record.get("rate_type", ""),
                ])
            except (ValueError, TypeError):
                continue

        count = conn.execute("SELECT COUNT(*) FROM hospitalization_rates").fetchone()[0]
        print(f"✅ Hospitalization Rates: {count} total records in DB")
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
        print(f"✅ Test Positivity: {count} total records in DB")
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
            print(f"📡 Fetched {len(batch)} wastewater records (total: {len(all_data)})")
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
        print(f"✅ Wastewater: {count} records across {counties} counties")
    finally:
        conn.close()


async def run_full_ingestion():
    """Run complete data ingestion pipeline for all CDC datasets."""
    print(f"\n{'='*60}")
    print(f"🚀 CDC Data Ingestion Pipeline — {datetime.now().isoformat()}")
    print(f"{'='*60}\n")

    try:
        # Fetch all datasets
        ari_data = await fetch_all_pages("ari_activity")
        hosp_data = await fetch_all_pages("hospitalization_rates")
        positivity_data = await fetch_all_pages("test_positivity")
        # Fetch wastewater — only last 90 days (SODA $where filter)
        wastewater_data = await fetch_wastewater_recent(days=365)

        # Ingest into DuckDB
        ingest_ari_activity(ari_data)
        ingest_hospitalization_rates(hosp_data)
        ingest_test_positivity(positivity_data)
        ingest_wastewater(wastewater_data)

        print(f"\n✅ Full ingestion complete at {datetime.now().isoformat()}")
        return True
    except Exception as e:
        print(f"\n❌ Ingestion failed: {e}")
        return False
