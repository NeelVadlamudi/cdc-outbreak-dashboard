"""CDC preliminary U.S. COVID-19 burden estimates (data.cdc.gov ahrf-yqdt)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.sources.registry import replace_external_series, upsert_source_status

logger = logging.getLogger(__name__)

SOURCE_ID = "cdc_covid_burden"
TITLE = "CDC preliminary U.S. COVID-19 burden estimates"
LICENSE = "U.S. Government work / public domain"
HOMEPAGE = "https://data.cdc.gov/dataset/Preliminary-U-S-COVID-19-Burden-Estimates/ahrf-yqdt"
CITATION = "CDC, Preliminary U.S. COVID-19 Burden Estimates (data.cdc.gov ahrf-yqdt)."
SODA_URL = "https://data.cdc.gov/resource/ahrf-yqdt.json"
USER_AGENT = (
    "cdc-outbreak-dashboard/1.0 (+https://github.com/NeelVadlamudi/cdc-outbreak-dashboard; research)"
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:
        return None
    return x


def normalize_burden_rows(records: list[dict], *, retrieved_at: str | None = None) -> list[dict[str, Any]]:
    """Keep the latest date per burden type (Hospitalizations / Deaths). Ranges only — no inventing."""
    retrieved_at = retrieved_at or _utc_now()
    latest: dict[str, dict[str, Any]] = {}
    for rec in records or []:
        burden = (rec.get("burden") or "").strip()
        if burden not in ("Hospitalizations", "Deaths"):
            continue
        date_raw = (rec.get("date") or "")[:10]
        if not date_raw:
            continue
        low = _num(rec.get("low"))
        high = _num(rec.get("high"))
        if low is None and high is None:
            continue
        season = (rec.get("season") or "").strip()
        prev = latest.get(burden)
        if prev is None or date_raw >= prev["as_of"]:
            latest[burden] = {
                "source_id": SOURCE_ID,
                "series_id": f"burden_{burden.lower()}",
                "geography": "United States",
                "as_of": date_raw,
                "value": low,
                "value_high": high,
                "unit": "estimated cumulative range (season)",
                "label": f"Preliminary COVID-19 {burden.lower()} · {season or 'season'}",
                "retrieved_at": retrieved_at,
                "citation": CITATION,
            }
    return list(latest.values())


def fetch_burden(limit: int = 5000, *, timeout: float = 45.0) -> list[dict]:
    with httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        res = client.get(SODA_URL, params={"$limit": limit, "$order": "date DESC"})
        res.raise_for_status()
        data = res.json()
        if not isinstance(data, list):
            raise ValueError("unexpected SODA payload")
        return data


def refresh_covid_burden() -> dict[str, Any]:
    retrieved = _utc_now()
    try:
        records = fetch_burden()
        rows = normalize_burden_rows(records, retrieved_at=retrieved)
    except Exception as e:
        detail = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
        logger.warning("CDC burden refresh failed: %s", detail)
        upsert_source_status(
            source_id=SOURCE_ID,
            title=TITLE,
            license=LICENSE,
            homepage=HOMEPAGE,
            citation=CITATION,
            status="unavailable",
            detail=detail,
            retrieved_at=retrieved,
        )
        return {"source_id": SOURCE_ID, "status": "unavailable", "detail": detail, "rows": 0}

    if not rows:
        upsert_source_status(
            source_id=SOURCE_ID,
            title=TITLE,
            license=LICENSE,
            homepage=HOMEPAGE,
            citation=CITATION,
            status="unavailable",
            detail="No Hospitalizations/Deaths rows",
            retrieved_at=retrieved,
        )
        return {"source_id": SOURCE_ID, "status": "unavailable", "detail": "empty", "rows": 0}

    n = replace_external_series(SOURCE_ID, rows)
    as_of = max(r["as_of"] for r in rows)
    upsert_source_status(
        source_id=SOURCE_ID,
        title=TITLE,
        license=LICENSE,
        homepage=HOMEPAGE,
        citation=CITATION,
        status="ok",
        as_of=as_of,
        detail=f"{n} burden series",
        retrieved_at=retrieved,
    )
    return {"source_id": SOURCE_ID, "status": "ok", "as_of": as_of, "rows": n}
