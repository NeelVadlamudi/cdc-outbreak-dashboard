#!/usr/bin/env python3
"""Bundle a reproducible illustrative scenario from the real simulator route."""

import argparse
import asyncio
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.routes import SimRequest, run_sim  # noqa: E402


def build_default():
    params = SimRequest()
    state = np.random.get_state()
    try:
        np.random.seed(0)
        result = asyncio.run(run_sim(params))
    finally:
        np.random.set_state(state)
    return {"schema_version": 1, "seed": 0, "params": params.model_dump(), "result": result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "frontend/src/data/simulator-default.json")
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(build_default(), allow_nan=False, indent=2) + "\n")
