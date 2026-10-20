# CDC Outbreak Dashboard

A dashboard for U.S. respiratory virus surveillance data (COVID-19, influenza and RSV). The backend downloads public CDC datasets through the Socrata Open Data API (SODA), stores them in a local DuckDB file and serves them through a FastAPI application. The frontend is a React application built with Vite.

<img src="assets/dashboard_preview.png" alt="Dashboard preview" width="100%" />

## What the code does

- **Data ingestion** (`backend/cdc_ingestion.py`): downloads four public datasets from data.cdc.gov (acute respiratory illness activity by state, RESP-NET hospitalization rates, test positivity, and NWSS wastewater surveillance), cleans them with pandas and loads them into DuckDB. Ingestion runs at startup and then every 60 minutes.
- **Query API** (`backend/routes.py`): read-only endpoints under `/api` for activity levels, hospitalization rates, test positivity, wastewater data, a dashboard summary and a server-sent event stream. SQL queries use bound parameters.
- **LSTM forecast** (`backend/forecasting.py`): a PyTorch LSTM trained on weekly hospitalization rates with lag and rolling-mean features plus the calendar week (sine/cosine), computed the same way in training and at forecast time. Each 12-week input window is scaled by its own mean, and the series is split at gaps in the CDC file (such as the FluSurv-NET break from 2025-05-03 to 2025-10-04) so no sample spans one. It predicts four weeks ahead and reports validation MAE. `GET /api/forecast/{virus}` only reads a saved model and returns `no_model` if none exists; it never trains. The forecast band is the MAE scaled by a factor that grows with the horizon; it is not a statistical interval.
- **XGBoost forecast** (`backend/ensemble.py`): a gradient-boosted model on lag features. Like the LSTM, it never trains on a GET request.
- **Backtest result:** in the latest rolling-origin backtest (`evals/results/backtest.json`), neither model beats simply repeating last week's value, except XGBoost on RSV-NET one week ahead. `get_forecast` and the published site both say this next to each forecast. `/api/ensemble/compare/{virus}` returns the LSTM and XGBoost forecasts side by side. The same module flags anomalies with an Isolation Forest and builds age-group and season comparison data.
- **Question-answering agent** (`backend/agent/`): `POST /api/agent/ask` answers a question with a LangGraph loop that calls seven read-only data tools (`backend/agent/tools.py`), at most six calls per question. The tools check inputs against values found in the data and return JSON with `as_of`, `rows` and `source_table`. The model is Gemini Flash-Lite or a local Ollama model, chosen with `AGENT_MODEL`. The system prompt is in `backend/agent/prompts/system_v1.md`. Every number in an answer must appear in a tool result; otherwise the answer is replaced with "I could not verify that figure" and logged to `evals/review_queue.jsonl`. Answers that rely on tables older than 14 days carry a warning. The response includes a `status` of `answered`, `refused` or `unverified`. If no model is reachable, the older rule-based chat answers instead.
- **MCP server** (`backend/mcp_server.py`): serves the same seven tools over the Model Context Protocol (`python -m backend.mcp_server`). The agent calls the tool functions directly rather than through this server.
- **Capacity simulator** (`backend/simulator.py`): a Monte Carlo model of hospital bed and ICU demand under a user-chosen surge scenario, reporting the mean and the 5th and 95th percentiles.
- **Frontend** (`frontend/`): React pages for an overview, a map built with `react-globe.gl`, charts built with Plotly, forecasts, wastewater, the simulator and the chat.

## Running locally

Requirements: Python 3.10 or later and Node.js 18 or later.

### Backend

Run these commands from the repository root:

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then edit the values
set -a; source .env; set +a # load the settings into the shell
uvicorn backend.main:app --reload
```

The API runs at http://localhost:8000 and the interactive documentation at http://localhost:8000/docs. The first start downloads the CDC datasets, which takes a few minutes.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at http://localhost:5173.

## Configuration

All settings are read from environment variables. `.env.example` lists each one.

| Variable | Purpose | Default |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed by CORS | `http://localhost:5173` |
| `LOG_FORMAT` | `json` (one JSON object per line) or `text` | `json` |
| `ADMIN_API_KEY` | Key required in the `X-API-Key` header for the training endpoints; if unset, training is disabled | unset |
| `CDC_DB_PATH` | DuckDB file the app reads and writes | `data/cdc_surveillance.duckdb` |
| `INGEST_ON_STARTUP` | Set to `false` to serve `CDC_DB_PATH` without downloading new data | `true` |
| `AGENT_MODEL` | `gemini-flash-lite` or `ollama-local` | `gemini-flash-lite` |
| `GEMINI_API_KEY` | Gemini API key for the agent | unset |
| `GEMINI_MODEL_ID` | Gemini model id | `gemini-3.5-flash-lite` |
| `OLLAMA_AGENT_MODEL` | Ollama model for the agent | `qwen2.5:7b` |
| `STALE_AFTER_DAYS` | Age at which a table is reported as stale | `14` |
| `REVIEW_QUEUE_PATH` | File for answers that fail the number checker | `evals/review_queue.jsonl` |
| `OLLAMA_MODEL` | Ollama model used by the chat endpoint | `mistral` |
| `LOG_LEVEL` | Python logging level | `INFO` |
| `VITE_API_URL` | API base URL used by the frontend at build time | `http://localhost:8000/api` |

Models are trained from the command line only (`python -c "from backend.forecasting import train_model; print(train_model('COVID-NET'))"`); the frontend has no training buttons. With the API running, the training endpoints `POST /api/forecast/train/{virus}` and `POST /api/ensemble/train/{virus}` require the header `X-API-Key: <ADMIN_API_KEY>`, for example:

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" http://localhost:8000/api/forecast/train/COVID-NET
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" http://localhost:8000/api/ensemble/train/COVID-NET
```

Ask the agent a question:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"question": "What is COVID-19 test positivity this week?"}' http://localhost:8000/api/agent/ask
```

The NWSS wastewater dataset the app uses has no records after 2025-09-07, so wastewater questions are reported as not covered.

## Development

```bash
make run    # start the API with reload
make test   # run pytest
make lint   # run ruff
make eval   # placeholder until an evaluation suite exists
```

## Running locally on an 8 GB Mac

The agent can run fully offline on Ollama instead of Gemini. `qwen2.5:3b` (Q4_K_M, about 1.9 GB on disk) fits in 8 GB of memory alongside the API and a browser.

```bash
brew install ollama            # or the app from ollama.com
ollama serve &                 # the app starts this for you
ollama pull qwen2.5:3b

cp .env.example .env
# in .env:
#   AGENT_MODEL=ollama-local
#   OLLAMA_AGENT_MODEL=qwen2.5:3b
#   CDC_DB_PATH=evals/snapshot.duckdb   # optional: the eval snapshot, no network needed
#   INGEST_ON_STARTUP=false

pip install -r requirements.txt
uvicorn backend.main:app --port 8000
cd frontend && npm install && npm run dev   # http://localhost:5173/ask
```

- No API key is needed. Nothing leaves the machine.
- Close other heavy apps. If memory runs short, macOS swaps and answers slow down a lot.
- Expect lower accuracy than Gemini Flash-Lite. The measured numbers for `qwen2.5:3b` are in the eval tables on the site (`site/data/eval.json`). They were measured on an 8-core Linux CPU with no GPU, so speed on a Mac will differ.
- To run the evals against it:

```bash
cp evals/snapshot.duckdb /tmp/snap.duckdb
CDC_DB_PATH=/tmp/snap.duckdb INGEST_ON_STARTUP=false RATE_LIMITS_ENABLED=false AGENT_MODEL=ollama-local OLLAMA_AGENT_MODEL=qwen2.5:3b \
  uvicorn backend.main:app --port 8000 &
python evals/run_evals.py --model qwen2.5:3b --url http://localhost:8000
```

## Nightly run

`.github/workflows/nightly.yml` runs daily at 09:17 UTC. You can also start it by hand from the Actions tab (workflow_dispatch). Each run does the following:

1. `scripts/refresh_data.py` pulls the latest CDC data into a fresh DuckDB file.
2. `evals/backtest.py` reruns the rolling-origin backtest on that data. It writes `evals/results/backtest.json` and `site/data/backtest.json`.
3. `scripts/build_dashboard.py` writes `site/data/dashboard.json`.
4. The 60-question eval runs against the frozen snapshot (`evals/snapshot.duckdb`), so its scores stay comparable from night to night. `scripts/publish_eval.py` then appends the run to `site/data/eval.json` and rebuilds `site/data/replay.json`. This step uses the `GEMINI_API_KEY` repository secret.
5. `scripts/nightly_status.py` writes `site/data/status.json`. Its shape is in `site/DATA_CONTRACT.md` section 6.
6. The run commits the results to `main` and starts the Pages deploy.
7. `scripts/open_alerts.py` opens a GitHub issue labelled `nightly-alert` for each alert, or comments on a matching open issue.

A run raises an alert when:
- an eval rate is more than 5 points worse than `evals/baseline.json`;
- a current table is more than 14 days old; or
- a step fails.

A failed step also marks the run as failed. To move the baseline, replace `evals/baseline.json` with the summary of a newer run.

## Logs

The API logs one JSON object per line by default (`LOG_FORMAT=json`; set `LOG_FORMAT=text` for plain lines). Every line in a request carries a `request_id`, taken from the `X-Request-ID` header or generated, and the response echoes it back. The agent logs one line for each model call (`event: model_call`, with elapsed time and token counts when the model reports them) and one for each tool call (`event: tool_call`, with inputs, rows returned and elapsed time). It logs a final `agent_answer` line with the status. Each request also gets one `event: request` line.

## Deployment

`render.yaml` is a Render Blueprint for the API only. The site is served from GitHub Pages.

- **Service:** `cdc-outbreak-api` runs on the free plan (512 MB, sleeps when idle) with Python 3.12.
- **Packages:** it installs `requirements-render.txt`, which leaves out torch, xgboost, scikit-learn, ollama and the test tools. Without torch and xgboost, the forecast endpoints and `get_forecast` return `no_model`, the same response as when no model is trained.
- **Memory:** measured locally on Python 3.12, `pip install` peaks at 141 MB RSS. Startup plus a set of requests peaked at 209 MB. That was measured while the service also carried the Mirage audit agent (one question each on both agents); the audit agent now runs from https://github.com/NeelVadlamudi/mirage.
- **Database:** at start it copies `evals/snapshot.duckdb` to `/tmp` and serves that copy with `INGEST_ON_STARTUP=false`. A full CDC pull would block startup and peaks at about 240 MB by itself. The nightly GitHub Actions job refreshes the published data instead.
- **Health check:** `GET /api/health`.
- **CORS:** `ALLOWED_ORIGINS` is `https://neelvadlamudi.github.io`, so the Pages site can call `POST <render url>/api/agent/ask`.
- **Secrets:** set `GEMINI_API_KEY` in the Render dashboard. Render generates `ADMIN_API_KEY`.
- **Rate limits** (`backend/ratelimit.py`, in memory, reset on restart). Each address gets:
  - `POST /api/agent/ask` and `/api/chat`: 6 a minute and 60 a day, with 800 a day across all callers.
  - `GET /api/weekly-brief`: 10 a minute and 100 a day.
  - Over a limit, the API returns `429` with `Retry-After` and a plain `detail` message. The `RATE_*` env vars change the numbers; `RATE_LIMITS_ENABLED=false` turns them off (the nightly eval does this).
- **API docs:** `ENABLE_API_DOCS=false` in `render.yaml`, so `/docs`, `/redoc` and `/openapi.json` return 404 on Render. They stay on locally.

The `Dockerfile` builds the frontend and runs the API with `uvicorn backend.main:app`.

## Data source

All data comes from public CDC datasets on [data.cdc.gov](https://data.cdc.gov). This project is not affiliated with the CDC.
