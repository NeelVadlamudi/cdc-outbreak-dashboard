"""Checks that every number in an answer appears in the tool results."""

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


def _collect(value, out: set):
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        out.add(float(value))
    elif isinstance(value, str):
        for d in _DATE.findall(value):
            out.update(float(p) for p in d.split("-"))
        for n in _numbers_in_text(value):
            out.add(float(n))
    elif isinstance(value, dict):
        for v in value.values():
            _collect(v, out)
    elif isinstance(value, list):
        out.add(float(len(value)))
        for v in value:
            _collect(v, out)


def _decimals(token: str) -> int:
    return len(token.split(".")[1]) if "." in token else 0


def check_numbers(answer: str, tool_outputs: list, question: str = "") -> dict:
    """Return {passed, unverified}. A number passes if a tool value rounds to it."""
    known: set = set()
    for output in tool_outputs:
        _collect(output, known)
    _collect(question, known)
    unverified = []
    for token in _numbers_in_text(answer):
        value = float(token)
        places = _decimals(token)
        if not any(round(k, places) == value for k in known):
            unverified.append(token)
    return {"passed": not unverified, "unverified": unverified}


def queue_for_review(record: dict) -> None:
    os.makedirs(os.path.dirname(REVIEW_QUEUE), exist_ok=True)
    record = {"queued_at": datetime.now(timezone.utc).isoformat(), **record}
    with open(REVIEW_QUEUE, "a") as f:
        f.write(json.dumps(record, default=str) + "\n")
