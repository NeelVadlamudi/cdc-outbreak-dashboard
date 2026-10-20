"""Pull the latest CDC data into the DuckDB file at CDC_DB_PATH. Exit 1 if any dataset failed."""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.cdc_ingestion import run_full_ingestion  # noqa: E402
from backend.config import DB_PATH, configure_logging  # noqa: E402
from backend.database import init_database  # noqa: E402


def main() -> int:
    configure_logging()
    log = logging.getLogger("refresh_data")
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    init_database()
    ok = asyncio.run(run_full_ingestion())
    log.info("refresh finished", extra={"event": "refresh", "ok": ok, "db": DB_PATH})
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
