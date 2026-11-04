"""CI grounding gate skips without artifact; fails on large grounded_answers drops."""

import json
import sys
from pathlib import Path

import scripts.check_grounding_gate as gate


def test_skip_without_artifact(monkeypatch, tmp_path):
    monkeypatch.delenv("EVAL_RESULT_PATH", raising=False)
    monkeypatch.setattr(gate, "DEFAULT_CI_ARTIFACT", tmp_path / "missing.json")
    monkeypatch.setattr(
        sys, "argv", ["check_grounding_gate.py", "--baseline", str(Path("evals/baseline.json"))]
    )
    assert gate.main() == 0


def test_fail_on_drop(tmp_path, monkeypatch):
    baseline = {
        "date": "2026-10-20",
        "model": "m",
        "summary": {"question_set": "cdc-q60-v1", "grounded_answers": 100.0},
    }
    result = {
        "date": "2026-11-04",
        "model": "m",
        "summary": {"question_set": "cdc-q60-v1", "grounded_answers": 16.7},
    }
    b = tmp_path / "baseline.json"
    r = tmp_path / "result.json"
    b.write_text(json.dumps(baseline))
    r.write_text(json.dumps(result))
    monkeypatch.setattr(sys, "argv", ["x", "--baseline", str(b), "--eval-result", str(r)])
    assert gate.main() == 1


def test_pass_when_grounded_holds(tmp_path, monkeypatch):
    baseline = {
        "date": "2026-10-20",
        "model": "m",
        "summary": {"question_set": "cdc-q60-v1", "grounded_answers": 100.0},
    }
    result = {
        "date": "2026-10-21",
        "model": "m",
        "summary": {"question_set": "cdc-q60-v1", "grounded_answers": 97.0},
    }
    b = tmp_path / "baseline.json"
    r = tmp_path / "result.json"
    b.write_text(json.dumps(baseline))
    r.write_text(json.dumps(result))
    monkeypatch.setattr(sys, "argv", ["x", "--baseline", str(b), "--eval-result", str(r)])
    assert gate.main() == 0
