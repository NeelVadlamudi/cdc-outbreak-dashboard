#!/usr/bin/env python3
"""CI gate: fail when grounded_answers drops > DROP_POINTS vs evals/baseline.json.

Only runs when an explicit artifact is provided (EVAL_RESULT_PATH, --eval-result,
or evals/ci_eval_result.json). Does not scan evals/results/ — those include
historical regressions and would fail every PR until the next clean nightly.

Wire a clean run by copying its JSON to evals/ci_eval_result.json or setting
EVAL_RESULT_PATH in CI. Without an artifact, exits 0 (skip).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.nightly_status import DROP_POINTS, score_drops  # noqa: E402

DEFAULT_CI_ARTIFACT = ROOT / "evals" / "ci_eval_result.json"


def load(path: Path | None) -> dict | None:
    if not path or not path.is_file():
        return None
    return json.loads(path.read_text())


def resolve_artifact(explicit: Path | None) -> Path | None:
    if explicit is not None:
        return explicit
    env = os.environ.get("EVAL_RESULT_PATH")
    if env:
        return Path(env)
    if DEFAULT_CI_ARTIFACT.is_file():
        return DEFAULT_CI_ARTIFACT
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", type=Path, default=ROOT / "evals" / "baseline.json")
    ap.add_argument("--eval-result", type=Path, default=None)
    ap.add_argument("--require-artifact", action="store_true",
                    help="Fail if no eval artifact is found (default: skip).")
    args = ap.parse_args()

    baseline = load(args.baseline)
    if not baseline:
        print("no baseline.json; skipping grounding gate")
        return 0

    result_path = resolve_artifact(args.eval_result)
    result = load(result_path)
    if not result:
        print("no CI eval artifact (EVAL_RESULT_PATH / evals/ci_eval_result.json); skipping")
        return 1 if args.require_artifact else 0

    summary = result.get("summary") or {}
    qset = (baseline.get("summary") or {}).get("question_set")
    if qset and summary.get("question_set") != qset:
        print(f"question_set mismatch ({summary.get('question_set')} vs {qset}); skipping")
        return 0

    drops = score_drops(summary, baseline["summary"], points=DROP_POINTS,
                        higher=["grounded_answers"], lower=[])
    print(json.dumps({
        "artifact": str(result_path),
        "grounded_answers": summary.get("grounded_answers"),
        "baseline": baseline["summary"].get("grounded_answers"),
        "drops": drops,
    }))
    if drops:
        for d in drops:
            print(f"FAIL: grounded_answers {d['value']} vs baseline {d['baseline']} ({d['change']:+} pts)",
                  file=sys.stderr)
        return 1
    print("grounding gate ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
