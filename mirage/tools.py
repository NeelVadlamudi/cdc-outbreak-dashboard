"""Audit tools on a read-only copy of Mirage, plus propose_action (adds a proposal row only).

Case rules follow Mirage's v_inventory_flags (sql/02_metrics.sql) for an in-assortment SKU with nothing on the floor:
- backroom > 0                    -> stock is in the backroom  -> pull_to_floor
  (if the system on-hand also differs from floor + backroom, a recount is suggested too)
- backroom = 0, system on-hand > 0 -> the record is wrong       -> recount
- backroom = 0, system on-hand = 0 -> truly out                 -> reorder
"""

import json
from difflib import get_close_matches

import duckdb
from pydantic import BaseModel, Field

from mirage import build_db, state

CASES = {
    "in_backroom": ("Stock is in the backroom", "pull_to_floor"),
    "record_wrong": ("The record is wrong", "recount"),
    "truly_out": ("Truly out", "reorder"),
}


def _connect():
    return duckdb.connect(build_db.ensure(), read_only=True)


def _rows(cur) -> list[dict]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _num(v):
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else round(f, 4)


def _clubs(con) -> list[dict]:
    rows = _rows(con.execute("SELECT store_id, store_name, city FROM dim_store WHERE format_type = 'club' ORDER BY store_id"))
    for r in rows:
        r["club"] = r["city"].split(",")[0]
    return rows


def _resolve_club(con, club: str):
    clubs = _clubs(con)
    key = (club or "").strip().lower()
    for c in clubs:
        if key in (c["club"].lower(), c["store_name"].lower(), c["store_id"], c["city"].lower()):
            return c, None
    dc = _rows(con.execute("SELECT store_id, store_name, city FROM dim_store WHERE format_type <> 'club'"))
    for d in dc:
        if key in (d["store_name"].lower(), d["store_id"], d["city"].lower(), d["city"].split(",")[0].lower()):
            return None, {"error": f"{d['city'].split(',')[0]} is the distribution center, not a club; it has no shelf counts.",
                          "clubs": [c["club"] for c in clubs]}
    return None, {"error": f"Unknown club '{club}'.", "clubs": [c["club"] for c in clubs]}


def _resolve_sku(con, sku: str):
    rows = _rows(con.execute("SELECT sku_id, sku_name, category, is_in_assortment FROM dim_sku"))
    key = str(sku or "").strip()
    for r in rows:
        if key == r["sku_id"] or key.lower() == r["sku_name"].lower():
            return r, None
    names = {r["sku_name"].lower(): r for r in rows}
    partial = [r for r in rows if key.lower() and key.lower() in r["sku_name"].lower()]
    if len(partial) == 1:
        return partial[0], None
    close = get_close_matches(key.lower(), list(names), n=3, cutoff=0.6)
    if len(close) == 1:
        return names[close[0]], None
    return None, {"error": f"Unknown SKU '{sku}'.",
                  "did_you_mean": [names[c]["sku_name"] for c in close] or [r["sku_name"] for r in partial][:5]}


def _check_day(con, day: str):
    lo, hi = con.execute("SELECT MIN(snapshot_date), MAX(snapshot_date) FROM fact_inventory_daily").fetchone()
    try:
        d = str(day)[:10]
        con.execute("SELECT CAST(? AS DATE)", [d])
    except duckdb.Error:
        return None, {"error": f"Invalid day '{day}'. Use YYYY-MM-DD."}
    if not (lo.isoformat() <= d <= hi.isoformat()):
        return None, {"error": f"No counts for {d}. Counts cover {lo.isoformat()} to {hi.isoformat()}.",
                      "first_day": lo.isoformat(), "last_day": hi.isoformat()}
    return d, None


def classify(floor, backroom, system) -> dict:
    """Case and next step for one SKU-day. Returns {} when the shelf is not empty."""
    floor, backroom, system = float(floor), float(backroom), float(system)
    if floor > 0:
        return {}
    if backroom > 0:
        case = "in_backroom"
    elif system > 0:
        case = "record_wrong"
    else:
        case = "truly_out"
    label, step = CASES[case]
    out = {"case": case, "case_label": label, "next_step": step}
    mismatch = system - (floor + backroom)
    if case == "in_backroom" and mismatch != 0:
        out["also"] = "recount"
        out["also_reason"] = "System on-hand differs from floor plus backroom."
    return out


# ---------- input schemas ----------

class ShelfGapsInput(BaseModel):
    club: str = Field(description="Club name (Everett, Dedham, Waltham) or id (warehouse_1, 101)")
    day: str = Field(description="Count day, YYYY-MM-DD")


class SkuPositionInput(BaseModel):
    club: str = Field(description="Club name or id")
    sku: str = Field(description="SKU id or name")
    day: str = Field(description="Count day, YYYY-MM-DD")


class PoInput(BaseModel):
    po: str = Field(description="Purchase order id, e.g. PO-26092201")


class WosInput(BaseModel):
    club: str = Field(description="Club name or id")
    sku: str = Field(description="SKU id or name")


class ProposeInput(BaseModel):
    club: str = Field(description="Club name or id")
    sku: str = Field(description="SKU id or name")
    action: str = Field(description="One of: recount, pull_to_floor, reorder")
    reason: str = Field(description="Why, citing the counts")


# ---------- tools ----------

def list_shelf_gaps(club: str, day: str) -> dict:
    """Empty shelves at a club on a day: every in-assortment SKU with floor count 0, with backroom and system on-hand counts, the case (record wrong, stock in backroom, truly out) and next step. Includes the day's gap rate and counts."""
    with _connect() as con:
        c, err = _resolve_club(con, club)
        if err:
            return err
        d, err = _check_day(con, day)
        if err:
            return err
        rows = _rows(con.execute("""
            SELECT f.sku_id, k.sku_name, k.category, f.floor_qty, f.backroom_qty, f.system_on_hand_qty
            FROM fact_inventory_daily f JOIN dim_sku k USING (sku_id)
            WHERE f.store_id = ? AND f.snapshot_date = CAST(? AS DATE) AND k.is_in_assortment = 1
            ORDER BY k.category, k.sku_name""", [c["store_id"], d]))
    gaps = []
    for r in rows:
        cl = classify(r["floor_qty"], r["backroom_qty"], r["system_on_hand_qty"])
        if cl:
            gaps.append({"sku_id": r["sku_id"], "sku_name": r["sku_name"], "category": r["category"],
                         "floor_qty": _num(r["floor_qty"]), "backroom_qty": _num(r["backroom_qty"]),
                         "system_on_hand_qty": _num(r["system_on_hand_qty"]), **cl})
    n = len(rows)
    summary = {
        "assortment_sku_count": n,
        "gap_sku_count": len(gaps),
        "gap_rate_pct": round(100 * len(gaps) / n, 1) if n else None,
        # Mirage's tiles: "book is wrong" = floor 0 and system > 0; "stuck in backroom" = floor 0 and backroom > 0
        "book_wrong_sku_count": sum(1 for g in gaps if g["system_on_hand_qty"] > 0),
        "backroom_sku_count": sum(1 for g in gaps if g["backroom_qty"] > 0),
        "truly_out_sku_count": sum(1 for g in gaps if g["case"] == "truly_out"),
    }
    return {"as_of": d, "source_table": "fact_inventory_daily", "club": c["club"], "store_id": c["store_id"],
            "summary": summary, "rows": gaps}


def get_sku_position(club: str, sku: str, day: str) -> dict:
    """Floor, backroom and system on-hand counts for one SKU at one club on one day, the gap between system and physical counts, and (if the shelf is empty) the case and next step."""
    with _connect() as con:
        c, err = _resolve_club(con, club)
        if err:
            return err
        k, err = _resolve_sku(con, sku)
        if err:
            return err
        d, err = _check_day(con, day)
        if err:
            return err
        r = con.execute("""SELECT floor_qty, backroom_qty, system_on_hand_qty FROM fact_inventory_daily
                           WHERE store_id = ? AND sku_id = ? AND snapshot_date = CAST(? AS DATE)""",
                        [c["store_id"], k["sku_id"], d]).fetchone()
    if r is None:
        return {"error": f"No count for {k['sku_name']} at {c['club']} on {d}."}
    floor, back, system = (_num(v) for v in r)
    row = {"sku_id": k["sku_id"], "sku_name": k["sku_name"], "category": k["category"],
           "in_assortment": bool(k["is_in_assortment"]), "floor_qty": floor, "backroom_qty": back,
           "system_on_hand_qty": system, "physical_qty": _num(floor + back),
           "system_minus_physical": _num(system - (floor + back)), "shelf_empty": floor == 0}
    row.update(classify(floor, back, system))
    return {"as_of": d, "source_table": "fact_inventory_daily", "club": c["club"], "store_id": c["store_id"], "rows": [row]}


def get_po_allocation(po: str) -> dict:
    """How a DC purchase order was split: per SKU line the cases received, allocated to clubs and held at the DC, the cases each club gets, and any club-to-club transfers after it lands."""
    key = (po or "").strip().upper()
    with _connect() as con:
        lines = _rows(con.execute("""SELECT s.sku_id, k.sku_name, s.case_pack, s.cases_received, s.cases_allocated,
                                            s.cases_held_at_dc, s.total_need_units, s.units_allocated
                                     FROM v_po_summary s JOIN dim_sku k USING (sku_id)
                                     WHERE upper(s.po_id) = ? ORDER BY k.sku_name""", [key]))
        if not lines:
            pos = [r[0] for r in con.execute("SELECT DISTINCT po_id FROM v_po_summary").fetchall()]
            return {"error": f"Unknown purchase order '{po}'.", "purchase_orders": pos}
        splits = _rows(con.execute("""SELECT a.sku_id, d.city, a.cases_allocated, a.units_allocated, a.need_units
                                      FROM v_po_allocation a JOIN dim_store d USING (store_id)
                                      WHERE upper(a.po_id) = ? ORDER BY a.sku_id, a.store_id""", [key]))
        receipt = con.execute("SELECT MIN(receipt_date) FROM fact_dc_po WHERE upper(po_id) = ?", [key]).fetchone()[0]
        moves = _rows(con.execute("""SELECT m.sku_id, m.sku_name, f.city AS from_city, t.city AS to_city, m.cases_moved, m.units_moved
                                     FROM v_reallocation_moves m JOIN dim_store f ON f.store_id = m.from_store_id
                                     JOIN dim_store t ON t.store_id = m.to_store_id"""))
        before, after = con.execute("""SELECT SUM(CASE WHEN weekly_rate > 0 AND wos_before < 1 THEN 1 ELSE 0 END),
                                              SUM(CASE WHEN weekly_rate > 0 AND wos_after < 1 THEN 1 ELSE 0 END)
                                       FROM v_store_sku_final""").fetchone()
    by_sku = {}
    for s in splits:
        by_sku.setdefault(s["sku_id"], {})[s["city"].split(",")[0]] = int(s["cases_allocated"])
    rows = [{"sku_id": ln["sku_id"], "sku_name": ln["sku_name"], "case_pack": int(ln["case_pack"]),
             "cases_received": int(ln["cases_received"]), "cases_allocated": int(ln["cases_allocated"]),
             "cases_held_at_dc": int(ln["cases_held_at_dc"]), "cases_by_club": by_sku.get(ln["sku_id"], {})}
            for ln in lines]
    transfers = [{"sku_id": m["sku_id"], "sku_name": m["sku_name"], "from_club": m["from_city"].split(",")[0],
                  "to_club": m["to_city"].split(",")[0], "cases": int(m["cases_moved"]), "units": int(m["units_moved"])}
                 for m in moves]
    totals = {"lines": len(rows), "cases_received": sum(r["cases_received"] for r in rows),
              "cases_allocated": sum(r["cases_allocated"] for r in rows),
              "cases_held_at_dc": sum(r["cases_held_at_dc"] for r in rows),
              "transfers": len(transfers),
              "club_skus_under_1_week_before": int(before), "club_skus_under_1_week_after": int(after)}
    return {"as_of": receipt.isoformat() if receipt else None, "source_table": "v_po_summary", "po": key,
            "totals": totals, "transfers": transfers, "rows": rows}


def get_weeks_of_supply(club: str, sku: str) -> dict:
    """Weeks of supply for one SKU at one club on the allocation day: weekly sales rate (last 28 days), units on hand (floor plus backroom), weeks of supply before the PO, units in from the PO and transfers, and weeks of supply after."""
    with _connect() as con:
        c, err = _resolve_club(con, club)
        if err:
            return err
        k, err = _resolve_sku(con, sku)
        if err:
            return err
        p = _rows(con.execute("SELECT * FROM dim_alloc_params"))[0]
        r = _rows(con.execute("""SELECT f.weekly_rate, f.on_hand_units, f.wos_before, f.po_units_in, f.transfer_units_in,
                                        f.transfer_units_out, f.units_after, f.wos_after, s.units_sold_window, s.system_on_hand_units
                                 FROM v_store_sku_final f JOIN v_store_sku_position s USING (store_id, sku_id)
                                 WHERE f.store_id = ? AND f.sku_id = ?""", [c["store_id"], k["sku_id"]]))
    if not r:
        return {"error": f"No weeks-of-supply row for {k['sku_name']} at {c['club']}."}
    r = r[0]
    row = {"sku_id": k["sku_id"], "sku_name": k["sku_name"],
           "units_sold_28d": int(r["units_sold_window"]), "weekly_rate": _num(r["weekly_rate"]),
           "on_hand_units": int(r["on_hand_units"]), "system_on_hand_units": int(r["system_on_hand_units"]),
           "weeks_of_supply_before": round(float(r["wos_before"]), 2) if r["wos_before"] is not None else None,
           "po_units_in": int(r["po_units_in"]), "transfer_units_in": int(r["transfer_units_in"]),
           "transfer_units_out": int(r["transfer_units_out"]), "units_after": int(r["units_after"]),
           "weeks_of_supply_after": round(float(r["wos_after"]), 2) if r["wos_after"] is not None else None,
           "target_weeks": _num(p["target_wos"])}
    return {"as_of": p["as_of_date"].isoformat(), "source_table": "v_store_sku_final", "club": c["club"],
            "store_id": c["store_id"], "rows": [row]}


def propose_action(club: str, sku: str, action: str, reason: str) -> dict:
    """Propose a next step (recount, pull_to_floor or reorder) for a person to approve. Only adds a row with status "waiting for approval" to the proposals table; it changes no inventory record."""
    action = (action or "").strip().lower().replace(" ", "_")
    if action not in state.ACTIONS:
        return {"error": f"action must be one of {list(state.ACTIONS)}"}
    if not (reason or "").strip():
        return {"error": "reason is required"}
    with _connect() as con:
        c, err = _resolve_club(con, club)
        if err:
            return err
        k, err = _resolve_sku(con, sku)
        if err:
            return err
    from backend.ratelimit import allow_proposal
    ok, why = allow_proposal()
    if not ok:
        return {"error": f"proposal not saved: {why}"}
    p = state.create_proposal(c["club"], c["store_id"], k["sku_id"], k["sku_name"], action, reason.strip())
    return {"as_of": None, "source_table": "proposals",
            "rows": [{"proposal_id": p["id"], "club": p["club"], "sku_id": p["sku_id"], "sku_name": p["sku_name"],
                      "action": p["action"], "status": p["status"]}]}


TOOLS = {
    "list_shelf_gaps": (list_shelf_gaps, ShelfGapsInput),
    "get_sku_position": (get_sku_position, SkuPositionInput),
    "get_po_allocation": (get_po_allocation, PoInput),
    "get_weeks_of_supply": (get_weeks_of_supply, WosInput),
    "propose_action": (propose_action, ProposeInput),
}
READ_ONLY = ("list_shelf_gaps", "get_sku_position", "get_po_allocation", "get_weeks_of_supply")


def call_tool(name: str, args: dict) -> dict:
    if name not in TOOLS:
        return {"error": f"Unknown tool '{name}'."}
    fn, schema = TOOLS[name]
    try:
        parsed = schema(**(args or {}))
    except Exception as e:
        return {"error": f"Invalid inputs: {e}"}
    try:
        return fn(**parsed.model_dump())
    except duckdb.Error as e:
        return {"error": f"Database error: {e}"}


def dumps(result: dict) -> str:
    return json.dumps(result, default=str)


class AuditToolset:
    """Per-run toolset. It remembers what the read tools returned, and propose_action only writes a
    proposal that is backed by them:
    - a read tool in this run returned a case for that club and SKU (an empty shelf);
    - the action is that case's next step, or its suggested second step;
    - every number in the reason appears in, or is derived from, those tool results (same number checker as answers).
    Otherwise it returns an error and writes nothing."""

    TOOLS = TOOLS
    dumps = staticmethod(dumps)

    def __init__(self):
        self.outputs: list[dict] = []

    def _cases(self, store_id: str, sku_id: str) -> set[str]:
        steps = set()
        for out in self.outputs:
            if out.get("store_id") != store_id:
                continue
            for row in out.get("rows", []):
                if row.get("sku_id") == sku_id and row.get("next_step"):
                    steps.add(row["next_step"])
                    if row.get("also"):
                        steps.add(row["also"])
        return steps

    def call_tool(self, name: str, args: dict) -> dict:
        if name != "propose_action":
            out = call_tool(name, args)
            if "error" not in out:
                self.outputs.append(out)
            return out
        from backend.agent.checker import check_numbers

        try:
            parsed = ProposeInput(**(args or {}))
        except Exception as e:
            return {"error": f"Invalid inputs: {e}"}
        with _connect() as con:
            c, err = _resolve_club(con, parsed.club)
            if err:
                return err
            k, err = _resolve_sku(con, parsed.sku)
            if err:
                return err
        allowed = self._cases(c["store_id"], k["sku_id"])
        if not allowed:
            return {"error": f"No proposal written: look up {k['sku_name']} at {c['club']} first "
                             "(get_sku_position or list_shelf_gaps) and confirm the shelf is empty."}
        action = parsed.action.strip().lower().replace(" ", "_")
        if action not in allowed:
            return {"error": f"No proposal written: the counts for {k['sku_name']} at {c['club']} support "
                             f"{sorted(allowed)}, not '{parsed.action}'."}
        check = check_numbers(parsed.reason, self.outputs)
        if not check["passed"]:
            return {"error": f"No proposal written: the reason cites numbers not in the tool results: {check['unverified']}."}
        return propose_action(parsed.club, parsed.sku, action, parsed.reason)
