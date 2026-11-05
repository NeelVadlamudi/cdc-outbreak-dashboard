# Architecture boundaries (interview-facing)

Short formal map of what is in scope and what is not. Prefer this over guessing from filenames.

## Data planes

| Plane | Store | Truth |
| --- | --- | --- |
| Core surveillance | DuckDB (`CDC_DB_PATH`) from CDC SODA | ARI, RESP-NET, positivity, NWSS — week-stamped |
| Live host path | Release asset `cdc-data-latest` via `fetch_live_db.py` | `/api/health` → `data_plane: live_release` |
| Eval path | `evals/snapshot.duckdb` (frozen) | Reproducible `cdc-q60-v1` only; never mixed into live scores |
| Supplements | `external_series` + `source_status` | OWID / CDC burden — provenance via `/api/sources`; fail soft |

Supplements do **not** rewrite core SODA tables. Empty supplement series means an adapter failed soft, not that CDC is empty.

## Ask vs retired paths

| Path | Status |
| --- | --- |
| `POST /api/agent/ask` | Grounded tool agent + number checker; rate-limited |
| `POST /api/chat` | **410** — unverified RAG removed |
| `GET /api/events/stream` | **410** — unused unbounded SSE removed |
| `GET /api/weekly-brief` | Rule-based DuckDB aggregates only (no LLM, no forecast models) |

## Frontend ↔ backend

- Pages + Vite app call `VITE_API_URL` (production: Render `/api`).
- Ask response field names live in `frontend/src/agent/contract.ts` only.
- Cold-start: free Render may return HTML splash / 502; the client retries and names the failure.

## Outlook honesty

- Product primary: last-value / persistence.
- LSTM / XGBoost: experimental; free Render image omits PyTorch/XGBoost — API may report `no_model` without inventing forecasts.
