"""
DuckDB database management for CDC outbreak data.
Lightweight, embedded OLAP database — perfect for analytical queries on time-series surveillance data.
"""

import duckdb
import os
from pathlib import Path

DB_PATH = os.path.join(Path(__file__).parent.parent, "data", "cdc_surveillance.duckdb")


def get_connection():
    """Get a DuckDB connection. Creates the data directory if needed."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    return duckdb.connect(DB_PATH)


def init_database():
    """Initialize database tables for CDC surveillance data."""
    conn = get_connection()

    # ARI Activity by State — weekly activity levels
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ari_activity (
            week_end DATE,
            geography VARCHAR,
            label VARCHAR,
            buildnumber VARCHAR,
            PRIMARY KEY (week_end, geography)
        )
    """)

    # RESP-NET Hospitalization Rates
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hospitalization_rates (
            surveillance_network VARCHAR,
            season VARCHAR,
            week_ending_date DATE,
            mmwr_year INTEGER,
            mmwr_week INTEGER,
            age_group VARCHAR,
            sex VARCHAR,
            race_ethnicity VARCHAR,
            site VARCHAR,
            weekly_rate DOUBLE,
            cumulative_rate DOUBLE,
            rate_type VARCHAR,
            PRIMARY KEY (surveillance_network, week_ending_date, age_group, sex, race_ethnicity, site)
        )
    """)

    # Test Positivity Rates
    conn.execute("""
        CREATE TABLE IF NOT EXISTS test_positivity (
            week_end DATE,
            pathogen VARCHAR,
            percent_test_positivity DOUBLE,
            PRIMARY KEY (week_end, pathogen)
        )
    """)

    # Forecast results cache
    conn.execute("""
        CREATE TABLE IF NOT EXISTS forecasts (
            forecast_date DATE,
            target_date DATE,
            geography VARCHAR,
            virus VARCHAR,
            predicted_rate DOUBLE,
            lower_bound DOUBLE,
            upper_bound DOUBLE,
            model_version VARCHAR,
            PRIMARY KEY (forecast_date, target_date, geography, virus)
        )
    """)

    # Wastewater Surveillance — county/site level
    conn.execute("""
        CREATE TABLE IF NOT EXISTS wastewater_sites (
            wwtp_jurisdiction VARCHAR,
            wwtp_id VARCHAR,
            county_names VARCHAR,
            county_fips VARCHAR,
            population_served INTEGER,
            date_start DATE,
            date_end DATE,
            ptc_15d DOUBLE,
            detect_prop_15d DOUBLE,
            percentile DOUBLE,
            sampling_prior VARCHAR,
            first_sample_date DATE
        )
    """)

    # Anomaly detection results
    conn.execute("""
        CREATE TABLE IF NOT EXISTS anomalies (
            detected_date DATE,
            geography VARCHAR,
            metric VARCHAR,
            value DOUBLE,
            z_score DOUBLE,
            severity VARCHAR,
            description VARCHAR,
            PRIMARY KEY (detected_date, geography, metric)
        )
    """)

    conn.close()
    print("✅ Database initialized successfully")


def query(sql: str, params=None):
    """Execute a read query and return results as list of dicts."""
    conn = get_connection()
    try:
        if params:
            result = conn.execute(sql, params).fetchdf()
        else:
            result = conn.execute(sql).fetchdf()
        return result.to_dict(orient="records")
    finally:
        conn.close()


def execute(sql: str, params=None):
    """Execute a write query."""
    conn = get_connection()
    try:
        if params:
            conn.execute(sql, params)
        else:
            conn.execute(sql)
    finally:
        conn.close()
