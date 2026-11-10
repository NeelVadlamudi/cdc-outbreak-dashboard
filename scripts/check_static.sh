#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python}"
export INGEST_ON_STARTUP=false
export GEMINI_API_KEY=''
"$PYTHON" scripts/export_static.py --db evals/snapshot.duckdb
APP_BASE=/cdc-outbreak-dashboard/app/ npm --prefix frontend run build
mkdir -p _site/app _site/data
cp -r frontend/dist/. _site/app/
cp -r site/data/static _site/data/
PYTHONPATH=. "$PYTHON" tests/test_static_export.py _site/browser-cases.json
node scripts/validate_static.mjs _site/data/static
node scripts/test_static_browser.mjs
