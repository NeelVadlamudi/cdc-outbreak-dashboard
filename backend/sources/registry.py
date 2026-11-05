"""Source registry: metadata + refresh orchestration for supplemental adapters."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from backend.database import execute, query

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SourceSpec:
    source_id: str
    title: str
    role: str  # core | supplement
    license: str
    homepage: str
    citation: str
    refresh: Callable[[], dict[str, Any]] | None = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def upsert_source_status(
    *,
    source_id: str,
    title: str,
    license: str,
    homepage: str,
    citation: str,
    status: str,
    as_of: str | None = None,
    detail: str | None = None,
    retrieved_at: str | None = None,
) -> None:
    execute(
        """
        INSERT OR REPLACE INTO source_status
          (source_id, title, license, homepage, citation, status, as_of, retrieved_at, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            source_id,
            title,
            license,
            homepage,
            citation,
            status,
            as_of,
            retrieved_at or _utc_now(),
            detail,
        ],
    )


def replace_external_series(source_id: str, rows: list[dict[str, Any]]) -> int:
    """Replace all rows for a source_id. Empty rows leave the prior series intact."""
    if not rows:
        return 0
    execute("DELETE FROM external_series WHERE source_id = ?", [source_id])
    for r in rows:
        execute(
            """
            INSERT INTO external_series
              (source_id, series_id, geography, as_of, value, value_high, unit, label, retrieved_at, citation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                source_id,
                r["series_id"],
                r.get("geography") or "United States",
                r["as_of"],
                r.get("value"),
                r.get("value_high"),
                r.get("unit"),
                r.get("label"),
                r.get("retrieved_at") or _utc_now(),
                r.get("citation"),
            ],
        )
    return len(rows)


def _cdc_soda_status() -> dict[str, Any]:
    """Core plane — already ingested elsewhere; surface provenance only."""
    from backend.agent.tools import get_data_freshness

    fresh = get_data_freshness()
    as_of = fresh.get("as_of")
    upsert_source_status(
        source_id="cdc_soda",
        title="CDC open data (SODA)",
        license="U.S. Government work / public domain",
        homepage="https://data.cdc.gov",
        citation="Centers for Disease Control and Prevention, data.cdc.gov SODA feeds (ARI, RESP-NET, positivity, NWSS).",
        status="ok" if as_of else "unavailable",
        as_of=as_of,
        detail="Core surveillance tables in DuckDB",
    )
    return {"source_id": "cdc_soda", "status": "ok" if as_of else "unavailable", "as_of": as_of, "rows": 0}


def _refresh_owid() -> dict[str, Any]:
    from backend.sources.owid_covid import refresh_owid_weekly_deaths

    return refresh_owid_weekly_deaths()


def _refresh_burden() -> dict[str, Any]:
    from backend.sources.cdc_burden import refresh_covid_burden

    return refresh_covid_burden()


SOURCE_REGISTRY: dict[str, SourceSpec] = {
    "cdc_soda": SourceSpec(
        source_id="cdc_soda",
        title="CDC open data (SODA)",
        role="core",
        license="U.S. Government work / public domain",
        homepage="https://data.cdc.gov",
        citation="CDC SODA: ARI activity, RESP-NET, test positivity, NWSS wastewater.",
        refresh=_cdc_soda_status,
    ),
    "owid_weekly_covid_deaths": SourceSpec(
        source_id="owid_weekly_covid_deaths",
        title="Our World in Data — weekly COVID-19 deaths",
        role="supplement",
        license="CC BY 4.0 (Our World in Data)",
        homepage="https://ourworldindata.org/coronavirus",
        citation="Our World in Data, weekly COVID-19 deaths (grapher export).",
        refresh=_refresh_owid,
    ),
    "cdc_covid_burden": SourceSpec(
        source_id="cdc_covid_burden",
        title="CDC preliminary U.S. COVID-19 burden estimates",
        role="supplement",
        license="U.S. Government work / public domain",
        homepage="https://data.cdc.gov/dataset/Preliminary-U-S-COVID-19-Burden-Estimates/ahrf-yqdt",
        citation="CDC, Preliminary U.S. COVID-19 Burden Estimates (data.cdc.gov ahrf-yqdt).",
        refresh=_refresh_burden,
    ),
}


def refresh_source(source_id: str) -> dict[str, Any]:
    spec = SOURCE_REGISTRY.get(source_id)
    if not spec or not spec.refresh:
        return {"source_id": source_id, "status": "unknown", "detail": "not registered"}
    try:
        return spec.refresh()
    except Exception as e:
        detail = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
        logger.exception("supplement refresh failed for %s", source_id)
        upsert_source_status(
            source_id=spec.source_id,
            title=spec.title,
            license=spec.license,
            homepage=spec.homepage,
            citation=spec.citation,
            status="unavailable",
            detail=detail,
        )
        return {"source_id": source_id, "status": "unavailable", "detail": detail, "rows": 0}


def refresh_all_supplements() -> list[dict[str, Any]]:
    """Refresh core provenance + every supplement. Never raises."""
    out = []
    for sid in SOURCE_REGISTRY:
        out.append(refresh_source(sid))
    return out


def list_sources() -> dict[str, Any]:
    """API payload: registry metadata merged with last refresh status from DuckDB."""
    try:
        statuses = {r["source_id"]: r for r in query("SELECT * FROM source_status")}
    except Exception:
        statuses = {}
    try:
        series = query(
            """
            SELECT source_id, series_id, geography, as_of, value, value_high, unit, label, citation, retrieved_at
            FROM external_series
            ORDER BY source_id, geography, series_id
            """
        )
    except Exception:
        series = []

    sources = []
    for sid, spec in SOURCE_REGISTRY.items():
        st = statuses.get(sid) or {}
        sources.append(
            {
                **{k: v for k, v in asdict(spec).items() if k != "refresh"},
                "status": st.get("status") or "unknown",
                "as_of": st.get("as_of"),
                "retrieved_at": st.get("retrieved_at"),
                "detail": st.get("detail"),
            }
        )
    return {
        "sources": sources,
        "series": series,
        "note": (
            "CDC SODA is the core plane. Supplements add national burden ranges and "
            "peer-country weekly death context. Empty series means the adapter failed soft."
        ),
    }


def latest_context_for_overview() -> dict[str, Any]:
    """Compact provenance chips for Overview / briefing enrichment."""
    payload = list_sources()
    chips = []
    for s in payload["sources"]:
        chips.append(
            {
                "source_id": s["source_id"],
                "title": s["title"],
                "role": s["role"],
                "status": s["status"],
                "as_of": s.get("as_of"),
                "license": s["license"],
                "homepage": s["homepage"],
            }
        )
    # Latest OWID US + peers
    peers = [
        r
        for r in payload["series"]
        if r.get("source_id") == "owid_weekly_covid_deaths" and r.get("series_id") == "weekly_deaths"
    ]
    burden = [
        r for r in payload["series"] if r.get("source_id") == "cdc_covid_burden"
    ]
    return {
        "chips": chips,
        "owid_weekly_deaths": peers,
        "cdc_burden": burden,
        "retrieved_note": payload.get("note"),
    }
