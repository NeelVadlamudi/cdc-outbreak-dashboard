import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode

import duckdb
import pytest
from fastapi.encoders import jsonable_encoder
from fastapi.testclient import TestClient

from backend.main import app
from backend.read_queries import PUBLIC_COLUMNS, read_payload
from scripts.export_static import database_path, export_static, request_key, static_requests

SNAPSHOT = Path(__file__).resolve().parents[1] / "evals/snapshot.duckdb"

SAMPLES = [
    ("/ari-activity", {}),
    ("/ari-activity", {"geography": "Alabama"}),
    ("/ari-activity", {"week_end": "2026-10-10", "geography": "Ohio"}),
    ("/ari-activity/history", {"geography": "Ohio"}),
    ("/ari-activity/history", {}),
    ("/hospitalizations", {}),
    ("/hospitalizations", {"age_group": "Overall", "limit": 200}),
    ("/hospitalizations", {"network": "COVID-NET", "site": "Overall", "age_group": "Overall", "limit": 12}),
    ("/hospitalizations", {"network": "RSV-NET", "age_group": "65+ yr", "limit": 15}),
    ("/hospitalizations", {"site": "California", "age_group": "Overall", "limit": 50}),
    ("/test-positivity", {}),
    ("/test-positivity", {"limit": 200}),
    ("/test-positivity", {"pathogen": "COVID-19", "limit": 12}),
    ("/test-positivity", {"pathogen": "Influenza", "limit": 0}),
    ("/wastewater", {}),
    ("/wastewater", {"dataset": "current", "limit": 5000}),
    ("/wastewater", {"dataset": "current", "state": "Ohio", "pathogen": "RSV", "limit": 100}),
    ("/wastewater", {"dataset": "legacy", "state": "Ohio", "pathogen": "ignored", "limit": 20}),
    ("/wastewater", {"dataset": "current", "pathogen": "Influenza A virus", "limit": 20}),
    ("/wastewater", {"dataset": "current", "state": "Ohio", "limit": 20}),
    ("/wastewater", {"dataset": "legacy", "limit": 20}),
    ("/test-positivity", {"pathogen": "COVID-19' OR 1=1 --", "limit": 20}),
    ("/wastewater/county/39049", {}),
    ("/wastewater/county/00000", {}),
]


@pytest.fixture(scope="module")
def published(tmp_path_factory):
    output = tmp_path_factory.mktemp("published")
    manifest = export_static(SNAPSHOT, output)
    return output, manifest


@pytest.mark.parametrize("path,params", static_requests())
def test_static_response_parity(published, path, params):
    output, manifest = published
    with database_path(SNAPSHOT):
        response = TestClient(app).get("/api" + path, params=params)
    assert response.status_code == 200
    expected = json.loads((output / manifest["endpoints"][request_key(path, params)]).read_text())
    assert expected == response.json()


@pytest.mark.parametrize("path,params", SAMPLES)
def test_public_database_parity(published, path, params):
    from backend.read_queries import SPECS

    output, manifest = published
    template = "/wastewater/county/{fips}" if path.startswith("/wastewater/county/") else path
    values = {**SPECS[template]["defaults"], **params}
    if template.endswith("{fips}"):
        values["fips"] = path.rsplit("/", 1)[1]
    with database_path(SNAPSHOT):
        response = TestClient(app).get("/api" + path, params=params)
    assert response.status_code == 200
    conn = duckdb.connect(str(output / manifest["database"]), read_only=True)
    try:
        def query(sql, bindings):
            cursor = conn.execute(sql, bindings)
            frame = cursor.fetchdf()
            return frame.astype(object).where(frame.notna(), None).to_dict(orient="records")
        assert jsonable_encoder(read_payload(template, values, query)) == response.json()
    finally:
        conn.close()


def test_public_schema_is_allowlisted(published):
    output, manifest = published
    conn = duckdb.connect(str(output / manifest["database"]), read_only=True)
    try:
        tables = [row[0] for row in conn.execute("SHOW TABLES").fetchall()]
        assert set(tables) == set(PUBLIC_COLUMNS)
        for table in tables:
            assert [row[1] for row in conn.execute(f"PRAGMA table_info('{table}')").fetchall()] == PUBLIC_COLUMNS[table]
    finally:
        conn.close()


def test_failed_export_keeps_last_good(published, monkeypatch):
    import scripts.export_static as exporter

    output, manifest = published
    before = {str(file.relative_to(output)): hashlib.sha256(file.read_bytes()).hexdigest()
              for file in output.rglob("*") if file.is_file()}
    original = exporter.write_json
    calls = 0

    def fail_after_three_files(path, value):
        nonlocal calls
        calls += 1
        if calls == 4:
            raise RuntimeError("export interrupted")
        original(path, value)

    monkeypatch.setattr(exporter, "write_json", fail_after_three_files)
    with pytest.raises(RuntimeError, match="interrupted"):
        export_static(SNAPSHOT, output)
    after = {str(file.relative_to(output)): hashlib.sha256(file.read_bytes()).hexdigest()
             for file in output.rglob("*") if file.is_file()}
    assert before == after
    assert json.loads((output / "manifest.json").read_text()) == manifest


def test_incomplete_artifact_cannot_publish(published, tmp_path):
    output, manifest = published
    copy = tmp_path / "incomplete"
    shutil.copytree(output, copy)
    (copy / manifest["endpoints"]["/dashboard-summary"]).unlink()
    result = subprocess.run(["node", "scripts/validate_static.mjs", str(copy)], capture_output=True)
    assert result.returncode != 0


def test_no_read_only_render_fallback():
    source = (SNAPSHOT.parents[1] / "frontend/src/api.ts").read_text()
    start, end = source.index("export const getDashboardSummary"), source.index("export async function askAgent")
    assert "fetchAPI(" not in source[start:end]
    assert 'getSimDefaults = () => readStatic(' in source
    assert 'fetchAPI("/simulator/run"' in source
    assert 'fetch(`${API_BASE}${ASK_ENDPOINT}`' in source


def write_browser_cases(target):
    cases = []
    with database_path(SNAPSHOT):
        client = TestClient(app)
        for path, params in static_requests() + SAMPLES:
            response = client.get("/api" + path, params=params)
            assert response.status_code == 200
            cases.append({"endpoint": path + ("?" + urlencode(params) if params else ""),
                          "expected": response.json()})
    Path(target).write_text(json.dumps(cases))
    from backend.routes import SimRequest

    params = SimRequest().model_dump()
    response = client.post("/api/simulator/run", json=params)
    assert response.status_code == 200
    Path(target).with_name("simulator-case.json").write_text(json.dumps({"params": params, "expected": response.json()}))


if __name__ == "__main__":
    import sys
    write_browser_cases(sys.argv[1])


@pytest.mark.parametrize("mutation", ["bad_response", "bad_unlisted_json", "column", "table", "view", "macro", "schema"])
def test_upload_validator_rejects_invalid_generation(published, tmp_path, mutation):
    output, manifest = published
    copy = tmp_path / "invalid"
    shutil.copytree(output, copy)
    if mutation == "bad_response":
        (copy / manifest["endpoints"]["/dashboard-summary"]).write_text("{broken")
    elif mutation == "bad_unlisted_json":
        (copy / "unlisted.json").write_text("{broken")
    else:
        statements = {"column": "ALTER TABLE ari_activity ADD COLUMN private_note VARCHAR",
                      "table": "CREATE TABLE extra_rows (value INTEGER)",
                      "view": "CREATE VIEW extra_view AS SELECT 1 AS value",
                      "macro": "CREATE MACRO extra_macro() AS 1", "schema": "CREATE SCHEMA extra_schema"}
        with duckdb.connect(str(copy / manifest["database"])) as conn:
            conn.execute(statements[mutation])
    result = subprocess.run(["node", "scripts/validate_static.mjs", str(copy)], capture_output=True,
                            env={**os.environ, "PYTHON": sys.executable})
    assert result.returncode != 0, mutation


def test_upload_validator_accepts_allowlisted_generation(published):
    output, _ = published
    result = subprocess.run(["node", "scripts/validate_static.mjs", str(output)], capture_output=True,
                            env={**os.environ, "PYTHON": sys.executable})
    assert result.returncode == 0, result.stderr.decode()


@pytest.mark.parametrize("marker", [None, "wrong-run", "snapshot", "valid"])
def test_pages_validation_requires_matching_nightly_provenance(published, tmp_path, marker):
    output, manifest = published
    copy = tmp_path / "provenance"
    shutil.copytree(output, copy)
    if marker:
        provenance = {"source": "nightly-live", "database": "data/cdc_surveillance.duckdb",
                      "run_id": "999", "run_attempt": "1", "repository": "example/dashboard",
                      "commit": "123", "version": manifest["version"]}
        if marker == "valid":
            provenance["run_id"] = "123"
        if marker == "snapshot":
            provenance.update(run_id="123", database="evals/snapshot.duckdb")
        (copy / "provenance.json").write_text(json.dumps(provenance))
    result = subprocess.run(["node", "scripts/validate_static.mjs", str(copy)], capture_output=True,
                            env={**os.environ, "PYTHON": sys.executable, "STATIC_NIGHTLY_RUN_ID": "123",
                                 "STATIC_NIGHTLY_RUN_ATTEMPT": "1", "GITHUB_REPOSITORY": "example/dashboard",
                                 "STATIC_NIGHTLY_COMMIT": "123"})
    assert (result.returncode == 0) == (marker == "valid"), result.stderr.decode()
