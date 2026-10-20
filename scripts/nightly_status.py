"""Build site/data/status.json for the nightly run and decide which alerts to raise.

Alerts:
- score_drop: an eval rate is more than DROP_POINTS percentage points worse than evals/baseline.json
  (lower for numeric_accuracy, tool_choice, correct_refusals, grounded_answers; higher for false_refusals).
  Only compared when the question_set matches the baseline.
- stale: a current (non-legacy) table's latest week is older than STALE_AFTER_DAYS.
- step_failed: a nightly step (refresh, eval, backtest) did not succeed.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402

DROP_POINTS = 5.0
HIGHER_IS_BETTER = ["numeric_accuracy", "tool_choice", "correct_refusals", "grounded_answers"]
LOWER_IS_BETTER = ["false_refusals"]
# Mirage audit eval (evals/mirage): same rule, its own baseline (evals/mirage/baseline.json)
MIRAGE_HIGHER = ["overall_correct", "numeric_accuracy", "case_and_step", "proposal_accuracy", "tool_choice",
                 "correct_refusals", "grounded_answers"]
MIRAGE_LOWER = ["false_refusals", "unrequested_proposals"]


def now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def score_drops(summary: dict, baseline: dict, points: float = DROP_POINTS,
                higher: list | None = None, lower: list | None = None) -> list[dict]:
    higher = HIGHER_IS_BETTER if higher is None else higher
    lower = LOWER_IS_BETTER if lower is None else lower
    drops = []
    for key in higher + lower:
        new, old = summary.get(key), baseline.get(key)
        if not isinstance(new, (int, float)) or not isinstance(old, (int, float)):
            continue
        worse = (old - new) if key in higher else (new - old)
        if worse > points:
            drops.append({"metric": key, "baseline": old, "value": new, "change": round(new - old, 1)})
    return drops


def freshness(db_path: str) -> list[dict]:
    config.DB_PATH = db_path
    from backend.agent import tools

    tools.config.DB_PATH = db_path
    return tools.get_data_freshness()["rows"]


def eval_block(result: dict | None, baseline: dict | None, label: str, alerts: list,
               higher: list | None = None, lower: list | None = None) -> dict | None:
    if not result:
        return None
    s = result["summary"]
    block = {"model": result["model"], "date": result["date"], "question_set": s.get("question_set"),
             "summary": s, "baseline": None, "drops": []}
    if baseline and baseline["summary"].get("question_set") == s.get("question_set"):
        drops = score_drops(s, baseline["summary"], higher=higher, lower=lower)
        block["baseline"] = {"date": baseline["date"], "model": baseline["model"], "summary": baseline["summary"]}
        block["drops"] = drops
        for d in drops:
            alerts.append({"kind": "score_drop", "title": f"{label} score drop: {d['metric']}",
                           "detail": f"{d['metric']} was {d['value']} against a baseline of {d['baseline']} "
                                     f"({d['change']:+} points; alert threshold {DROP_POINTS:g})."})
    return block


def build_status(*, steps: dict, eval_result: dict | None, baseline: dict | None, backtest: dict | None,
                 fresh_rows: list[dict], run_url: str | None, commit: str | None, started_at: str | None,
                 mirage_result: dict | None = None, mirage_baseline: dict | None = None) -> dict:
    alerts = []
    for name, outcome in steps.items():
        if outcome not in ("success", "skipped"):
            alerts.append({"kind": "step_failed", "title": f"Nightly step failed: {name}",
                           "detail": f"The {name} step finished with outcome '{outcome}'."})

    cdc_eval = eval_block(eval_result, baseline, "Eval", alerts)
    mirage_eval = eval_block(mirage_result, mirage_baseline, "Mirage audit eval", alerts, MIRAGE_HIGHER, MIRAGE_LOWER)

    stale = [r for r in fresh_rows if r.get("stale") and not r.get("legacy")]
    for r in stale:
        name = r["table"] + (f" ({r['dataset']})" if r.get("dataset") else "")
        alerts.append({"kind": "stale", "title": f"Stale data: {name}",
                       "detail": f"Latest week {r['latest_week']} is {r['age_days']} days old "
                                 f"(limit {config.STALE_AFTER_DAYS} days)."})

    failed = any(a["kind"] == "step_failed" for a in alerts)
    result = "failure" if failed else ("alert" if alerts else "success")
    return {
        "generated_at": now_z(),
        "run": {"result": result, "started_at": started_at, "finished_at": now_z(),
                "url": run_url, "commit": commit, "steps": steps},
        "eval": cdc_eval,
        "mirage_eval": mirage_eval,
        "backtest": ({"run_at": backtest.get("run_at"), "data_through": backtest.get("data_through"),
                      "notes": backtest.get("notes", [])} if backtest else None),
        "freshness": {"stale_after_days": config.STALE_AFTER_DAYS,
                      "tables": [{k: r.get(k) for k in ("table", "dataset", "legacy", "latest_week", "age_days", "stale")}
                                 for r in fresh_rows]},
        "alerts": alerts,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default=config.DB_PATH)
    ap.add_argument("--eval-result", type=Path)
    ap.add_argument("--baseline", type=Path, default=ROOT / "evals" / "baseline.json")
    ap.add_argument("--mirage-result", type=Path)
    ap.add_argument("--mirage-baseline", type=Path, default=ROOT / "evals" / "mirage" / "baseline.json")
    ap.add_argument("--backtest", type=Path, default=ROOT / "evals" / "results" / "backtest.json")
    ap.add_argument("--step", action="append", default=[], help="name=outcome, e.g. refresh=success")
    ap.add_argument("--run-url")
    ap.add_argument("--commit")
    ap.add_argument("--started-at")
    ap.add_argument("--out", type=Path, default=ROOT / "site" / "data" / "status.json")
    args = ap.parse_args()

    load = lambda p: json.loads(p.read_text()) if p and p.is_file() else None  # noqa: E731
    steps = dict(s.split("=", 1) for s in args.step)
    try:
        rows = freshness(args.db)
    except Exception as e:  # the refresh may have failed and left no database
        rows = []
        steps.setdefault("freshness", f"error: {type(e).__name__}")
    status = build_status(steps=steps, eval_result=load(args.eval_result), baseline=load(args.baseline),
                          backtest=load(args.backtest), fresh_rows=rows, run_url=args.run_url,
                          commit=args.commit, started_at=args.started_at,
                          mirage_result=load(args.mirage_result), mirage_baseline=load(args.mirage_baseline))
    args.out.write_text(json.dumps(status, indent=2) + "\n")
    from publish_eval import ensure_index

    ensure_index(args.out.parent, "status")
    print(json.dumps({"result": status["run"]["result"], "alerts": [a["title"] for a in status["alerts"]]}))


if __name__ == "__main__":
    main()
