"""Load the vendored Mirage CSVs into a DuckDB file. The agent opens it read-only."""

import os
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
VENDOR = HERE / "vendor" / "data"
DB_PATH = os.getenv("MIRAGE_DB_PATH", str(HERE / "mirage.duckdb"))

TABLES = {
    "dim_store": "dim_store.csv",
    "dim_sku": "dim_sku.csv",
    "dim_sku_pack": "dim_sku_pack.csv",
    "dim_alloc_params": "dim_alloc_params.csv",
    "fact_dc_po": "fact_dc_po.csv",
    "fact_inventory_daily": "fact_inventory_daily.csv",
    "fact_sales_daily": "fact_sales_daily.csv",
    "v_po_summary": "tableau/v_po_summary.csv",
    "v_po_allocation": "tableau/v_po_allocation.csv",
    "v_reallocation_moves": "tableau/v_reallocation_moves.csv",
    "v_store_sku_position": "tableau/v_store_sku_position.csv",
    "v_store_sku_final": "tableau/v_store_sku_final.csv",
}


def build(path: str | None = None) -> str:
    path = path or DB_PATH
    tmp = path + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    con = duckdb.connect(tmp)
    try:
        for table, rel in TABLES.items():
            src = str(VENDOR / rel)
            con.execute(f"CREATE TABLE {table} AS SELECT * FROM read_csv_auto(?, header=true, all_varchar=false)", [src])
        # ids stay text so '101' and 'PO-26092201' compare as written
        for table in ("dim_store", "fact_inventory_daily", "fact_sales_daily", "v_po_allocation",
                      "v_store_sku_position", "v_store_sku_final"):
            con.execute(f"ALTER TABLE {table} ALTER store_id TYPE VARCHAR")
        for table in ("dim_sku", "dim_sku_pack", "fact_dc_po", "fact_inventory_daily", "fact_sales_daily",
                      "v_po_summary", "v_po_allocation", "v_reallocation_moves", "v_store_sku_position",
                      "v_store_sku_final"):
            con.execute(f"ALTER TABLE {table} ALTER sku_id TYPE VARCHAR")
        con.execute("ALTER TABLE v_reallocation_moves ALTER from_store_id TYPE VARCHAR")
        con.execute("ALTER TABLE v_reallocation_moves ALTER to_store_id TYPE VARCHAR")
    finally:
        con.close()
    os.replace(tmp, path)
    return path


def ensure(path: str | None = None) -> str:
    path = path or DB_PATH
    if not os.path.exists(path):
        build(path)
    return path


if __name__ == "__main__":
    print(f"wrote {build()}")
