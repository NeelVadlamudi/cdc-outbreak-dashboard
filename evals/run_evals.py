"""Run the eval questions against the agent and score the answers.

Live run (app must be serving the snapshot data):
    python evals/run_evals.py --model gemini-2.0-flash --url http://localhost:8000

Score saved responses offline:
    python evals/run_evals.py --model gemini-2.0-flash --from-file responses.json

A responses file is either {"<question id>": <response>, ...} or a results file
written by this script. A response is what POST /api/agent/ask returns:
{"answer": str, "tool_calls": [{"tool": str, "inputs": {...}, "output": ...}],
 "as_of": str, "elapsed_s": float}

Writes evals/results/<model>_<date>.json and a .md summary next to it.
"""

import argparse
import json
import os
import re
import statistics
import sys
from datetime import date, datetime
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
QUESTIONS = HERE / "questions.yaml"
SNAPSHOT = HERE / "snapshot.duckdb"
RESULTS = HERE / "results"

REFUSAL_PATTERNS = [
    r"\bnot (?:available|covered|in (?:the|my) data)\b",
    r"\bdoes(?:n't| not) (?:cover|include|contain|have)\b",
    r"\bdo(?:n't| not) have\b",
    r"\bno data\b",
    r"\bcan(?:not|'t)\b",
    r"\bunable to\b",
    r"\bcould not (?:verify|find)\b",
    r"\bisn't (?:available|tracked)\b",
    r"\boutside (?:the|my) data\b",
]
_REFUSAL = re.compile("|".join(REFUSAL_PATTERNS), re.IGNORECASE)

_MONTHS = ("january february march april may june july august september "
           "october november december").split()
_DATE_RE = re.compile(
    r"\b\d{4}-\d{2}-\d{2}\b"
    r"|\b(?:" + "|".join(m[:3] for m in _MONTHS) + r")[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b"
    r"|\b\d{1,2}/\d{1,2}/\d{2,4}\b",
    re.IGNORECASE,
)
_NUM_RE = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")


# ---------- parsing helpers ----------

def strip_dates(text: str) -> str:
    return _DATE_RE.sub(" ", text)


def numbers_in(text: str) -> list[float]:
    """Numbers in free text, ignoring dates. '1,162' -> 1162, '3.6%' -> 3.6."""
    out = []
    for m in _NUM_RE.findall(strip_dates(text)):
        try:
            out.append(float(m.replace(",", "")))
        except ValueError:
            pass
    return out


def dates_in(text: str) -> set[str]:
    """Dates in free text as ISO strings."""
    found = set()
    for m in _DATE_RE.findall(text):
        s = m.replace(".", "").replace(",", "")
        s = re.sub(r"(\d)(st|nd|rd|th)", r"\1", s)
        for fmt in ("%Y-%m-%d", "%B %d %Y", "%b %d %Y", "%m/%d/%Y", "%m/%d/%y"):
            try:
                found.add(datetime.strptime(s, fmt).date().isoformat())
                break
            except ValueError:
                continue
    return found


def is_refusal(answer: str) -> bool:
    return bool(_REFUSAL.search(answer or ""))


def tool_output_numbers(tool_calls: list) -> list[float]:
    nums = []
    for call in tool_calls or []:
        for key in ("output", "result", "outputs"):
            if key in call:
                nums.extend(numbers_in(json.dumps(call[key], default=str)))
    return nums


def matches(value, candidates: list[float], tol: float) -> bool:
    return any(abs(c - value) <= tol + 1e-9 for c in candidates)


def grounded(answer: str, question: str, tool_calls: list) -> bool:
    """Every number in the answer appears in a tool result after rounding.
    Numbers already in the question are allowed."""
    source = tool_output_numbers(tool_calls) + numbers_in(question)
    for n in numbers_in(answer):
        decimals = 0 if n == int(n) else len(repr(n).split(".")[1])
        tol = 0.5 * 10 ** -decimals
        if not matches(n, source, tol) and not matches(-n, source, tol):
            return False
    return True


# ---------- scoring ----------

def expected_values(questions: list, snapshot: Path) -> dict:
    import duckdb
    con = duckdb.connect(str(snapshot), read_only=True)
    try:
        out = {}
        for q in questions:
            if q.get("expected_sql"):
                row = con.execute(q["expected_sql"]).fetchone()
                out[q["id"]] = [v.isoformat() if isinstance(v, date) else v for v in row]
        return out
    finally:
        con.close()


def value_found(expected, answer: str, tol: float) -> bool:
    if isinstance(expected, str):
        return expected in dates_in(answer) or expected in answer
    nums = numbers_in(answer)
    exp = float(expected)
    return matches(exp, nums, tol) or (exp < 0 and matches(-exp, nums, tol))


def score_one(q: dict, expected: list | None, resp: dict) -> dict:
    answer = resp.get("answer") or ""
    calls = resp.get("tool_calls") or []
    called = {c.get("tool") for c in calls}
    refused = is_refusal(answer)
    answerable = q["type"] != "refusal"
    r = {
        "id": q["id"],
        "type": q["type"],
        "refused": refused,
        "tools_called": sorted(t for t in called if t),
        "tool_choice_ok": set(q.get("expected_tools") or []) <= called,
        "elapsed_s": resp.get("elapsed_s"),
    }
    if answerable:
        tol = float(q.get("tolerance", 0))
        r["expected"] = expected
        r["correct"] = (not refused) and all(value_found(v, answer, tol) for v in expected)
        r["false_refusal"] = refused
    else:
        no_number = not numbers_in(answer.replace(q["question"], ""))
        r["correct"] = refused and no_number
        r["correct_refusal"] = r["correct"]
    r["delivered"] = bool(answer.strip()) and not refused
    r["grounded"] = grounded(answer, q["question"], calls) if r["delivered"] else None
    for k in ("input_tokens", "output_tokens"):
        usage = resp.get("usage") or {}
        if k in usage:
            r[k] = usage[k]
    return r


def pct(n: int, d: int):
    return round(100.0 * n / d, 1) if d else None


def summarize(rows: list[dict]) -> dict:
    ans = [r for r in rows if r["type"] != "refusal"]
    unans = [r for r in rows if r["type"] == "refusal"]
    delivered = [r for r in rows if r["delivered"]]
    times = sorted(r["elapsed_s"] for r in rows if r.get("elapsed_s") is not None)
    s = {
        "questions": len(rows),
        "numeric_accuracy": pct(sum(r["correct"] for r in ans), len(ans)),
        "tool_choice": pct(sum(r["tool_choice_ok"] for r in rows), len(rows)),
        "correct_refusals": pct(sum(r["correct"] for r in unans), len(unans)),
        "false_refusals": pct(sum(r["false_refusal"] for r in ans), len(ans)),
        "grounded_answers": pct(sum(bool(r["grounded"]) for r in delivered), len(delivered)),
        "median_s": round(statistics.median(times), 2) if times else None,
        "p95_s": round(times[min(len(times) - 1, int(0.95 * len(times)))], 2) if times else None,
    }
    for k in ("input_tokens", "output_tokens"):
        vals = [r[k] for r in rows if k in r]
        s[f"median_{k}"] = statistics.median(vals) if vals else None
    return s


def markdown(model: str, day: str, summary: dict, rows: list[dict]) -> str:
    lines = [f"# Eval results: {model}, {day}", "",
             "| Score | Value |", "|---|---|"]
    labels = {
        "questions": "Questions", "numeric_accuracy": "Numeric accuracy (%)",
        "tool_choice": "Tool choice (%)", "correct_refusals": "Correct refusals (%)",
        "false_refusals": "False refusals (%)", "grounded_answers": "Grounded answers (%)",
        "median_s": "Median time (s)", "p95_s": "p95 time (s)",
        "median_input_tokens": "Median input tokens",
        "median_output_tokens": "Median output tokens",
    }
    for k, label in labels.items():
        v = summary.get(k)
        lines.append(f"| {label} | {'n/a' if v is None else v} |")
    lines += ["", "| id | type | correct | tools ok | refused | grounded |", "|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['id']} | {r['type']} | {r['correct']} | {r['tool_choice_ok']} "
                     f"| {r['refused']} | {'-' if r['grounded'] is None else r['grounded']} |")
    return "\n".join(lines) + "\n"


# ---------- running ----------

def ask(url: str, question: str, timeout: float) -> dict:
    import requests
    headers = {}
    if os.environ.get("EVAL_API_KEY"):
        headers["X-API-Key"] = os.environ["EVAL_API_KEY"]
    try:
        r = requests.post(f"{url.rstrip('/')}/api/agent/ask",
                          json={"question": question}, headers=headers, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as e:  # keep going; the failure is scored as a miss
        return {"answer": "", "tool_calls": [], "error": str(e)}


def load_responses(path: Path) -> dict:
    data = json.loads(path.read_text())
    if isinstance(data, dict) and "rows" in data and "responses" in data:
        return data["responses"]
    return data


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Run and score the agent evals.")
    ap.add_argument("--model", required=True, help="label used in the results file name")
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--from-file", type=Path, help="score saved responses instead of calling the API")
    ap.add_argument("--questions", type=Path, default=QUESTIONS)
    ap.add_argument("--snapshot", type=Path, default=SNAPSHOT)
    ap.add_argument("--out-dir", type=Path, default=RESULTS)
    ap.add_argument("--timeout", type=float, default=120)
    args = ap.parse_args(argv)

    questions = yaml.safe_load(args.questions.read_text())["questions"]
    expected = expected_values(questions, args.snapshot)

    if args.from_file:
        responses = load_responses(args.from_file)
    else:
        responses = {}
        for q in questions:
            responses[q["id"]] = ask(args.url, q["question"], args.timeout)
            print(f"{q['id']}: {responses[q['id']].get('elapsed_s')}s", file=sys.stderr)

    rows = [score_one(q, expected.get(q["id"]), responses.get(q["id"], {})) for q in questions]
    summary = summarize(rows)
    day = date.today().isoformat()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    base = args.out_dir / f"{re.sub(r'[^A-Za-z0-9_.-]', '-', args.model)}_{day}"
    base.with_name(base.name + ".json").write_text(json.dumps(
        {"model": args.model, "date": day, "summary": summary,
         "rows": rows, "responses": responses}, indent=2, default=str))
    md = markdown(args.model, day, summary, rows)
    base.with_name(base.name + ".md").write_text(md)
    print(md)
    print(f"wrote {base}.json and {base}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
