"""Render free-tier deployment: health check, CORS from the Pages origin, and the API without torch or xgboost."""

import importlib
import sys

from fastapi.testclient import TestClient

PAGES = "https://neelvadlamudi.github.io"


def test_health(fixture_db):
    from backend.main import app

    body = TestClient(app).get("/api/health").json()
    assert body["status"] == "ok" and body["latest_week"] == "2026-10-10"


def test_cors_allows_pages_origin_only(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", PAGES)
    import backend.config
    import backend.main

    importlib.reload(backend.config)
    main = importlib.reload(backend.main)
    try:
        client = TestClient(main.app)
        pre = client.options("/api/agent/ask", headers={"Origin": PAGES, "Access-Control-Request-Method": "POST",
                                                        "Access-Control-Request-Headers": "content-type"})
        assert pre.status_code == 200
        assert pre.headers["access-control-allow-origin"] == PAGES
        other = client.options("/api/agent/ask", headers={"Origin": "https://example.com",
                                                          "Access-Control-Request-Method": "POST"})
        assert other.headers.get("access-control-allow-origin") is None
    finally:
        monkeypatch.delenv("ALLOWED_ORIGINS")
        importlib.reload(backend.config)
        importlib.reload(backend.main)


def test_forecasts_without_torch_or_xgboost(monkeypatch):
    """With the heavy packages missing, the modules import and forecasts return no_model."""
    for name in ("torch", "torch.nn", "xgboost"):
        monkeypatch.setitem(sys.modules, name, None)  # makes `import name` raise ImportError
    import backend.ensemble
    import backend.forecasting

    fc = importlib.reload(backend.forecasting)
    en = importlib.reload(backend.ensemble)
    try:
        assert fc.torch is None and en.xgb is None
        assert fc.generate_forecast("COVID-NET")["status"] == "no_model"
        assert fc.train_model("COVID-NET")["status"] == "no_model"
        assert en.xgb_forecast("COVID-NET")["status"] == "no_model"
        assert en.train_xgboost("COVID-NET")["status"] == "no_model"
    finally:
        monkeypatch.undo()
        importlib.reload(backend.forecasting)
        importlib.reload(backend.ensemble)


def test_render_requirements_leave_out_heavy_packages():
    from pathlib import Path

    names = {line.split(">")[0].split("=")[0].strip().lower()
             for line in (Path(__file__).resolve().parent.parent / "requirements-render.txt").read_text().splitlines()
             if line.strip() and not line.startswith("#")}
    assert not names & {"torch", "xgboost", "ollama", "langchain-ollama", "pytest", "ruff", "scikit-learn"}
    assert {"fastapi", "uvicorn", "duckdb", "langgraph", "langchain-google-genai"} <= names
