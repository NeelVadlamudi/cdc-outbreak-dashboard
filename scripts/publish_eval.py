"""Append an eval results file to site/data/eval.json runs[] and rebuild site/data/replay.json from it."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_index(site_dir: Path, name: str) -> None:
    """Add `name` to data/index.json `available` if it is not listed."""
    path = site_dir / "index.json"
    idx = json.loads(path.read_text()) if path.exists() else {"available": []}
    if name not in idx.setdefault("available", []):
        idx["available"].append(name)
        path.write_text(json.dumps(idx) + "\n")


def publish(result_path: Path, site_dir: Path, questions_path: Path, note: str | None = None,
            scoring_changed: bool = False) -> None:
    res = json.loads(result_path.read_text())
    stamp = now_z()
    eval_path = site_dir / "eval.json"
    ev = json.loads(eval_path.read_text()) if eval_path.exists() else {"runs": []}
    run = {"model": res["model"], "date": res["date"], "summary": res["summary"]}
    if note:
        run["note"] = note
    if scoring_changed:
        run["scoring_changed"] = True
    ev["runs"].append(run)
    ev["run_at"] = stamp
    eval_path.write_text(json.dumps(ev, indent=2) + "\n")

    questions = {q["id"]: q["question"] for q in yaml.safe_load(questions_path.read_text())["questions"]}
    graded = {r["id"]: r for r in res["rows"]}
    responses = res["responses"]
    items = responses.items() if isinstance(responses, dict) else [(r["id"], r) for r in responses]
    answers = []
    for qid, r in items:
        body = r.get("response", r)
        answers.append({"question": questions[qid], "response": body, "correct": bool(graded[qid]["correct"])})
    (site_dir / "replay.json").write_text(json.dumps({"recorded_at": stamp, "answers": answers}, indent=1) + "\n")
    for name in ("eval", "replay", "status"):
        ensure_index(site_dir, name)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("result", type=Path)
    ap.add_argument("--site-dir", type=Path, default=ROOT / "site" / "data")
    ap.add_argument("--questions", type=Path, default=ROOT / "evals" / "questions.yaml")
    ap.add_argument("--note")
    ap.add_argument("--scoring-changed", action="store_true", help="mark this run as the first with a changed scorer")
    args = ap.parse_args()
    publish(args.result, args.site_dir, args.questions, args.note, args.scoring_changed)
    print(f"published {args.result.name}")


if __name__ == "__main__":
    main()
