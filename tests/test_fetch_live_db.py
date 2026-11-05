"""Unit tests for scripts/fetch_live_db URL resolution."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "fetch_live_db",
    ROOT / "scripts" / "fetch_live_db.py",
)
assert SPEC and SPEC.loader
fetch_live_db = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch_live_db)


def test_resolve_url_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CDC_DB_URL", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    assert fetch_live_db.resolve_url("https://example.com/db.duckdb") == "https://example.com/db.duckdb"


def test_resolve_url_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CDC_DB_URL", "https://example.com/from-env.duckdb")
    monkeypatch.delenv("RENDER", raising=False)
    assert fetch_live_db.resolve_url(None) == "https://example.com/from-env.duckdb"


def test_resolve_url_render_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CDC_DB_URL", raising=False)
    monkeypatch.setenv("RENDER", "true")
    assert fetch_live_db.resolve_url(None) == fetch_live_db.DEFAULT_RELEASE_URL


def test_resolve_url_local_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CDC_DB_URL", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    assert fetch_live_db.resolve_url(None) == ""
