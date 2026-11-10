"""Release provenance and permission checks; all remote responses are fixtures."""

import json
from pathlib import Path

import pytest
import yaml

from scripts import static_provenance
from scripts.select_static_run import select_run, validate_run

REPO = "example/dashboard"
ROOT = Path(__file__).resolve().parents[1]


def nightly_run(**changes):
    return {"id": 123, "status": "completed", "conclusion": "success", "head_branch": "main",
            "path": ".github/workflows/nightly.yml", "event": "schedule", "head_sha": "abc123",
            "run_attempt": 1, "repository": {"full_name": REPO}, "head_repository": {"full_name": REPO},
            **changes}


@pytest.mark.parametrize("changes", [
    {"status": "in_progress"}, {"conclusion": "failure"}, {"head_branch": "feature"},
    {"path": ".github/workflows/ci.yml"}, {"event": "pull_request"},
    {"repository": {"full_name": "other/dashboard"}}, {"head_repository": {"full_name": "other/dashboard"}},
])
def test_untrusted_run_cannot_supply_pages_data(changes):
    with pytest.raises(ValueError):
        validate_run(nightly_run(**changes), REPO)


def test_selects_only_complete_nightly_artifacts():
    requested = []

    def api(path):
        requested.append(path)
        if "/workflows/" in path:
            return {"workflow_runs": [nightly_run(id=124), nightly_run()]}
        if "/124/" in path:
            return {"artifacts": [{"name": "static-dashboard", "expired": True}]}
        return {"artifacts": [{"name": "static-dashboard", "expired": False}]}

    assert select_run(api, REPO)["id"] == 123
    assert len(requested) == 3


def test_explicit_run_still_requires_nightly_and_artifact():
    with pytest.raises(ValueError):
        select_run(lambda path: nightly_run(path=".github/workflows/ci.yml"), REPO, "123")
    with pytest.raises(ValueError):
        select_run(lambda path: nightly_run() if "/artifacts" not in path else {"artifacts": []}, REPO, "123")
    with pytest.raises(ValueError):
        select_run(lambda path: None, REPO, "123;false")


def test_provenance_writer_rejects_snapshot_and_local_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(static_provenance, "ROOT", tmp_path)
    data = tmp_path / "data/cdc_surveillance.duckdb"
    data.parent.mkdir()
    data.touch()
    output = tmp_path / "static"
    output.mkdir()
    (output / "manifest.json").write_text(json.dumps({"version": "v1"}))
    env = {"GITHUB_WORKFLOW": "nightly", "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "schedule",
           "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_REPOSITORY": REPO, "GITHUB_SHA": "abc123"}
    static_provenance.write_provenance(data, output, env)
    assert json.loads((output / "provenance.json").read_text())["source"] == "nightly-live"
    with pytest.raises(ValueError):
        static_provenance.write_provenance(tmp_path / "evals/snapshot.duckdb", output, env)
    with pytest.raises(ValueError):
        static_provenance.write_provenance(data, output, {**env, "GITHUB_WORKFLOW": "ci"})


def test_workflow_permissions_and_deployment_gates():
    workflows = ROOT / ".github/workflows"
    ci = yaml.load((workflows / "ci.yml").read_text(), Loader=yaml.BaseLoader)
    pages = yaml.load((workflows / "pages.yml").read_text(), Loader=yaml.BaseLoader)
    nightly = yaml.load((workflows / "nightly.yml").read_text(), Loader=yaml.BaseLoader)
    assert ci["permissions"] == {"contents": "read"}
    assert pages["permissions"] == {"contents": "read"}
    assert pages["jobs"]["deploy"]["permissions"] == {
        "contents": "read", "actions": "read", "pages": "write", "id-token": "write"}
    assert "actions" not in nightly["permissions"]
    assert pages["on"]["workflow_run"]["workflows"] == ["nightly"]
    steps = pages["jobs"]["deploy"]["steps"]
    validation = next(step for step in steps if step.get("name") == "Validate generation before publishing")
    assert set(validation["env"]) == {"STATIC_NIGHTLY_RUN_ID", "STATIC_NIGHTLY_RUN_ATTEMPT", "STATIC_NIGHTLY_COMMIT"}
    assert not any("export_static.py" in step.get("run", "") for step in steps)
    static = next(step for step in nightly["jobs"]["nightly"]["steps"] if step.get("id") == "static")
    assert "steps.refresh.outcome == 'success'" == static["if"]
    assert 'export_static.py --db "$CDC_DB_PATH"' in static["run"]
    assert nightly["jobs"]["nightly"]["env"]["CDC_DB_PATH"] == "${{ github.workspace }}/data/cdc_surveillance.duckdb"
    assert "static_provenance.py" in static["run"]
    assert "validate_static.mjs" in static["run"]
