"""Run the 30-question Mirage audit eval and score it.

Expected values come from evals/mirage/expected.py (raw Mirage CSVs, plain Python, the logic of Mirage's
verify_kpis.py and verify_allocation.py). The check day must still give 22.5%, 7 and 6 or the run stops.

    python evals/mirage/run_mirage_evals.py --model gemini-3.5-flash-lite
    python evals/mirage/run_mirage_evals.py --model gemini-3.5-flash-lite --from-file evals/mirage/results/<file>.json

Each question runs in-process against a fresh, empty proposals database, so proposals from one
question never affect another.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from evals.mirage import expected as exp  # noqa: E402
from evals.run_evals import grounded, is_refusal, pct, result_base, value_found  # noqa: E402

HERE = Path(__file__).resolve().parent
QUESTIONS = HERE / "questions.yaml"
RESULTS = HERE / "results"

STEP_WORDS = {"recount": r"recount", "pull_to_floor": r"\bpull", "reorder": r"reorder|replenish"}
CASE_WORDS = {"in_backroom": r"backroom", "record_wrong": r"record|system|book", "truly_out": r"truly out|out of stock|actually out|none on hand|no stock"}


def expected_for(q: dict) -> dict:
    out = {"values": [exp.evaluate(s) for s in q.get("expect") or []]}
    if q.get("case"):
        c = q["case"]
        pos = exp.position(c["club"], c["sku"], c["day"])
        out.update(case=pos["case"], next_step=pos["next_step"], sku_id=exp.sku_id(c["sku"]))
    return out


def score_one(q: dict, e: dict, resp: dict) -> dict:
    answer = resp.get("answer") or ""
    calls = resp.get("tool_calls") or []
    called = {c.get("tool") for c in calls}
    proposals = [row for c in calls if c.get("tool") == "propose_action" for row in (c.get("output") or {}).get("rows", [])]
    refused = is_refusal(answer)
    blocked = sum(1 for c in calls if c.get("tool") == "propose_action" and (c.get("output") or {}).get("error"))
    r = {"id": q["id"], "type": q["type"], "refused": refused, "tools_called": sorted(t for t in called if t),
         "tool_choice_ok": set(q.get("expected_tools") or []) <= called, "elapsed_s": resp.get("elapsed_s"),
         "status": resp.get("status"), "expected": e, "proposals": proposals, "blocked_proposals": blocked}
    if q["type"] == "refusal":
        r["correct"] = r["correct_refusal"] = refused and not proposals
    else:
        r["false_refusal"] = refused
        tol = float(q.get("tolerance", 0))
        checks = []
        if e["values"]:
            r["values_ok"] = (not refused) and all(value_found(v, answer, tol) for v in e["values"])
            checks.append(r["values_ok"])
        if e.get("case"):
            low = answer.lower()
            r["case_ok"] = bool(re.search(CASE_WORDS[e["case"]], low)) and bool(re.search(STEP_WORDS[e["next_step"]], low))
            checks.append(r["case_ok"])
        if q["type"] == "propose":
            r["proposal_ok"] = any(p.get("sku_id") == e["sku_id"] and p.get("action") == e["next_step"]
                                   and p.get("status") == "waiting for approval" for p in proposals)
            checks.append(r["proposal_ok"])
        else:
            r["unrequested_proposal"] = bool(proposals)
        r["correct"] = all(checks) and not refused
    r["delivered"] = bool(answer.strip()) and not refused
    r["grounded"] = grounded(answer, q["question"], calls) if r["delivered"] else None
    return r


def summarize(rows: list[dict], question_set: str) -> dict:
    def rate(key, subset):
        vals = [r[key] for r in subset if key in r]
        return pct(sum(1 for v in vals if v), len(vals))
    answerable = [r for r in rows if r["type"] != "refusal"]
    times = sorted(r["elapsed_s"] for r in rows if isinstance(r.get("elapsed_s"), (int, float)))
    delivered = [r for r in rows if r["delivered"]]
    return {
        "question_set": question_set,
        "questions": len(rows),
        "overall_correct": rate("correct", rows),
        "numeric_accuracy": rate("values_ok", answerable),
        "case_and_step": rate("case_ok", answerable),
        "proposal_accuracy": rate("proposal_ok", answerable),
        "unrequested_proposals": rate("unrequested_proposal", answerable),
        "tool_choice": rate("tool_choice_ok", answerable),
        "blocked_proposals": sum(r.get("blocked_proposals", 0) for r in rows),
        "correct_refusals": rate("correct_refusal", rows),
        "false_refusals": rate("false_refusal", answerable),
        "grounded_answers": pct(sum(1 for r in delivered if r["grounded"]), len(delivered)),
        "median_s": round(statistics.median(times), 2) if times else None,
        "p95_s": round(times[min(len(times) - 1, int(0.95 * len(times)))], 2) if times else None,
    }


def markdown(model: str, day: str, summary: dict, rows: list[dict]) -> str:
    lines = [f"# Mirage audit eval: {model}, {day}", "", "| Score | Value |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in summary.items()]
    lines += ["", "| id | type | correct | tools ok | refused | grounded |", "|---|---|---|---|---|---|"]
    lines += [f"| {r['id']} | {r['type']} | {r['correct']} | {r['tool_choice_ok']} | {r['refused']} | "
              f"{'-' if r['grounded'] is None else r['grounded']} |" for r in rows]
    return "\n".join(lines) + "\n"


def run_live(questions: list, setting: str | None) -> dict:
    from mirage.agent import run_audit

    responses = {}
    tmp = tempfile.mkdtemp(prefix="mirage-eval-")
    for q in questions:
        os.environ["MIRAGE_STATE_DB"] = os.path.join(tmp, f"{q['id']}.duckdb")
        start = time.perf_counter()
        try:
            responses[q["id"]] = run_audit(q["question"], setting=setting)
        except Exception as e:  # record the failure; it scores as wrong
            responses[q["id"]] = {"answer": "", "tool_calls": [], "error": f"{type(e).__name__}: {e}",
                                  "elapsed_s": round(time.perf_counter() - start, 3)}
        print(f"{q['id']}: {responses[q['id']].get('status')} {responses[q['id']].get('elapsed_s')}s", flush=True)
    return responses


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model", required=True, help="label used in the results file name")
    ap.add_argument("--setting", help="model setting (gemini-flash-lite or ollama-local); default AGENT_MODEL")
    ap.add_argument("--from-file", type=Path, help="score saved responses instead of calling the model")
    ap.add_argument("--questions", type=Path, default=QUESTIONS)
    ap.add_argument("--out-dir", type=Path, default=RESULTS)
    ap.add_argument("--no-write", action="store_true", help="print the summary only")
    args = ap.parse_args(argv)

    exp.check_locks()
    spec = yaml.safe_load(args.questions.read_text())
    questions = spec["questions"]
    expected = {q["id"]: expected_for(q) for q in questions}
    if args.from_file:
        saved = json.loads(args.from_file.read_text())
        responses, model, day = saved["responses"], saved["model"], saved["date"]
    else:
        responses, model, day = run_live(questions, args.setting), args.model, date.today().isoformat()
    rows = [score_one(q, expected[q["id"]], responses.get(q["id"], {})) for q in questions]
    summary = summarize(rows, spec.get("version"))
    print(json.dumps(summary, indent=1))
    if not args.no_write:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        base = result_base(args.out_dir, model, day)
        base.with_name(base.name + ".json").write_text(json.dumps(
            {"model": model, "date": day, "summary": summary, "rows": rows, "responses": responses}, indent=1, default=str))
        base.with_name(base.name + ".md").write_text(markdown(model, day, summary, rows))
        print(f"wrote {base.name}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
