"""Expected answers for the Mirage audit eval, recomputed from the raw Mirage CSVs with plain Python.

It does not use the agent's tools or DuckDB. The logic follows Mirage's own checks:
- Shelf gaps and the gap-board counts follow scripts/verify_kpis.py and sql/02_metrics.sql. Before giving any
  answer, it requires the check day (Everett, 2026-09-22) to still give 22.5%, 7 and 6.
- PO allocation, transfers and weeks of supply follow scripts/verify_allocation.py, and it requires
  98 cases: 60 allocated, 38 held, 1 transfer, 40 -> 32 under one week of supply.
"""

from __future__ import annotations

import csv
import math
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "mirage" / "vendor" / "data"


def _read(name: str) -> list[dict]:
    with (DATA / name).open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


@lru_cache
def _base():
    stores = _read("dim_store.csv")
    clubs = {r["store_id"]: r["city"].split(",")[0] for r in stores if r["format_type"] == "club"}
    skus = {r["sku_id"]: r for r in _read("dim_sku.csv")}
    inv = {(r["snapshot_date"], r["store_id"], r["sku_id"]): (float(r["floor_qty"]), float(r["backroom_qty"]),
                                                             float(r["system_on_hand_qty"]))
           for r in _read("fact_inventory_daily.csv")}
    return clubs, skus, inv


def club_id(club: str) -> str:
    clubs, _, _ = _base()
    return next(k for k, v in clubs.items() if v.lower() == club.lower())


def sku_id(sku: str) -> str:
    _, skus, _ = _base()
    return sku if sku in skus else next(k for k, v in skus.items() if v["sku_name"].lower() == sku.lower())


def kpi(club: str, day: str) -> dict:
    clubs, skus, inv = _base()
    sid = club_id(club)
    rows = [inv[(day, sid, k)] for k, v in skus.items() if v["is_in_assortment"] == "1" and (day, sid, k) in inv]
    gaps = [r for r in rows if r[0] == 0]
    return {
        "assortment_sku_count": len(rows),
        "gap_sku_count": len(gaps),
        "gap_rate_pct": round(100 * len(gaps) / len(rows), 1),
        "book_wrong_sku_count": sum(1 for r in gaps if r[2] > 0),
        "backroom_sku_count": sum(1 for r in gaps if r[1] > 0),
        "truly_out_sku_count": sum(1 for r in gaps if r[1] == 0 and r[2] == 0),
    }


def position(club: str, sku: str, day: str) -> dict:
    _, _, inv = _base()
    floor, back, system = inv[(day, club_id(club), sku_id(sku))]
    case = None
    if floor == 0:
        case = "in_backroom" if back > 0 else ("record_wrong" if system > 0 else "truly_out")
    return {"floor_qty": floor, "backroom_qty": back, "system_on_hand_qty": system, "case": case,
            "next_step": {"in_backroom": "pull_to_floor", "record_wrong": "recount", "truly_out": "reorder"}.get(case)}


@lru_cache
def allocation() -> dict:
    """verify_allocation.py's computation, returned instead of compared."""
    clubs, _, _ = _base()
    p = _read("dim_alloc_params.csv")[0]
    as_of, start, days = p["as_of_date"], p["sales_window_start"], int(p["sales_window_days"])
    target, keep = float(p["target_wos"]), float(p["donor_keep_wos"])
    over, recv = float(p["overstock_wos"]), float(p["receiver_wos"])
    skus = {r["sku_id"] for r in _read("dim_sku.csv") if r["is_in_assortment"] == "1"}
    pack = {r["sku_id"]: int(r["case_pack"]) for r in _read("dim_sku_pack.csv")}
    sold = defaultdict(int)
    for r in _read("fact_sales_daily.csv"):
        if start <= r["sales_date"] <= as_of:
            sold[(r["store_id"], r["sku_id"])] += int(r["units_sold"])
    on_hand = {}
    for r in _read("fact_inventory_daily.csv"):
        if r["snapshot_date"] == as_of and r["store_id"] in clubs and r["sku_id"] in skus:
            on_hand[(r["store_id"], r["sku_id"])] = int(float(r["floor_qty"]) + float(r["backroom_qty"]))
    rate = {k: 7.0 * sold[k] / days for k in on_hand}
    need = {k: max(0, math.ceil(target * rate[k]) - on_hand[k]) for k in on_hand}
    alloc_units = defaultdict(int)
    lines = {}
    for po in _read("fact_dc_po.csv"):
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
            alloc_units[(s, sku)] = cases[s] * cp
        lines[sku] = {"cases_received": rec, "cases_allocated": sum(cases.values()),
                      "cases_held_at_dc": rec - sum(cases.values()),
                      "cases_by_club": {clubs[s]: cases[s] for s in stores}}
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
            moves[sku] = (d[0], r[0], n * cp, n)
    after = dict(proj)
    for sku, (frm, to, u, _) in moves.items():
        after[(frm, sku)] -= u
        after[(to, sku)] += u
    under_b = sum(1 for k in on_hand if rate[k] > 0 and on_hand[k] / rate[k] < 1)
    under_a = sum(1 for k in on_hand if rate[k] > 0 and after[k] / rate[k] < 1)
    wos = {k: {"weekly_rate": rate[k], "on_hand_units": on_hand[k],
               "weeks_of_supply_before": on_hand[k] / rate[k] if rate[k] else None,
               "units_after": after[k], "weeks_of_supply_after": after[k] / rate[k] if rate[k] else None}
           for k in on_hand}
    return {
        "lines": lines,
        "transfers": [{"sku_id": s, "from_club": clubs[f], "to_club": clubs[t], "units": u, "cases": n}
                      for s, (f, t, u, n) in moves.items()],
        "totals": {"cases_received": sum(v["cases_received"] for v in lines.values()),
                   "cases_allocated": sum(v["cases_allocated"] for v in lines.values()),
                   "cases_held_at_dc": sum(v["cases_held_at_dc"] for v in lines.values()),
                   "transfers": len(moves), "club_skus_under_1_week_before": under_b,
                   "club_skus_under_1_week_after": under_a},
        "wos": wos,
    }


def po_total(field: str):
    return allocation()["totals"][field]


def po_line(sku: str, field: str, club: str | None = None):
    line = allocation()["lines"][sku_id(sku)]
    return line["cases_by_club"][club] if field == "cases_by_club" else line[field]


def transfer(index: int, field: str):
    return allocation()["transfers"][index][field]


def wos(club: str, sku: str, field: str):
    v = allocation()["wos"][(club_id(club), sku_id(sku))][field]
    return round(v, 2) if isinstance(v, float) and field.startswith("weeks") else v


def check_locks() -> None:
    k = kpi("Everett", "2026-09-22")
    got = (k["gap_rate_pct"], k["book_wrong_sku_count"], k["backroom_sku_count"])
    if got != (22.5, 7, 6):
        raise AssertionError(f"check day no longer gives 22.5% / 7 / 6: {got}")
    t = allocation()["totals"]
    got = (t["cases_received"], t["cases_allocated"], t["cases_held_at_dc"], t["transfers"],
           t["club_skus_under_1_week_before"], t["club_skus_under_1_week_after"])
    if got != (98, 60, 38, 1, 40, 32):
        raise AssertionError(f"allocation no longer gives 98 / 60 / 38 / 1 / 40 -> 32: {got}")


FUNCS = {"kpi": lambda a: kpi(a["club"], a["day"])[a["field"]],
         "position": lambda a: position(a["club"], a["sku"], a["day"])[a["field"]],
         "po_total": lambda a: po_total(a["field"]),
         "po_line": lambda a: po_line(a["sku"], a["field"], a.get("club")),
         "transfer": lambda a: transfer(a.get("index", 0), a["field"]),
         "wos": lambda a: wos(a["club"], a["sku"], a["field"])}


def evaluate(spec: dict):
    return FUNCS[spec["fn"]](spec)
