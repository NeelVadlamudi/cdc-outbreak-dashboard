"""Append a Mirage audit eval result to site/data/mirage_eval.json and rebuild site/data/mirage_replay.json."""

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from publish_eval import ensure_index, now_z  # noqa: E402


def publish(result_path: Path, site_dir: Path, questions_path: Path, scoring_changed: bool = False) -> None:
    res = json.loads(result_path.read_text())
    stamp = now_z()
    path = site_dir / "mirage_eval.json"
    ev = json.loads(path.read_text()) if path.exists() else {"runs": []}
    run = {"model": res["model"], "date": res["date"], "summary": res["summary"]}
    if scoring_changed:
        run["scoring_changed"] = True
    ev["runs"].append(run)
    ev["run_at"] = stamp
    path.write_text(json.dumps(ev, indent=2) + "\n")
    questions = {q["id"]: q for q in yaml.safe_load(questions_path.read_text())["questions"]}
    rows = {r["id"]: r for r in res["rows"]}
    answers = [{"id": qid, "type": questions[qid]["type"], "question": questions[qid]["question"],
                "response": resp, "correct": bool(rows[qid]["correct"])}
               for qid, resp in res["responses"].items()]
    (site_dir / "mirage_replay.json").write_text(json.dumps({"recorded_at": stamp, "answers": answers}, indent=1, default=str) + "\n")
    for name in ("mirage_eval", "mirage_replay"):
        ensure_index(site_dir, name)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("result", type=Path)
    ap.add_argument("--site-dir", type=Path, default=ROOT / "site" / "data")
    ap.add_argument("--questions", type=Path, default=ROOT / "evals" / "mirage" / "questions.yaml")
    ap.add_argument("--scoring-changed", action="store_true")
    args = ap.parse_args()
    publish(args.result, args.site_dir, args.questions, args.scoring_changed)
    print(f"published {args.result.name}")


if __name__ == "__main__":
    main()
