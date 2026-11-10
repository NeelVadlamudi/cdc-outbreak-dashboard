# Read-only dashboard data

The read-only app loads published data on Pages. The nightly job calls the backend's existing read functions to build JSON responses, including the weekly brief. Forecast networks and wastewater pathogens come from the UI's selectors. Missing published data is an error, never a fallback to the API.

Filtered views share query plans in `backend/read_queries.py` with the backend. The exporter writes those plans as JSON. The browser binds parameters and runs them with a lazily loaded DuckDB-WASM worker. ARI history also uses this layer. Read-only health reports the manifest's source dates; it is not a server health check.

The public database is created from scratch with only the tables and columns in `PUBLIC_COLUMNS`. It does not copy the source catalog, other tables, deleted rows, model artifacts or logs. The exporter checks its schema before publishing. Database files and generated JSON stay out of git.

Exports are written in a temporary directory. The immutable generation is moved into place only after every response, query plan and public database has been written. The manifest is then replaced atomically. A failed export leaves the previous manifest and all its data unchanged. Pages only deploys a complete artifact, so an unsuccessful nightly export does not replace the last good site. An open page pins one generation; reload to see a newer publication.

`pages.yml` takes an optional nightly `data_run_id`; otherwise it selects the latest complete `static-dashboard` artifact. The first deployment needs a successful nightly export. Missing or expired artifacts fail the deploy without changing the published site. The artifact contains public data only. The existing full database release for the API is unchanged.

The question and scenario endpoints retain their existing live client. The simulator still runs its initial scenario on opening that page. Read-only defaults are static. Training routes are unchanged.

## Local checks

With backend dependencies and frontend packages installed:

```sh
python -m pytest
python -m ruff check .
npm --prefix frontend run lint
npm --prefix frontend run test:contract
npm --prefix frontend exec playwright install chromium
PYTHON=python scripts/check_static.sh
```

The static check uses only `evals/snapshot.duckdb` and local servers. It compares every exported response and filtered query samples against FastAPI TestClient, checks an interrupted export, and checks browser results against the same local responses. External network traffic is blocked in the browser test. No request reaches the live API. Geographic chart assets fetched from third-party hosts are outside this check.

WASM is fetched only for filtered queries. Modern browsers fetch the exception-handling bundle; older browsers can select the larger MVP bundle. A phone-sized viewport is not a real-device performance measurement. Both bundles and the public database should be included when reviewing deployment size, but a visit downloads only its selected bundle.
