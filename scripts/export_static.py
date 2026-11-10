#!/usr/bin/env python3
"""Build an immutable public data generation; replace its manifest only on success."""

import argparse
import asyncio
import hashlib
import inspect
import json
import os
import re
import shutil
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import duckdb  # noqa: E402
from fastapi.encoders import jsonable_encoder  # noqa: E402
from fastapi.params import Query  # noqa: E402

from backend.read_queries import PUBLIC_COLUMNS, browser_plans  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def database_path(path):
    from backend import config, database, ensemble, simulator

    modules = [config, database, ensemble, simulator]
    old = [module.DB_PATH for module in modules]
    try:
        for module in modules:
            module.DB_PATH = str(Path(path).resolve())
        yield
    finally:
        for module, value in zip(modules, old, strict=True):
            module.DB_PATH = value


def static_requests():
    # These are the selectable values in the existing UI, not model or data guesses.
    viruses = re.findall(r"key: '(.*?)'", (ROOT / "frontend/src/pages/Forecasts.jsx").read_text())
    pathogens_match = re.search(r"const PATHOGENS = (\[.*?\]);", (ROOT / "frontend/src/pages/Wastewater.jsx").read_text())
    pathogens = json.loads(pathogens_match.group(1)) if pathogens_match else []
    if len(viruses) != 3 or len(pathogens) != 3:
        raise ValueError("Forecast selector changed; review the static export coverage")
    requests = [(path, {}) for path in (
        "/dashboard-summary", "/hospitalizations/trends", "/test-positivity/latest",
        "/anomalies", "/season-comparison", "/states", "/sources", "/hospitalizations/sites",
        "/simulator/defaults", "/weekly-brief",
    )]
    for virus in viruses:
        for prefix in ("/forecast/", "/ensemble/forecast/", "/ensemble/compare/", "/age-heatmap/"):
            requests.append((prefix + virus, {}))
    for path in ("/wastewater/latest", "/wastewater/states"):
        for pathogen in pathogens:
            requests.append((path, {"pathogen": pathogen, "dataset": "current"}))
        requests.append((path, {"dataset": "legacy"}))
    return requests


def request_key(path, params):
    query = urlencode(sorted(params.items()))
    return path + ("?" + query if query else "")


async def route_payload(path, params):
    from backend.routes import router

    for route in router.routes:
        match = route.path_regex.fullmatch("/api" + path)
        if not match or "GET" not in route.methods:
            continue
        values = {}
        for name, parameter in inspect.signature(route.endpoint).parameters.items():
            default = parameter.default
            values[name] = default.default if isinstance(default, Query) else default
        values.update(match.groupdict())
        values.update(params)
        return jsonable_encoder(await route.endpoint(**values))
    raise ValueError(f"No read route: {path}")


def write_json(path, value):
    path.write_text(json.dumps(jsonable_encoder(value), allow_nan=False, separators=(",", ":")) + "\n")


def trim_database(source, target):
    # A new database avoids carrying deleted rows, private tables or catalog objects across.
    conn = duckdb.connect(str(target), config={"storage_compatibility_version": "v1.0.0", "threads": 1})
    try:
        conn.execute("ATTACH ? AS source (READ_ONLY)", [str(Path(source).resolve())])
        for table, columns in PUBLIC_COLUMNS.items():
            selected = ", ".join(columns)
            conn.execute(f"CREATE TABLE {table} AS SELECT {selected} FROM source.{table}")
        conn.execute("DETACH source")
        conn.execute("CHECKPOINT")
        actual = {row[0]: [r[1] for r in conn.execute(f"PRAGMA table_info('{row[0]}')").fetchall()]
                  for row in conn.execute("SHOW TABLES").fetchall()}
        if actual != PUBLIC_COLUMNS:
            raise ValueError("Public database schema differs from the allowlist")
    finally:
        conn.close()


def export_static(db_path, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".static-", dir=output.parent))
    try:
        with database_path(db_path):
            from backend import config

            endpoints = {}
            for index, (path, params) in enumerate(static_requests()):
                name = f"response-{index:02d}.json"
                write_json(stage / name, asyncio.run(route_payload(path, params)))
                endpoints[request_key(path, params)] = name
            write_json(stage / "queries.json", browser_plans())
            trim_database(db_path, stage / "public.duckdb")
            summary = json.loads((stage / endpoints["/dashboard-summary"]).read_text())
            dates = dict(summary["latest_dates"])
            wastewater_date = summary.get("wastewater_summary", {}).get("week_end")
            if wastewater_date:
                dates["wastewater"] = wastewater_date[:10]
            if not dates or any(not value for value in dates.values()):
                raise ValueError("Missing core data dates; refusing an incomplete generation")
            digest = hashlib.sha256()
            for file in sorted(stage.iterdir()):
                digest.update(file.name.encode())
                digest.update(file.read_bytes())
            version = digest.hexdigest()[:20]
            prefix = f"releases/{version}/"
            manifest = {
                "schema_version": 1, "version": version,
                "built_at": datetime.now(timezone.utc).isoformat(),
                "stale_after_days": config.STALE_AFTER_DAYS,
                "data_date": summary["week_ending"], "data_dates": dates,
                "database": prefix + "public.duckdb", "queries": prefix + "queries.json",
                "endpoints": {key: prefix + name for key, name in endpoints.items()},
                "public_columns": PUBLIC_COLUMNS,
                "database_bytes": (stage / "public.duckdb").stat().st_size,
            }
            releases = output / "releases"
            releases.mkdir(exist_ok=True)
            generation = releases / version
            if not generation.exists():
                os.replace(stage, generation)
            write_json(output / ".manifest.tmp", manifest)
            os.replace(output / ".manifest.tmp", output / "manifest.json")
            return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--out", default="site/data/static")
    args = parser.parse_args()
    result = export_static(args.db, args.out)
    print(f"Exported {len(result['endpoints'])} JSON responses; public database {result['database_bytes']} bytes")
