#!/usr/bin/env bash
# Local CI-equivalent lint + unit tests (backend job). Prefer: make check
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python}"
"$PYTHON" -m ruff check .
make test
