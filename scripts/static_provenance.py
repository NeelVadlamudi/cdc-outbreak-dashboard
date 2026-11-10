"""Mark only a main-branch nightly export of the refreshed surveillance database."""

import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write_provenance(database, output, env):
    if Path(database).resolve() != ROOT / "data/cdc_surveillance.duckdb":
        raise ValueError("Only the refreshed surveillance database may be published")
    if not Path(database).is_file():
        raise ValueError("Refreshed surveillance database missing")
    if env.get("GITHUB_WORKFLOW") != "nightly" or env.get("GITHUB_REF") != "refs/heads/main":
        raise ValueError("Only the main-branch nightly workflow may mark a public generation")
    if env.get("GITHUB_EVENT_NAME") not in {"schedule", "workflow_dispatch"}:
        raise ValueError("Unexpected nightly trigger")
    output = Path(output)
    manifest = json.loads((output / "manifest.json").read_text())
    provenance = {"source": "nightly-live", "database": "data/cdc_surveillance.duckdb",
                  "run_id": env["GITHUB_RUN_ID"], "run_attempt": env["GITHUB_RUN_ATTEMPT"],
                  "repository": env["GITHUB_REPOSITORY"], "commit": env["GITHUB_SHA"],
                  "version": manifest["version"]}
    (output / "provenance.json").write_text(json.dumps(provenance) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--out", default="site/data/static")
    args = parser.parse_args()
    write_provenance(args.db, args.out, os.environ)
