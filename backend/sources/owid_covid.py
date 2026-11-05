"""Our World in Data weekly COVID-19 deaths — peer-country context (CC BY 4.0)."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.sources.registry import replace_external_series, upsert_source_status

logger = logging.getLogger(__name__)

SOURCE_ID = "owid_weekly_covid_deaths"
TITLE = "Our World in Data — weekly COVID-19 deaths"
LICENSE = "CC BY 4.0 (Our World in Data)"
HOMEPAGE = "https://ourworldindata.org/coronavirus"
CITATION = "Our World in Data, weekly COVID-19 deaths (grapher export)."
# Filtered peer set keeps the download small and demo-friendly.
OWID_URL = (
    "https://ourworldindata.org/grapher/weekly-covid-deaths.csv"
    "?tab=chart&country=USA~GBR~CAN~DEU~FRA~JPN&csvType=filtered&useColumnShortNames=true"
)
PEERS = {
    "United States",
    "United Kingdom",
    "Canada",
    "Germany",
    "France",
    "Japan",
}
USER_AGENT = (
    "cdc-outbreak-dashboard/1.0 (+https://github.com/NeelVadlamudi/cdc-outbreak-dashboard; research)"
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_owid_weekly_deaths_csv(text: str, *, retrieved_at: str | None = None) -> list[dict[str, Any]]:
    """Keep the latest non-empty weekly_deaths row per peer entity. Fail closed on junk."""
    retrieved_at = retrieved_at or _utc_now()
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    # Grapher short names: entity, code, day, weekly_deaths
    latest: dict[str, dict[str, Any]] = {}
    for row in reader:
        entity = (row.get("entity") or row.get("Entity") or "").strip()
        if entity not in PEERS:
            continue
        day = (row.get("day") or row.get("Day") or row.get("date") or "").strip()[:10]
        raw = row.get("weekly_deaths") or row.get("Weekly deaths") or row.get("weekly_covid_deaths")
        if not day or raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value != value:  # NaN
            continue
        prev = latest.get(entity)
        if prev is None or day >= prev["as_of"]:
            latest[entity] = {
                "source_id": SOURCE_ID,
                "series_id": "weekly_deaths",
                "geography": entity,
                "as_of": day,
                "value": value,
                "value_high": None,
                "unit": "deaths / week",
                "label": f"Weekly COVID-19 deaths · {entity}",
                "retrieved_at": retrieved_at,
                "citation": CITATION,
            }
    return list(latest.values())


def fetch_owid_csv(url: str = OWID_URL, *, timeout: float = 45.0) -> str:
    with httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        res = client.get(url)
        res.raise_for_status()
        return res.text


def refresh_owid_weekly_deaths() -> dict[str, Any]:
    retrieved = _utc_now()
    try:
        text = fetch_owid_csv()
        rows = parse_owid_weekly_deaths_csv(text, retrieved_at=retrieved)
    except Exception as e:
        detail = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
        logger.warning("OWID refresh failed: %s", detail)
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
            detail="CSV parsed but no peer rows",
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
        detail=f"{n} peer geographies",
        retrieved_at=retrieved,
    )
    return {"source_id": SOURCE_ID, "status": "ok", "as_of": as_of, "rows": n}
