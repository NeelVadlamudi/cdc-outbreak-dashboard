"""Mirage audit agent: locked figures, tools against independent expected values, the proposal guard,
approval with an audit log, and rescoring the recorded eval."""

import json
import subprocess
import sys
from pathlib import Path

import duckdb
import pytest
import yaml
from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "mirage" / "vendor"


@pytest.fixture
def mirage_env(tmp_path, monkeypatch):
    from mirage import build_db

    db = str(tmp_path / "mirage.duckdb")
    monkeypatch.setattr(build_db, "DB_PATH", db)
    monkeypatch.setenv("MIRAGE_STATE_DB", str(tmp_path / "state.duckdb"))
    build_db.build(db)
    return db


@pytest.mark.parametrize("script,last", [
    ("verify_kpis.py", "ALL PASS — warehouse_1 @ 2026-09-22: 22.5% / 7 / 6"),
    ("verify_allocation.py", "ALL PASS - PO 98 cases: 60 allocated, 38 held at DC; 1 transfer(s); "
                             "club-SKUs under 1 week of supply 40 -> 32"),
])
def test_vendored_mirage_checks_pass(script, last):
    out = subprocess.run([sys.executable, str(VENDOR / "scripts" / script)], capture_output=True, text=True)
    assert out.returncode == 0, out.stdout
    assert out.stdout.strip().splitlines()[-1] == last


def test_expected_locks():
    from evals.mirage import expected

    expected.check_locks()


def _tool_value(spec):
    from mirage import tools

    fn = spec["fn"]
    if fn == "kpi":
        return tools.list_shelf_gaps(spec["club"], spec["day"])["summary"][spec["field"]]
    if fn == "position":
        return tools.get_sku_position(spec["club"], spec["sku"], spec["day"])["rows"][0][spec["field"]]
    po = tools.get_po_allocation("PO-26092201")
    if fn == "po_total":
        return po["totals"][spec["field"]]
    if fn == "transfer":
        return po["transfers"][spec.get("index", 0)][spec["field"]]
    if fn == "po_line":
        line = next(r for r in po["rows"] if r["sku_name"] == spec["sku"])
        return line["cases_by_club"][spec["club"]] if spec["field"] == "cases_by_club" else line[spec["field"]]
    if fn == "wos":
        return tools.get_weeks_of_supply(spec["club"], spec["sku"])["rows"][0][spec["field"]]
    raise AssertionError(fn)


def test_tools_agree_with_independent_expected_values(mirage_env):
    """Every expected value in the eval, recomputed from raw CSVs, matches what the tools return."""
    from evals.mirage import expected
    from mirage import tools

    qs = yaml.safe_load((ROOT / "evals" / "mirage" / "questions.yaml").read_text())["questions"]
    assert len(qs) == 30
    n = 0
    for q in qs:
        for spec in q.get("expect") or []:
            assert float(_tool_value(spec)) == pytest.approx(float(expected.evaluate(spec)), abs=0.005), (q["id"], spec)
            n += 1
        if q.get("case"):
            c = q["case"]
            row = tools.get_sku_position(c["club"], c["sku"], c["day"])["rows"][0]
            assert row["next_step"] == expected.position(c["club"], c["sku"], c["day"])["next_step"], q["id"]
    assert n >= 25


def test_unknowns_and_ranges(mirage_env):
    from mirage import tools

    assert "distribution center" in tools.list_shelf_gaps("Avon", "2026-09-22")["error"]
    assert "Counts cover 2026-09-09 to 2026-09-22" in tools.list_shelf_gaps("Everett", "2026-10-01")["error"]
    assert "Unknown SKU" in tools.get_sku_position("Dedham", "999999", "2026-09-22")["error"]
    assert "Unknown purchase order" in tools.get_po_allocation("PO-1")["error"]


def test_guard_blocks_unbacked_proposals_and_never_touches_mirage(mirage_env):
    from mirage import state
    from mirage.tools import AuditToolset

    con = duckdb.connect(mirage_env, read_only=True)
    before = con.execute("SELECT SUM(floor_qty + backroom_qty + system_on_hand_qty), COUNT(*) FROM fact_inventory_daily").fetchone()
    con.close()
    t = AuditToolset()
    p = {"club": "Everett", "sku": "Paper Towels 12pk"}
    assert "look up" in t.call_tool("propose_action", {**p, "action": "recount", "reason": "x"})["error"]
    t.call_tool("get_sku_position", {**p, "day": "2026-09-22"})
    assert "support ['recount']" in t.call_tool("propose_action", {**p, "action": "pull_to_floor", "reason": "x"})["error"]
    assert "not in the tool results" in t.call_tool("propose_action", {**p, "action": "recount", "reason": "backroom 14"})["error"]
    ok = t.call_tool("propose_action", {**p, "action": "recount", "reason": "floor 0, backroom 0, system 36"})
    assert ok["rows"][0]["status"] == "waiting for approval"
    assert len(state.list_proposals()) == 1
    con = duckdb.connect(mirage_env, read_only=True)
    after = con.execute("SELECT SUM(floor_qty + backroom_qty + system_on_hand_qty), COUNT(*) FROM fact_inventory_daily").fetchone()
    con.close()
    assert before == after


def test_mirage_db_is_opened_read_only(mirage_env):
    from mirage import tools

    with tools._connect() as con, pytest.raises(duckdb.Error):
        con.execute("DELETE FROM fact_inventory_daily")


class FakeToolModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def test_end_to_end_ask_propose_approve(mirage_env, monkeypatch, tmp_path):
    from backend import config
    from backend.agent import checker, graph

    messages = [
        AIMessage(content="", tool_calls=[{"name": "get_sku_position", "id": "c1",
                                           "args": {"club": "Everett", "sku": "Paper Towels 12pk", "day": "2026-09-22"}}]),
        AIMessage(content="", tool_calls=[{"name": "propose_action", "id": "c2",
                                           "args": {"club": "Everett", "sku": "Paper Towels 12pk", "action": "recount",
                                                    "reason": "Floor 0 and backroom 0, system shows 36."}}]),
        AIMessage(content="On 2026-09-22 the floor and backroom counts are 0 but the system shows 36: the record is wrong. "
                          "I proposed a recount for approval."),
    ]
    model = FakeToolModel(messages=iter(messages))
    monkeypatch.setattr(graph, "get_chat_model", lambda setting=None: model)
    monkeypatch.setattr(graph, "model_label", lambda setting=None: "fake")
    monkeypatch.setattr(checker, "REVIEW_QUEUE", str(tmp_path / "q.jsonl"))
    monkeypatch.setattr(config, "ADMIN_API_KEY", "test-key")
    from backend.main import app

    client = TestClient(app)
    body = client.post("/api/mirage/ask", json={"question": "Why is Paper Towels 12pk empty at Everett on 2026-09-22?"}).json()
    assert body["status"] == "answered" and body["checker"]["passed"]
    pid = body["proposals"][0]["proposal_id"]
    assert client.get("/api/mirage/proposals", params={"status": "waiting for approval"}).json()["proposals"][0]["id"] == pid

    decision = {"decided_by": "Jordan (floor lead)", "note": "ok"}
    assert client.post(f"/api/proposals/{pid}/approve", json=decision).status_code == 401
    assert client.post(f"/api/proposals/{pid}/approve", json={"decided_by": ""}, headers={"X-API-Key": "test-key"}).status_code == 422
    res = client.post(f"/api/proposals/{pid}/approve", json=decision, headers={"X-API-Key": "test-key"})
    assert res.status_code == 200
    assert res.json()["proposal"]["status"] == "approved"
    assert client.post(f"/api/proposals/{pid}/reject", json=decision, headers={"X-API-Key": "test-key"}).status_code == 409
    assert client.post("/api/proposals/999/approve", json=decision, headers={"X-API-Key": "test-key"}).status_code == 404
    log = client.get("/api/mirage/audit-log", params={"proposal_id": pid}).json()["audit_log"]
    assert len(log) == 1
    assert log[0]["decision"] == "approved" and log[0]["decided_by"] == "Jordan (floor lead)"
    assert log[0]["decided_at"].endswith("Z")


def test_approvals_disabled_without_admin_key(mirage_env, monkeypatch):
    from backend import config
    from mirage import state

    monkeypatch.setattr(config, "ADMIN_API_KEY", "")
    p = state.create_proposal("Everett", "101", "184220", "Paper Towels 12pk", "recount", "r")
    from backend.main import app

    res = TestClient(app).post(f"/api/proposals/{p['id']}/reject", json={"decided_by": "x"})
    assert res.status_code == 503
    assert state.audit_log() == []


def test_recorded_eval_rescores_to_published_summary(mirage_env, tmp_path):
    """CI check: rescoring the committed responses with today's expected values gives the published summary."""
    from evals.mirage import run_mirage_evals

    results = sorted((ROOT / "evals" / "mirage" / "results").glob("*.json"))
    assert results
    latest = json.loads(results[-1].read_text())
    run_mirage_evals.main(["--model", "x", "--from-file", str(results[-1]), "--out-dir", str(tmp_path)])
    rescored = json.loads(next(tmp_path.glob("*.json")).read_text())["summary"]
    assert rescored == latest["summary"]
    site = json.loads((ROOT / "site" / "data" / "mirage_eval.json").read_text())
    assert site["runs"][-1]["summary"] == latest["summary"]
