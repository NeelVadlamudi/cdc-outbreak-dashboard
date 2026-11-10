"""Reject public databases with any objects outside the column allowlist."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import duckdb  # noqa: E402

from backend.read_queries import PUBLIC_COLUMNS  # noqa: E402


def validate_database(path):
    with duckdb.connect(str(path), read_only=True, config={"enable_external_access": False}) as conn:
        database = conn.execute("SELECT current_database()").fetchone()[0]
        schemas = set(conn.execute("SELECT database_name, schema_name FROM duckdb_schemas()").fetchall())
        expected_schemas = {(database, "main"), ("temp", "main"), ("system", "main"),
                            ("system", "information_schema"), ("system", "pg_catalog")}
        if schemas != expected_schemas:
            raise ValueError("Public database contains unexpected schemas")
        tables = set(conn.execute(
            "SELECT database_name, schema_name, table_name FROM duckdb_tables() WHERE NOT internal"
        ).fetchall())
        if tables != {(database, "main", table) for table in PUBLIC_COLUMNS}:
            raise ValueError("Public database tables differ from the allowlist")
        actual = {table: [] for table in PUBLIC_COLUMNS}
        for table, column in conn.execute("""
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_catalog = ? AND table_schema = 'main' ORDER BY table_name, ordinal_position
        """, [database]).fetchall():
            actual[table].append(column)
        if actual != PUBLIC_COLUMNS:
            raise ValueError("Public database columns differ from the allowlist")
        if conn.execute("SELECT count(*) FROM duckdb_views() WHERE NOT internal").fetchone()[0]:
            raise ValueError("Public database contains views")
        if conn.execute("SELECT count(*) FROM duckdb_functions() WHERE NOT internal").fetchone()[0]:
            raise ValueError("Public database contains functions or macros")


if __name__ == "__main__":
    validate_database(Path(sys.argv[1]))
