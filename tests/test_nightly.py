"""Nightly status.json and alert rules."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import nightly_status as ns  # noqa: E402

BASE = {"question_set": "q1", "numeric_accuracy": 90.0, "tool_choice": 100.0, "correct_refusals": 75.0,
        "false_refusals": 5.0, "grounded_answers": 100.0}


def _status(summary, rows=(), steps=None, baseline_set="q1"):
    return ns.build_status(
        steps=steps or {"refresh": "success", "eval": "success", "backtest": "success"},
        eval_result={"model": "m", "date": "2026-10-21", "summary": summary},
        baseline={"model": "m", "date": "2026-10-20", "summary": {**BASE, "question_set": baseline_set}},
        backtest=None, fresh_rows=list(rows), run_url=None, commit=None, started_at=None)


def test_drop_over_threshold_alerts():
    s = _status({**BASE, "numeric_accuracy": 84.9, "false_refusals": 10.1})
    kinds = {(a["kind"], a["title"]) for a in s["alerts"]}
    assert ("score_drop", "Eval score drop: numeric_accuracy") in kinds
    assert ("score_drop", "Eval score drop: false_refusals") in kinds
    assert s["run"]["result"] == "alert"


def test_drop_of_exactly_five_points_does_not_alert():
    s = _status({**BASE, "numeric_accuracy": 85.0, "false_refusals": 10.0})
    assert s["alerts"] == [] and s["run"]["result"] == "success"


def test_no_comparison_across_question_sets():
    s = _status({**BASE, "question_set": "q2", "numeric_accuracy": 10.0})
    assert s["eval"]["baseline"] is None and s["alerts"] == []


def test_stale_current_table_alerts_but_legacy_does_not():
    rows = [{"table": "test_positivity", "latest_week": "2026-09-01", "age_days": 49, "stale": True},
            {"table": "wastewater_sites", "dataset": "2ew6-ywp6 (legacy)", "legacy": True,
             "latest_week": "2025-09-07", "age_days": 400, "stale": True}]
    s = _status(BASE, rows)
    assert [a["title"] for a in s["alerts"]] == ["Stale data: test_positivity"]


def test_failed_step_is_failure():
    s = _status(BASE, steps={"refresh": "failure", "eval": "success", "backtest": "success"})
    assert s["run"]["result"] == "failure"
    json.dumps(s)
