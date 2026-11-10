#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python}"
export INGEST_ON_STARTUP=false
export GEMINI_API_KEY=''
"$PYTHON" scripts/export_static.py --db evals/snapshot.duckdb
# Simulator browser checks use a locally generated response, never a live service.
VITE_API_URL=http://127.0.0.1:4174/api APP_BASE=/cdc-outbreak-dashboard/app/ npm --prefix frontend run build
# Start with a fresh artifact so superseded bundles cannot be published.
rm -rf _site
mkdir -p _site/app _site/data
cp -r frontend/dist/. _site/app/
cp -r site/. _site/
for route in ask map forecasts analytics simulator wastewater advanced; do
  mkdir -p "_site/app/$route"
  cp _site/app/index.html "_site/app/$route/index.html"
done
PYTHONPATH=".:${PYTHONPATH:-}" "$PYTHON" tests/test_static_export.py _site/browser-cases.json
node scripts/validate_static.mjs _site/data/static
node scripts/test_static_browser.mjs
