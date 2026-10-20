#!/usr/bin/env python3
"""
Mirage allocation module: check the extracts without SQL Server or DuckDB.

Recomputes the PO allocation, the transfers and the club scorecard from the raw CSVs
with plain Python, then compares against data/tableau/*.csv and checks the rules:
  - every PO line: cases allocated + cases held at the DC = cases received
  - no club gets more cases than it takes to cover its own need
  - transfers are whole cases, the giving club keeps its floor, the receiver ends at or
    under one case past target
Stdlib only. Exit 0 on PASS, 1 on FAIL.
"""
from __future__ import annotations

import csv
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TAB = DATA / "tableau"


def read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fail(msg: str) -> None:
    print(f"FAIL  {msg}")
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"PASS  {msg}")


def main() -> None:
    p = read(DATA / "dim_alloc_params.csv")[0]
    as_of, start, days = p["as_of_date"], p["sales_window_start"], int(p["sales_window_days"])
    target, keep = float(p["target_wos"]), float(p["donor_keep_wos"])
    over, recv = float(p["overstock_wos"]), float(p["receiver_wos"])

    clubs = {r["store_id"]: r["store_name"] for r in read(DATA / "dim_store.csv") if r["format_type"] == "club"}
    skus = {r["sku_id"] for r in read(DATA / "dim_sku.csv") if r["is_in_assortment"] == "1"}
    pack = {r["sku_id"]: int(r["case_pack"]) for r in read(DATA / "dim_sku_pack.csv")}

    sold = defaultdict(int)
    for r in read(DATA / "fact_sales_daily.csv"):
        if start <= r["sales_date"] <= as_of:
            sold[(r["store_id"], r["sku_id"])] += int(r["units_sold"])

    on_hand = {}
    for r in read(DATA / "fact_inventory_daily.csv"):
        if r["snapshot_date"] == as_of and r["store_id"] in clubs and r["sku_id"] in skus:
            on_hand[(r["store_id"], r["sku_id"])] = int(float(r["floor_qty"]) + float(r["backroom_qty"]))

    rate = {k: 7.0 * sold[k] / days for k in on_hand}
    need = {k: max(0, math.ceil(target * rate[k]) - on_hand[k]) for k in on_hand}

    # PO allocation, largest remainder in whole cases.
    alloc_units = defaultdict(int)
    po_rows = read(DATA / "fact_dc_po.csv")
    summary = {}
    for po in po_rows:
        sku, rec = po["sku_id"], int(po["cases_received"])
        cp = pack[sku]
        stores = sorted(clubs)
        total = sum(need[(s, sku)] for s in stores)
        ship = 0 if total == 0 else min(rec, math.ceil(total / cp))
        base = {s: (ship * need[(s, sku)]) // total if total else 0 for s in stores}
        rem = {s: (ship * need[(s, sku)]) % total if total else 0 for s in stores}
        left = ship - sum(base.values())
        order = sorted(stores, key=lambda s: (-rem[s], -need[(s, sku)], int(s)))
        cases = {s: base[s] + (1 if i < left else 0) for i, s in enumerate(order)}
        for s in stores:
            if cases[s] > math.ceil(need[(s, sku)] / cp):
                fail(f"PO {sku} gives {clubs[s]} {cases[s]} cases, more than its need covers")
            alloc_units[(s, sku)] = cases[s] * cp
        if sum(cases.values()) > rec:
            fail(f"PO {sku} ships more cases than received")
        summary[sku] = (rec, sum(cases.values()), rec - sum(cases.values()))
    ok(f"PO allocation recomputed for {len(po_rows)} lines, no club over its need")

    for r in read(TAB / "v_po_summary.csv"):
        exp = summary[r["sku_id"]]
        got = (int(r["cases_received"]), int(r["cases_allocated"]), int(r["cases_held_at_dc"]))
        if got != exp:
            fail(f"v_po_summary {r['sku_id']} {got} != recomputed {exp}")
        if got[1] + got[2] != got[0]:
            fail(f"v_po_summary {r['sku_id']} allocated + held != received")
    ok("v_po_summary matches, allocated + held at DC = received on every line")

    for r in read(TAB / "v_po_allocation.csv"):
        if int(r["units_allocated"]) != alloc_units[(r["store_id"], r["sku_id"])]:
            fail(f"v_po_allocation {r['store_name']} {r['sku_id']} units differ")
    ok("v_po_allocation store splits match")

    # Transfers after the PO lands.
    proj = {k: on_hand[k] + alloc_units[k] for k in on_hand}
    moves = {}
    for sku in skus:
        rows = [(s, proj[(s, sku)], rate[(s, sku)]) for s in clubs]
        donors = [(s, u, rt) for s, u, rt in rows if u > 0 and (rt == 0 or u / rt > over)]
        receivers = [(s, u, rt) for s, u, rt in rows if rt > 0 and u / rt < recv]
        if not donors or not receivers:
            continue
        d = sorted(donors, key=lambda x: (-(1 if x[2] == 0 else 0), -(x[1] / x[2] if x[2] else 0), int(x[0])))[0]
        r = sorted(receivers, key=lambda x: (x[1] / x[2], int(x[0])))[0]
        if d[0] == r[0]:
            continue
        cp = pack[sku]
        spare = (d[1] - math.ceil(keep * d[2])) // cp
        gap = math.ceil((math.ceil(target * r[2]) - r[1]) / cp)
        n = min(spare, gap)
        if n >= 1:
            moves[sku] = (d[0], r[0], n * cp)
            if d[1] - n * cp < math.ceil(keep * d[2]):
                fail(f"transfer {sku} takes {clubs[d[0]]} below its keep level")
            if r[1] + n * cp > math.ceil(target * r[2]) + cp:
                fail(f"transfer {sku} sends {clubs[r[0]]} more than one case past target")

    got_moves = {m["sku_id"]: (m["from_store_id"], m["to_store_id"], int(m["units_moved"]))
                 for m in read(TAB / "v_reallocation_moves.csv")}
    if got_moves != moves:
        fail(f"v_reallocation_moves {got_moves} != recomputed {moves}")
    ok(f"v_reallocation_moves matches: {len(moves)} transfer(s), keep and target rules hold")

    # Scorecard.
    after = dict(proj)
    for sku, (frm, to, u) in moves.items():
        after[(frm, sku)] -= u
        after[(to, sku)] += u
    perf = {r["store_id"]: r for r in read(TAB / "v_store_performance.csv")}
    tot_before = tot_after = 0
    for s in sorted(clubs):
        keys = [(s, k) for k in skus]
        under_b = sum(1 for k in keys if rate[k] > 0 and on_hand[k] / rate[k] < 1)
        under_a = sum(1 for k in keys if rate[k] > 0 and after[k] / rate[k] < 1)
        st = sum(sold[k] for k in keys) / (sum(sold[k] for k in keys) + sum(on_hand[k] for k in keys))
        row = perf[s]
        if (int(row["skus_under_1_wos_before"]), int(row["skus_under_1_wos_after"])) != (under_b, under_a):
            fail(f"v_store_performance {clubs[s]} under-1-week counts differ")
        if abs(float(row["sell_through"]) - st) > 1e-4:
            fail(f"v_store_performance {clubs[s]} sell-through differs")
        tot_before += under_b
        tot_after += under_a
        ok(f"{clubs[s]}: sell-through {st:.1%}, SKUs under 1 week of supply {under_b} -> {under_a}")

    rec = sum(v[0] for v in summary.values())
    shipped = sum(v[1] for v in summary.values())
    print()
    print(f"ALL PASS - PO {rec} cases: {shipped} allocated, {rec - shipped} held at DC; "
          f"{len(moves)} transfer(s); club-SKUs under 1 week of supply {tot_before} -> {tot_after}")


if __name__ == "__main__":
    main()
