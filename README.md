# CDC Outbreak Dashboard

A dashboard for U.S. respiratory virus surveillance data (COVID-19, influenza and RSV). The backend downloads public CDC datasets through the Socrata Open Data API (SODA), stores them in a local DuckDB file and serves them through a FastAPI application. The frontend is a React application built with Vite.

<img src="assets/dashboard_preview.png" alt="Dashboard preview" width="100%" />

## What the code does

- **Data ingestion** (`backend/cdc_ingestion.py`): downloads four public datasets from data.cdc.gov (acute respiratory illness activity by state, RESP-NET hospitalization rates, test positivity, and NWSS wastewater surveillance), cleans them with pandas and loads them into DuckDB. Ingestion runs at startup and then every 60 minutes.
- **Query API** (`backend/routes.py`): read-only endpoints under `/api` for activity levels, hospitalization rates, test positivity, wastewater data, a dashboard summary and a server-sent event stream. SQL queries use bound parameters.
- **LSTM forecast** (`backend/forecasting.py`): a PyTorch LSTM trained on weekly hospitalization rates with lag, rolling-mean and seasonal sine/cosine features. It predicts four weeks ahead and reports validation MAE. The forecast band is the MAE scaled by a factor that grows with the horizon; it is not a statistical interval.
- **XGBoost forecast** (`backend/ensemble.py`): a gradient-boosted model on lag features. `/api/ensemble/compare/{virus}` returns the LSTM and XGBoost forecasts side by side. The same module flags anomalies with an Isolation Forest and builds age-group and season comparison data.
- **Chat** (`backend/llm_engine.py`): sends a fixed summary of the latest data, together with the user's question, to a local model through Ollama. The same summary is used for every question; no per-question retrieval or vector search takes place. If Ollama is not running, a rule-based answer is returned instead.
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
| `ADMIN_API_KEY` | Key required in the `X-API-Key` header for the training endpoints; if unset, training is disabled | unset |
| `OLLAMA_MODEL` | Ollama model used by the chat endpoint | `mistral` |
| `LOG_LEVEL` | Python logging level | `INFO` |
| `VITE_API_URL` | API base URL used by the frontend at build time | `http://localhost:8000/api` |

The training endpoints `POST /api/forecast/train/{virus}` and `POST /api/ensemble/train/{virus}` require the header `X-API-Key: <ADMIN_API_KEY>`, for example:

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" http://localhost:8000/api/forecast/train/COVID-NET
```

## Development

```bash
make run    # start the API with reload
make test   # run pytest
make lint   # run ruff
make eval   # placeholder until an evaluation suite exists
```

## Deployment

`render.yaml` defines a Render web service for the API and a static site for the frontend. The `Dockerfile` builds the frontend and runs the API with `uvicorn backend.main:app`.

## Data source

All data comes from public CDC datasets on [data.cdc.gov](https://data.cdc.gov). This project is not affiliated with the CDC.
