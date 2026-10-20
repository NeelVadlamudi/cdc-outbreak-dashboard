"""Proposals and audit log: the only tables the audit agent writes.

They live in their own DuckDB file (MIRAGE_STATE_DB), separate from the read-only Mirage copy.
The agent can only add a proposal with status "waiting for approval". A person approves or
rejects it through the API; each decision is written to audit_log with who decided and when.
"""

import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import duckdb

STATE_DB = os.getenv("MIRAGE_STATE_DB", str(Path(__file__).resolve().parent.parent / "data" / "mirage_state.duckdb"))
WAITING = "waiting for approval"
ACTIONS = ("recount", "pull_to_floor", "reorder")
_lock = threading.Lock()


def _path() -> str:
    return os.getenv("MIRAGE_STATE_DB", STATE_DB)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _connect():
    path = _path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(path)
    con.execute("CREATE SEQUENCE IF NOT EXISTS proposal_id_seq START 1")
    con.execute("CREATE SEQUENCE IF NOT EXISTS audit_id_seq START 1")
    con.execute("""CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY DEFAULT nextval('proposal_id_seq'),
        created_at VARCHAR NOT NULL,
        club VARCHAR NOT NULL,
        store_id VARCHAR NOT NULL,
        sku_id VARCHAR NOT NULL,
        sku_name VARCHAR,
        action VARCHAR NOT NULL,
        reason VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        decided_by VARCHAR,
        decided_at VARCHAR)""")
    con.execute("""CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY DEFAULT nextval('audit_id_seq'),
        proposal_id INTEGER NOT NULL,
        decision VARCHAR NOT NULL,
        decided_by VARCHAR NOT NULL,
        decided_at VARCHAR NOT NULL,
        note VARCHAR)""")
    return con


def _rows(cur) -> list[dict]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def create_proposal(club: str, store_id: str, sku_id: str, sku_name: str, action: str, reason: str) -> dict:
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {ACTIONS}")
    with _lock:
        con = _connect()
        try:
            pid = con.execute(
                """INSERT INTO proposals (created_at, club, store_id, sku_id, sku_name, action, reason, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
                [_now(), club, store_id, sku_id, sku_name, action, reason, WAITING]).fetchone()[0]
            return get_proposal(pid, con)
        finally:
            con.close()


def get_proposal(pid: int, con=None) -> dict | None:
    own = con is None
    con = con or _connect()
    try:
        rows = _rows(con.execute("SELECT * FROM proposals WHERE id = ?", [pid]))
        return rows[0] if rows else None
    finally:
        if own:
            con.close()


def list_proposals(status: str | None = None) -> list[dict]:
    con = _connect()
    try:
        if status:
            return _rows(con.execute("SELECT * FROM proposals WHERE status = ? ORDER BY id", [status]))
        return _rows(con.execute("SELECT * FROM proposals ORDER BY id"))
    finally:
        con.close()


def audit_log(proposal_id: int | None = None) -> list[dict]:
    con = _connect()
    try:
        if proposal_id is not None:
            return _rows(con.execute("SELECT * FROM audit_log WHERE proposal_id = ? ORDER BY id", [proposal_id]))
        return _rows(con.execute("SELECT * FROM audit_log ORDER BY id"))
    finally:
        con.close()


class DecisionError(Exception):
    def __init__(self, message: str, code: int):
        super().__init__(message)
        self.code = code


def decide(pid: int, decision: str, decided_by: str, note: str | None = None) -> dict:
    """Approve or reject a waiting proposal and write the decision to audit_log."""
    if decision not in ("approved", "rejected"):
        raise DecisionError("decision must be approved or rejected", 400)
    decided_by = (decided_by or "").strip()
    if not decided_by:
        raise DecisionError("decided_by is required: name the person deciding", 400)
    with _lock:
        con = _connect()
        try:
            prop = get_proposal(pid, con)
            if prop is None:
                raise DecisionError(f"proposal {pid} not found", 404)
            if prop["status"] != WAITING:
                raise DecisionError(f"proposal {pid} is already {prop['status']}", 409)
            at = _now()
            con.execute("BEGIN")
            con.execute("UPDATE proposals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
                        [decision, decided_by, at, pid])
            con.execute("INSERT INTO audit_log (proposal_id, decision, decided_by, decided_at, note) VALUES (?, ?, ?, ?, ?)",
                        [pid, decision, decided_by, at, note])
            con.execute("COMMIT")
            return {"proposal": get_proposal(pid, con), "audit": audit_log_for(con, pid)}
        finally:
            con.close()


def audit_log_for(con, pid: int) -> list[dict]:
    return _rows(con.execute("SELECT * FROM audit_log WHERE proposal_id = ? ORDER BY id", [pid]))
