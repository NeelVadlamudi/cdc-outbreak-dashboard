"""Checks that every number in an answer appears in the tool results."""

import bisect
import json
import os
import re
from datetime import datetime, timezone

UNVERIFIED_MESSAGE = "I could not verify that figure."
REVIEW_QUEUE = os.getenv(
    "REVIEW_QUEUE_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "evals", "review_queue.jsonl"),
)

_NUMBER = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")
_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")


def _numbers_in_text(text: str) -> list[str]:
    text = _DATE.sub(" ", text)
    return [m.group(0).replace(",", "") for m in _NUMBER.finditer(text)]


def _collect(value, out: set, values: set | None = None):
    """Add every number in value to out. Measured values (not date parts or
    list lengths) also go to values, the base for sums and differences."""
    values = out if values is None else values
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        out.add(float(value))
        values.add(float(value))
    elif isinstance(value, str):
        for d in _DATE.findall(value):
            out.update(float(p) for p in d.split("-"))
        for n in _numbers_in_text(value):
            out.add(float(n))
    elif isinstance(value, dict):
        for v in value.values():
            _collect(v, out, values)
    elif isinstance(value, list):
        out.add(float(len(value)))
        for v in value:
            _collect(v, out, values)


def _decimals(token: str) -> int:
    return len(token.split(".")[1]) if "." in token else 0


def _near(sorted_vals: list, target: float, tol: float) -> bool:
    i = bisect.bisect_left(sorted_vals, target - tol)
    return i < len(sorted_vals) and sorted_vals[i] <= target + tol


def _derived(value: float, vals: list, tol: float) -> bool:
    """True if value (or -value) is the sum or difference of two known numbers."""
    for v in (value, -value):
        for k in vals:
            # v = a - k  ->  a = v + k ;  v = a + k  ->  a = v - k  (a must differ from k)
            for a in (v + k, v - k):
                if abs(a - k) > tol and _near(vals, a, tol):
                    return True
    return False


def check_numbers(answer: str, tool_outputs: list, question: str = "") -> dict:
    """Return {passed, unverified}. A number passes if a tool value rounds to it,
    or if it is the sum or difference of two tool values."""
    known: set = set()
    measured: set = set()
    for output in tool_outputs:
        _collect(output, known, measured)
    _collect(question, known, set())
    vals = sorted(known)
    base = sorted(measured)
    unverified = []
    for token in _numbers_in_text(answer):
        value = float(token)
        places = _decimals(token)
        tol = 0.5 * 10 ** -places + 1e-9
        if _near(vals, value, tol) or _derived(value, base, tol):
            continue
        unverified.append(token)
    return {"passed": not unverified, "unverified": unverified}


def queue_for_review(record: dict) -> None:
    os.makedirs(os.path.dirname(REVIEW_QUEUE), exist_ok=True)
    record = {"queued_at": datetime.now(timezone.utc).isoformat(), **record}
    with open(REVIEW_QUEUE, "a") as f:
        f.write(json.dumps(record, default=str) + "\n")
