# CDC Outbreak Dashboard

Public respiratory surveillance with a visible path from each answer back to its data.

[Live site](https://neelvadlamudi.github.io/cdc-outbreak-dashboard/) · [Data sources](docs/DATA_SOURCES.md) · [Portfolio](https://neelvadlamudi.github.io/neelresume/)

## What is published

The dashboard brings together public COVID-19, influenza and RSV surveillance tables. A tool-calling assistant can answer questions from those tables and show its source weeks and tool results. The project is for research, education and situational awareness—not clinical decisions or official CDC guidance.

The site checked on **November 9, 2026** reported current surveillance tables through **October 31, 2026**. A recent pipeline run and a recent observation are different things: the former says the refresh ran; the latter says how current the source records are. Check the published [run status](https://neelvadlamudi.github.io/cdc-outbreak-dashboard/data/status.json), [dashboard payload](https://neelvadlamudi.github.io/cdc-outbreak-dashboard/data/dashboard.json) and API health response separately.

The main outlook is **last-week persistence**. The published [backtests](https://neelvadlamudi.github.io/cdc-outbreak-dashboard/data/backtest.json) report that the experimental LSTM and XGBoost models did not beat it on the evaluated series. The product keeps the baseline in front rather than presenting a more complicated model as an improvement by default.

## Data and serving path

CDC open data → ingestion and cleaning → DuckDB → FastAPI → React dashboard and checked tool answers.

The ingestion layer handles surveillance tables independently so one source failure need not discard the others. Supplementary sources carry their own provenance. The API serves query results; model training is not part of a forecast read request.

The charts and tables are static files on Pages, refreshed each night, so they load without the API. Only Ask a question and the surge simulator call a separate API service, which can take up to a minute to wake on free hosting.

## Answer checking is measured, not assumed

`POST /api/agent/ask` uses defined tools and a number checker. The checker compares numerical claims with returned values. Refusals and unverified responses are part of the contract; passing that check is not proof that every interpretation is correct.

The frozen **60-question** evaluation uses `evals/snapshot.duckdb`. It is separate from the live surveillance database so results can be compared on the same inputs. A historical evaluation score should always name its run, model and data snapshot. This README does not present an old score as current performance.

The [grounding gate](scripts/check_grounding_gate.py) can compare a supplied evaluation artifact with the baseline. It skips when no artifact is supplied, so ordinary green CI alone does not establish current answer quality. See the [evaluation card](evals/HF_CARD.md) and [system boundaries](docs/BOUNDARIES.md).

## Live data and evaluation data stay separate

| Artifact | Purpose |
| --- | --- |
| `cdc-data-latest` release, `cdc_surveillance.duckdb` asset | Refreshed database for the API. |
| `evals/snapshot.duckdb` | Fixed evaluation input; do not replace it with the latest pull. |
| `site/data/` | Static dashboard metrics, run status, backtests and evaluation summaries. |

The startup fetch can fall back to the frozen snapshot if it cannot download the release. Inspect `/api/health` for `data_plane`, `as_of` and per-table freshness; do not call a fallback snapshot a current feed.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Configure local settings before starting the API.
uvicorn backend.main:app --reload
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

The assistant supports a local Ollama setup or an optional hosted model. Configure the environment as described in `.env.example`; do not put credentials in source files or documentation.

## Test and operate

```bash
make lint
make test
# Requires the configured model and frozen evaluation database.
make eval
```

The [refresh workflow](.github/workflows/nightly.yml) is scheduled twice daily. It refreshes DuckDB, publishes the data release and dashboard artifacts, and runs evaluations and backtests on its full-run path. Workflow configuration is not a guarantee of an on-time start; the published run link is the record of what happened.

The API also has request limits. Temporary storage on the free service means some counters reset on restart. The capacity simulator is illustrative, and anomaly flags are statistical checks rather than diagnoses.

## Limits and license

Surveillance records describe reporting weeks and may be revised. Coverage and publication dates differ by source; no national summary is a substitute for local clinical information. A model that fails to beat persistence remains experimental.

Independent project, not affiliated with the CDC. Code is [MIT licensed](LICENSE); source-data terms are documented separately in [DATA_SOURCES.md](docs/DATA_SOURCES.md).
