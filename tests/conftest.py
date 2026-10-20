import duckdb
import pytest

from backend import config
from backend.ratelimit import limiter


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Each test starts with empty rate-limit counters."""
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture()
def fixture_db(tmp_path, monkeypatch):
    """A small DuckDB file with the app's tables and a few rows."""
    path = str(tmp_path / "fixture.duckdb")
    monkeypatch.setattr(config, "DB_PATH", path)
    import backend.database as database

    monkeypatch.setattr(database, "DB_PATH", path)
    database.init_database()
    conn = duckdb.connect(path)
    conn.execute("""INSERT INTO ari_activity VALUES
        ('2026-10-10', 'Ohio', 'Low', 'b1'), ('2026-10-10', 'Texas', 'High', 'b1'),
        ('2026-10-10', 'Utah', 'High', 'b1'), ('2026-10-03', 'Ohio', 'Moderate', 'b0')""")
    conn.execute("""INSERT INTO test_positivity VALUES
        ('2026-10-10', 'COVID-19', 3.6), ('2026-10-10', 'Influenza', 5.0), ('2026-10-03', 'COVID-19', 4.1)""")
    conn.execute("""INSERT INTO hospitalization_rates VALUES
        ('COVID-NET', '2026-27', '2026-10-10', 2026, 0, 'Overall', 'All', 'All', 'Overall', 0.8, 1.0, 'Observed'),
        ('COVID-NET', '2026-27', '2026-10-03', 2026, 0, 'Overall', 'All', 'All', 'Overall', 1.1, 45.0, 'Observed')""")
    conn.execute("""INSERT INTO wastewater_sites (wwtp_jurisdiction, wwtp_id, county_names, county_fips,
        population_served, date_start, date_end, ptc_15d, detect_prop_15d, percentile, sampling_prior,
        first_sample_date) VALUES
        ('Ohio', 'w1', 'Franklin', '39049', 1000, '2025-08-24', '2025-09-07', 1.0, 0.5, 40.0, '', '2020-01-01'),
        ('Ohio', 'w2', 'Franklin', '39049', 1000, '2025-08-24', '2025-09-07', 3.0, 0.5, 60.0, '', '2020-01-01'),
        ('Ohio', 'w3', 'Franklin', '39049', 1000, '2025-08-24', '2025-09-07', -99, 0.5, 999.0, '', '2020-01-01')""")
    conn.execute("UPDATE wastewater_sites SET source_dataset = '2ew6-ywp6', pathogen = 'SARS-CoV-2'")
    conn.execute("""INSERT INTO wastewater_sites (date_end, wwtp_jurisdiction, wwtp_id, county_names,
        population_served, pathogen, wval, wval_category, source_dataset) VALUES
        ('2025-09-06', 'Ohio', 's1', 'Franklin', 1000, 'RSV', 1.0, 'Very Low', 'atcp-73re'),
        ('2025-09-06', 'Ohio', 's2', 'Franklin', 1000, 'RSV', 9.0, 'High', 'atcp-73re'),
        ('2025-09-06', 'Texas', 's3', 'Harris', 1000, 'RSV', 3.0, 'Low', 'atcp-73re')""")
    conn.close()
    return path
