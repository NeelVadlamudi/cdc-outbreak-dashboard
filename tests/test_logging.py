"""JSON log lines carry the request id and extra fields."""

import json
import logging

from backend.config import JsonFormatter, request_id_var


def test_json_formatter_includes_request_id_and_extras():
    rec = logging.LogRecord("backend.agent.graph", logging.INFO, __file__, 1, "tool call", None, None)
    rec.event = "tool_call"
    rec.tool = "get_test_positivity"
    rec.elapsed_s = 0.01
    token = request_id_var.set("abc123")
    try:
        line = JsonFormatter().format(rec)
    finally:
        request_id_var.reset(token)
    out = json.loads(line)
    assert out["msg"] == "tool call"
    assert out["request_id"] == "abc123"
    assert out["event"] == "tool_call" and out["tool"] == "get_test_positivity"
    assert out["level"] == "INFO" and out["ts"].endswith("Z")


def test_request_id_header_round_trip(fixture_db, monkeypatch):
    from fastapi.testclient import TestClient

    import backend.main as main
    from backend.main import app

    monkeypatch.setattr(main, "INGEST_ON_STARTUP", False)
    with TestClient(app) as client:
        r = client.get("/", headers={"X-Request-ID": "req-1"})
    assert r.headers["X-Request-ID"] == "req-1"
