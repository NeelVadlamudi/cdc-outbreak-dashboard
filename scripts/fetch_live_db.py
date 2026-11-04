#!/usr/bin/env python3
"""Download the twice-daily-published DuckDB for the live API.

Prefers CDC_DB_URL (direct HTTPS). Falls back to the frozen
evals/snapshot.duckdb so local/Render boot never hard-fails when the URL is
unset or the download fails (keeps last good dest file only if you remount;
on free Render /tmp is wiped on restart—then snapshot is used).

Usage (Render startCommand):
  python scripts/fetch_live_db.py --dest /tmp/cdc_surveillance.duckdb && \\
    uvicorn backend.main:app --host 0.0.0.0 --port $PORT

Nightly workflow uploads the refreshed DB to GitHub Release tag cdc-data-latest
(and as Actions artifact cdc-duckdb). Set CDC_DB_URL on Render once, e.g.:

  https://github.com/NeelVadlamudi/cdc-outbreak-dashboard/releases/download/cdc-data-latest/cdc_surveillance.duckdb

evals/snapshot.duckdb stays frozen for agent evals only.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "evals" / "snapshot.duckdb"


def download(url: str, dest: Path, timeout: int = 120) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".partial")
    req = urllib.request.Request(url, headers={"User-Agent": "cdc-outbreak-dashboard/fetch_live_db"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out)
    tmp.replace(dest)


def write_marker(dest: Path, *, source: str, url: str | None = None, error: str | None = None) -> None:
    """Sidecar for /api/health so the UI can say snapshot vs live without guessing."""
    import json
    from datetime import datetime, timezone

    marker = dest.with_suffix(dest.suffix + ".source.json")
    payload = {
        "source": source,  # "url" | "snapshot"
        "url_configured": bool(url),
        "fetched_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "dest": str(dest),
    }
    if error:
        payload["error"] = error
    marker.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    print(f"wrote source marker {marker} source={source}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dest", type=Path, default=Path(os.environ.get("CDC_DB_PATH", "/tmp/cdc_surveillance.duckdb")))
    ap.add_argument("--url", default=os.environ.get("CDC_DB_URL", "").strip())
    ap.add_argument("--snapshot", type=Path, default=SNAPSHOT)
    ap.add_argument("--require-url", action="store_true",
                    help="Fail if CDC_DB_URL is unset (default: fall back to snapshot).")
    args = ap.parse_args()

    fetch_error: str | None = None
    if args.url:
        try:
            print(f"downloading live DuckDB from {args.url} → {args.dest}")
            download(args.url, args.dest)
            print(f"ok: {args.dest.stat().st_size} bytes")
            write_marker(args.dest, source="url", url=args.url)
            return 0
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"download failed: {e}", file=sys.stderr)
            if args.require_url:
                return 1
            print("falling back to frozen snapshot", file=sys.stderr)
            fetch_error = str(e)

    if args.require_url and not args.url:
        print("CDC_DB_URL is required", file=sys.stderr)
        return 1

    if not args.snapshot.is_file():
        print(f"snapshot missing: {args.snapshot}", file=sys.stderr)
        return 1
    args.dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.snapshot, args.dest)
    print(f"using snapshot {args.snapshot} → {args.dest}")
    write_marker(
        args.dest,
        source="snapshot",
        url=args.url or None,
        error=fetch_error or ("CDC_DB_URL unset" if not args.url else None),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
