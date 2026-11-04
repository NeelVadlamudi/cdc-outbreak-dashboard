from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from backend.agent import checker, graph


class FakeToolModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def _client(monkeypatch, tmp_path, messages):
    model = FakeToolModel(messages=iter(messages))
    monkeypatch.setattr(graph, "get_chat_model", lambda setting=None: model)
    monkeypatch.setattr(graph, "model_label", lambda setting=None: "fake")
    monkeypatch.setattr(checker, "REVIEW_QUEUE", str(tmp_path / "queue.jsonl"))
    from backend.main import app
    from backend.routes import router  # noqa: F401

    return TestClient(app)  # no context manager: skips startup ingestion


def test_agent_ask_contract(fixture_db, monkeypatch, tmp_path):
    from backend import config

    # Fixture weeks are fixed (2026-10-10); keep them "fresh" so this asserts the happy path.
    monkeypatch.setattr(config, "STALE_AFTER_DAYS", 10_000)
    messages = [
        AIMessage(content="", tool_calls=[{"name": "get_test_positivity", "args": {"pathogen": "COVID-19"}, "id": "c1"}]),
        AIMessage(content="For the week ending 2026-10-10, COVID-19 test positivity was 3.6%."),
    ]
    res = _client(monkeypatch, tmp_path, messages).post("/api/agent/ask", json={"question": "COVID positivity?"})
    assert res.status_code == 200
    body = res.json()
    assert set(body) >= {"status", "answer", "tool_calls", "as_of", "elapsed_s", "model", "checker"}
    assert body["status"] == "answered"
    assert body["as_of"] == "2026-10-10"
    call = body["tool_calls"][0]
    assert call["tool"] == "get_test_positivity"
    assert call["rows_returned"] == 1
    assert set(call) >= {"tool", "inputs", "rows_returned", "elapsed_s", "output"}
    assert body["checker"] == {"passed": True, "unverified": [], "stale_tables": []}


def test_agent_ask_unverified(fixture_db, monkeypatch, tmp_path):
    messages = [
        AIMessage(content="", tool_calls=[{"name": "get_test_positivity", "args": {}, "id": "c1"}]),
        AIMessage(content="Positivity was 9.9%."),
    ]
    body = _client(monkeypatch, tmp_path, messages).post("/api/agent/ask", json={"question": "x"}).json()
    assert body["status"] == "unverified"
    assert body["answer"] == checker.UNVERIFIED_MESSAGE
    assert (tmp_path / "queue.jsonl").exists()


def test_agent_ask_stale_is_refused(fixture_db, monkeypatch, tmp_path):
    messages = [
        AIMessage(content="", tool_calls=[{"name": "get_wastewater", "args": {"state": "Ohio"}, "id": "c1"}]),
        AIMessage(content="Ohio had 2 wastewater sites reporting RSV for the week ending 2025-09-06."),
    ]
    body = _client(monkeypatch, tmp_path, messages).post("/api/agent/ask", json={"question": "Ohio wastewater?"}).json()
    assert body["status"] == "refused"
    assert body["checker"]["stale_tables"] == ["wastewater_sites"]
    # Stale warning must not inject an unverified day-count (e.g. "14") that fails grounding.
    assert body["checker"]["passed"] is True
    assert "out of date" in body["answer"]
    assert "14 days" not in body["answer"]


def test_agent_ask_fallback_is_unverified(fixture_db, monkeypatch, tmp_path):
    """When the agent crashes, do not pretend a rule-based answer is checker-verified."""
    monkeypatch.setattr(graph, "run_agent", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    from backend.main import app

    body = TestClient(app).post("/api/agent/ask", json={"question": "COVID positivity?"}).json()
    assert body["status"] == "unverified"
    assert body["checker"]["passed"] is False
    assert body["model"] == "unavailable"
    assert body["tool_calls"] == []
