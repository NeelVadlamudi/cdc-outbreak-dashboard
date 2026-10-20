import duckdb
import pytest

from backend import config


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
    conn.execute("""INSERT INTO wastewater_sites VALUES
        ('Ohio', 'w1', 'Franklin', '39049', 1000, '2025-08-24', '2025-09-07', 1.0, 0.5, 40.0, '', '2020-01-01'),
        ('Ohio', 'w2', 'Franklin', '39049', 1000, '2025-08-24', '2025-09-07', 1.0, 0.5, 60.0, '', '2020-01-01')""")
    conn.close()
    return path
