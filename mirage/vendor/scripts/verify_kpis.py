#!/usr/bin/env python3
"""
Mirage — verify locked warehouse_1 KPIs against public extracts.
Stdlib only. Exit 0 on PASS, 1 on FAIL.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KPI_CSV = ROOT / "data" / "tableau" / "v_store_day_kpis.csv"
FLAGS_CSV = ROOT / "data" / "tableau" / "v_inventory_flags.csv"
FACT_CSV = ROOT / "data" / "fact_inventory_daily.csv"
SKU_CSV = ROOT / "data" / "dim_sku.csv"
STORE_CSV = ROOT / "data" / "dim_store.csv"
PINS_CSV = ROOT / "data" / "tableau" / "v_map_pins.csv"

LOCK_STORE = "warehouse_1"
LOCK_DATE = "2026-09-22"
EXPECTED = {
    "gap_rate": 0.225,
    "gap_sku_count": 9,
    "assortment_sku_count": 40,
    "phantom_sku_count": 7,
    "backroom_rescue_sku_count": 6,
}
EXPECTED_COUNTS = {
    "fact_rows": 1680,  # 3 clubs × 40 SKUs × 14 days
    "sku_rows": 40,
    "store_rows": 4,
    "pin_rows": 4,
}
# Town-center pins (lat, lon), rounded to 4 decimals.
TOWN_CENTERS = {
    "warehouse_1": (42.4084, -71.0537),  # Everett, MA
    "warehouse_2": (42.2418, -71.1662),  # Dedham, MA
    "warehouse_3": (42.3765, -71.2356),  # Waltham, MA
    "warehouse_4": (42.1306, -71.0412),  # Avon, MA
}


def fail(msg: str) -> None:
    print(f"FAIL  {msg}")
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"PASS  {msg}")


def count_rows(path: Path) -> int:
    with path.open(newline="", encoding="utf-8") as f:
        return sum(1 for _ in csv.DictReader(f))


def main() -> None:
    for p in (KPI_CSV, FLAGS_CSV, FACT_CSV, SKU_CSV, STORE_CSV, PINS_CSV):
        if not p.is_file():
            fail(f"missing file: {p.relative_to(ROOT)}")

    fact_n = count_rows(FACT_CSV)
    sku_n = count_rows(SKU_CSV)
    store_n = count_rows(STORE_CSV)
    pin_n = count_rows(PINS_CSV)

    if fact_n != EXPECTED_COUNTS["fact_rows"]:
        fail(f"fact_inventory_daily rows={fact_n}, expected {EXPECTED_COUNTS['fact_rows']}")
    ok(f"fact_inventory_daily rows = {fact_n}")

    if sku_n != EXPECTED_COUNTS["sku_rows"]:
        fail(f"dim_sku rows={sku_n}, expected {EXPECTED_COUNTS['sku_rows']}")
    ok(f"dim_sku rows = {sku_n}")

    if store_n != EXPECTED_COUNTS["store_rows"]:
        fail(f"dim_store rows={store_n}, expected {EXPECTED_COUNTS['store_rows']}")
    ok(f"dim_store rows = {store_n}")

    if pin_n != EXPECTED_COUNTS["pin_rows"]:
        fail(f"v_map_pins rows={pin_n}, expected {EXPECTED_COUNTS['pin_rows']}")
    ok(f"v_map_pins rows = {pin_n}")

    # Map pins sit at town centers. No street addresses, no real_site column.
    with PINS_CSV.open(newline="", encoding="utf-8") as f:
        pin_reader = csv.DictReader(f)
        pin_fields = pin_reader.fieldnames or []
        pins = list(pin_reader)
    with STORE_CSV.open(newline="", encoding="utf-8") as f:
        store_reader = csv.DictReader(f)
        store_fields = store_reader.fieldnames or []
        stores = list(store_reader)

    for name, fields in (("v_map_pins", pin_fields), ("dim_store", store_fields)):
        if "real_site" in fields:
            fail(f"{name} still has real_site column (remove for public release)")
        ok(f"{name} has no real_site column")

    for name, rows in (("v_map_pins", pins), ("dim_store", stores)):
        for row in rows:
            label = row.get("store_name", "")
            want = TOWN_CENTERS.get(label)
            if want is None:
                fail(f"{name} unexpected store_name {label!r}")
            got = (round(float(row["lat"]), 4), round(float(row["lon"]), 4))
            if got != want:
                fail(f"{name} {label} pin at {got}, expected town center {want}")
            if any(ch.isdigit() for ch in row.get("map_label", "").replace(label, "")):
                fail(f"{name} {label} map_label looks like a street address: {row['map_label']!r}")
        ok(f"{name} pins sit at town centers (no street addresses)")

    # Locked KPI row
    with KPI_CSV.open(newline="", encoding="utf-8") as f:
        kpis = list(csv.DictReader(f))
    lock = [
        r
        for r in kpis
        if r.get("store_name") == LOCK_STORE and r.get("snapshot_date") == LOCK_DATE
    ]
    if len(lock) != 1:
        fail(f"expected 1 KPI row for {LOCK_STORE} on {LOCK_DATE}, got {len(lock)}")
    row = lock[0]

    gap_rate = float(row["gap_rate"])
    gap_n = int(float(row["gap_sku_count"]))
    ass_n = int(float(row["assortment_sku_count"]))
    ph_n = int(float(row["phantom_sku_count"]))
    re_n = int(float(row["backroom_rescue_sku_count"]))

    checks = [
        ("gap_rate", gap_rate, EXPECTED["gap_rate"], abs(gap_rate - EXPECTED["gap_rate"]) < 1e-6),
        ("gap_sku_count", gap_n, EXPECTED["gap_sku_count"], gap_n == EXPECTED["gap_sku_count"]),
        (
            "assortment_sku_count",
            ass_n,
            EXPECTED["assortment_sku_count"],
            ass_n == EXPECTED["assortment_sku_count"],
        ),
        (
            "phantom_sku_count",
            ph_n,
            EXPECTED["phantom_sku_count"],
            ph_n == EXPECTED["phantom_sku_count"],
        ),
        (
            "backroom_rescue_sku_count",
            re_n,
            EXPECTED["backroom_rescue_sku_count"],
            re_n == EXPECTED["backroom_rescue_sku_count"],
        ),
    ]
    for name, got, exp, good in checks:
        if not good:
            fail(f"{LOCK_STORE} {LOCK_DATE} {name}={got}, expected {exp}")
        ok(f"{LOCK_STORE} {LOCK_DATE} {name} = {got}")

    # Cross-check flags on lock day
    with FLAGS_CSV.open(newline="", encoding="utf-8") as f:
        flags = [
            r
            for r in csv.DictReader(f)
            if r.get("store_name") == LOCK_STORE
            and r.get("snapshot_date") == LOCK_DATE
            and r.get("is_shelf_gap") in ("1", "1.0", "true", "True")
        ]
    ph_f = sum(1 for r in flags if r.get("is_phantom") in ("1", "1.0", "true", "True"))
    re_f = sum(
        1 for r in flags if r.get("is_backroom_rescue") in ("1", "1.0", "true", "True")
    )
    if len(flags) != EXPECTED["gap_sku_count"]:
        fail(f"flag gaps={len(flags)}, expected {EXPECTED['gap_sku_count']}")
    if ph_f != EXPECTED["phantom_sku_count"]:
        fail(f"flag phantom={ph_f}, expected {EXPECTED['phantom_sku_count']}")
    if re_f != EXPECTED["backroom_rescue_sku_count"]:
        fail(f"flag rescue={re_f}, expected {EXPECTED['backroom_rescue_sku_count']}")
    ok(
        f"v_inventory_flags cross-check: gaps={len(flags)} phantom={ph_f} rescue={re_f}"
    )

    print()
    print(
        f"ALL PASS — {LOCK_STORE} @ {LOCK_DATE}: "
        f"{EXPECTED['gap_rate']*100:.1f}% / {EXPECTED['phantom_sku_count']} / "
        f"{EXPECTED['backroom_rescue_sku_count']}"
    )


if __name__ == "__main__":
    main()
