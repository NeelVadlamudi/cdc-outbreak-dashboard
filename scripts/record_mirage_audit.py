"""Record one full Mirage audit through the API and write the site files for it.

Steps, all through the FastAPI app:
1. POST /api/mirage/ask with an audit question that asks for a proposal.
2. POST /api/proposals/{id}/approve as a named person, with X-API-Key.
3. GET /api/mirage/audit-log for that proposal.
4. A second question leaves a proposal waiting, so the review queue shows both states.

Writes site/data/mirage_audit.json (the recording) and site/data/mirage_proposals.json (the queue and audit log).
Uses a throwaway proposals database and a throwaway ADMIN_API_KEY generated for the run, which is never printed.
"""

import argparse
import json
import os
import secrets
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

QUESTION = "Why is Paper Towels 12pk empty at Everett on 2026-09-22? Propose the next step for approval."
SECOND = "Potato Salad Tub is empty at Dedham on 2026-09-22. Find the cause and queue the next step for a manager to approve."


def now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--decided-by", default="Demo reviewer", help="name written to the audit log")
    ap.add_argument("--note", default="Recount requested before the next truck.")
    ap.add_argument("--site-dir", type=Path, default=ROOT / "site" / "data")
    args = ap.parse_args()

    os.environ["MIRAGE_STATE_DB"] = os.path.join(tempfile.mkdtemp(prefix="mirage-rec-"), "state.duckdb")
    key = secrets.token_urlsafe(24)
    from backend import config

    config.ADMIN_API_KEY = key
    from fastapi.testclient import TestClient

    import backend.main as main_mod

    main_mod.INGEST_ON_STARTUP = False
    with TestClient(main_mod.app) as client:
        ask = client.post("/api/mirage/ask", json={"question": QUESTION})
        ask.raise_for_status()
        response = ask.json()
        if not response.get("proposals"):
            sys.exit("The answer made no proposal; nothing to approve. Not writing the recording.")
        pid = response["proposals"][0]["proposal_id"]
        waiting = client.get("/api/mirage/proposals", params={"status": "waiting for approval"}).json()
        decision_body = {"decided_by": args.decided_by, "note": args.note}
        unauth = client.post(f"/api/proposals/{pid}/approve", json=decision_body)
        decided = client.post(f"/api/proposals/{pid}/approve", json=decision_body, headers={"X-API-Key": key})
        decided.raise_for_status()
        again = client.post(f"/api/proposals/{pid}/reject", json=decision_body, headers={"X-API-Key": key})
        log = client.get("/api/mirage/audit-log", params={"proposal_id": pid}).json()
        second = client.post("/api/mirage/ask", json={"question": SECOND}).json()
        proposals = client.get("/api/mirage/proposals").json()["proposals"]
        audit = client.get("/api/mirage/audit-log").json()["audit_log"]

    stamp = now_z()
    recording = {
        "recorded_at": stamp,
        "steps": [
            {"step": "ask", "request": {"method": "POST", "path": "/api/mirage/ask", "body": {"question": QUESTION}},
             "response": response},
            {"step": "queue", "request": {"method": "GET", "path": "/api/mirage/proposals?status=waiting for approval"},
             "response": waiting},
            {"step": "approve_without_key", "request": {"method": "POST", "path": f"/api/proposals/{pid}/approve",
                                                        "body": decision_body},
             "status_code": unauth.status_code, "response": unauth.json()},
            {"step": "approve", "request": {"method": "POST", "path": f"/api/proposals/{pid}/approve",
                                            "body": decision_body, "headers": {"X-API-Key": "<ADMIN_API_KEY>"}},
             "status_code": decided.status_code, "response": decided.json()},
            {"step": "decide_again", "request": {"method": "POST", "path": f"/api/proposals/{pid}/reject",
                                                 "body": decision_body, "headers": {"X-API-Key": "<ADMIN_API_KEY>"}},
             "status_code": again.status_code, "response": again.json()},
            {"step": "audit_log", "request": {"method": "GET", "path": f"/api/mirage/audit-log?proposal_id={pid}"},
             "response": log},
        ],
    }
    (args.site_dir / "mirage_audit.json").write_text(json.dumps(recording, indent=1, default=str) + "\n")
    queue = {"generated_at": stamp, "proposals": proposals, "audit_log": audit,
             "source": "Recorded by scripts/record_mirage_audit.py; proposals from two real answers.",
             "second_answer": {"question": SECOND, "status": second.get("status"), "answer": second.get("answer")}}
    (args.site_dir / "mirage_proposals.json").write_text(json.dumps(queue, indent=1, default=str) + "\n")
    from publish_eval import ensure_index

    for name in ("mirage_audit", "mirage_proposals"):
        ensure_index(args.site_dir, name)
    print(json.dumps({"proposal": pid, "approve_without_key": unauth.status_code, "approve": decided.status_code,
                      "decide_again": again.status_code, "proposals": len(proposals), "audit_rows": len(audit)}))


if __name__ == "__main__":
    main()
