# Multi-source data plane

CDC SODA feeds remain the **core** surveillance store (ARI activity, RESP-NET
hospitalizations, test positivity, NWSS wastewater). Supplemental adapters enrich
Overview with citable national / peer-country context and never invent numbers.

## Registered sources

| `source_id` | Role | License | What it adds |
| --- | --- | --- | --- |
| `cdc_soda` | core | U.S. government / public domain | Existing DuckDB tables |
| `owid_weekly_covid_deaths` | supplement | CC BY 4.0 (Our World in Data) | Latest weekly COVID-19 deaths for USA + peers |
| `cdc_covid_burden` | supplement | U.S. government / public domain | Preliminary U.S. COVID hospitalization/death ranges (`ahrf-yqdt`) |

API:

- `GET /api/sources` — registry metadata + `external_series` rows (`source_id`, `as_of`, `retrieved_at`, citation)
- `GET /api/dashboard-summary` → `sources` chips + compact context for Overview

## Adding an adapter (collaborative OSS)

1. Create `backend/sources/<name>.py` with a pure `normalize_*` / `parse_*` function (unit-testable offline) and a `refresh_*()` that fetches, normalizes, then calls `replace_external_series` + `upsert_source_status`.
2. Register a `SourceSpec` in `backend/sources/registry.py` (`SOURCE_REGISTRY`).
3. Fail soft: on network/parse failure, set `status=unavailable` and leave prior series intact when the fetch returns empty.
4. Document license + homepage in the spec; surface both in UI chips.
5. Add a parse/normalize test under `tests/test_sources.py` (no live network).

Supplements refresh on API startup and every ~180 minutes when `INGEST_ON_STARTUP` is true.
