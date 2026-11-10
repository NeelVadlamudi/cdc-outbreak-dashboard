import asyncio
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from backend.routes import SimRequest, run_sim

ROOT = Path(__file__).resolve().parents[1]


def test_bundled_default_matches_real_simulator():
    path = ROOT / "frontend/src/data/simulator-default.json"
    assert path.is_file(), "A default scenario must be shipped with the application"
    snapshot = json.loads(path.read_text())
    assert snapshot["params"] == SimRequest().model_dump()
    state = np.random.get_state()
    try:
        np.random.seed(snapshot["seed"])
        expected = asyncio.run(run_sim(SimRequest(**snapshot["params"])))
    finally:
        np.random.set_state(state)
    assert snapshot["result"] == expected
    assert snapshot["result"]["weeks"] == list(range(1, 9))


def test_default_generator_is_reproducible(tmp_path):
    target = tmp_path / "simulator-default.json"
    result = subprocess.run([sys.executable, "scripts/build_simulator_default.py", "--out", str(target)],
                            cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == (ROOT / "frontend/src/data/simulator-default.json").read_bytes()
