"""Rate limits on the model endpoints, the proposal cap, and the docs flag."""

import importlib

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend import ratelimit
from backend.ratelimit import Limiter, client_ip, limited


def test_per_minute_then_window_slides():
    lim = Limiter()
    assert [lim.hit("b", "1.1.1.1", 2, 100, 100, now=1000 + i)[0] for i in range(3)] == [True, True, False]
    ok, retry, reason = lim.hit("b", "1.1.1.1", 2, 100, 100, now=1003)
    assert (ok, reason) == (False, "minute") and 1 <= retry <= 60
    assert lim.hit("b", "2.2.2.2", 2, 100, 100, now=1003)[0], "other addresses are not affected"
    assert lim.hit("b", "1.1.1.1", 2, 100, 100, now=1061)[0], "allowed again after a minute"


def test_per_day_and_global_caps():
    lim = Limiter()
    assert [lim.hit("b", "a", 0, 2, 0, now=10 + 100 * i)[0] for i in range(3)] == [True, True, False]
    lim = Limiter()
    assert [lim.hit("b", f"ip{i}", 0, 0, 3, now=10 + i)[0] for i in range(4)] == [True, True, True, False]
    assert lim.hit("b", "ip9", 0, 0, 3, now=10 + 86400)[0], "global cap resets the next UTC day"


def test_rejected_calls_do_not_count():
    lim = Limiter()
    for i in range(5):
        lim.hit("b", "a", 1, 100, 100, now=100 + i)
    assert lim.hit("b", "a", 1, 100, 100, now=161)[0]


def _app(monkeypatch, limits):
    monkeypatch.setitem(ratelimit.LIMITS, "t", limits)
    app = FastAPI()

    @app.post("/x", dependencies=[Depends(limited("t"))])
    def x():
        return {"ok": True}
    return TestClient(app)


def test_clean_429_with_retry_after(monkeypatch):
    c = _app(monkeypatch, (2, 100, 100))
    h = {"CF-Connecting-IP": "203.0.113.5"}
    assert [c.post("/x", headers=h).status_code for _ in range(3)] == [200, 200, 429]
    r = c.post("/x", headers=h)
    assert r.headers["content-type"].startswith("application/json")
    assert r.json()["detail"].startswith("Too many requests from this address. Try again in ")
    assert int(r.headers["Retry-After"]) >= 1
    assert c.post("/x", headers={"CF-Connecting-IP": "203.0.113.6"}).status_code == 200


def test_client_ip_prefers_cloudflare_header():
    class R:
        def __init__(self, h, host="10.0.0.1"):
            self.headers = h
            self.client = type("C", (), {"host": host})()
    assert client_ip(R({"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9"})) == "1.2.3.4"
    assert client_ip(R({"x-forwarded-for": "6.6.6.6, 5.5.5.5"})) == "5.5.5.5"
    assert client_ip(R({})) == "10.0.0.1"


def test_model_routes_are_limited():
    from backend.mirage_routes import router as mirage_router
    from backend.routes import router
    deps = {r.path: [d.call.__qualname__ for d in r.dependant.dependencies]
            for rt in (router, mirage_router) for r in rt.routes if hasattr(r, "dependant")}
    for path in ("/api/agent/ask", "/api/chat", "/api/weekly-brief", "/api/mirage/ask"):
        assert any("limited" in q for q in deps[path]), path


def test_proposal_cap(monkeypatch):
    monkeypatch.setitem(ratelimit.LIMITS, "proposal", (0, 0, 2))
    assert [ratelimit.allow_proposal()[0] for _ in range(3)] == [True, True, False]
    assert ratelimit.allow_proposal()[1] == "The demo has reached its daily limit. Try again tomorrow."


def test_docs_flag(monkeypatch):
    import backend.config as config
    import backend.main as main
    try:
        monkeypatch.setenv("ENABLE_API_DOCS", "false")
        importlib.reload(config)
        importlib.reload(main)
        with TestClient(main.app) as c:
            assert [c.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")] == [404, 404, 404]
            assert c.get("/").json()["docs"] is None
    finally:
        monkeypatch.setenv("ENABLE_API_DOCS", "true")
        importlib.reload(config)
        importlib.reload(main)
    assert main.app.openapi_url == "/openapi.json"
