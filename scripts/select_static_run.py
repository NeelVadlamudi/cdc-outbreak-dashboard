"""Select an unexpired data artifact from a successful, trusted nightly run."""

import json
import os
import subprocess


def validate_run(run, repository):
    if not (run.get("status") == "completed" and run.get("conclusion") == "success"
            and run.get("head_branch") == "main" and run.get("path") == ".github/workflows/nightly.yml"
            and run.get("event") in {"schedule", "workflow_dispatch"}
            and run.get("repository", {}).get("full_name") == repository
            and run.get("head_repository", {}).get("full_name") == repository):
        raise ValueError("Data must come from a successful main-branch nightly run in this repository")
    return run


def select_run(api, repository, requested=""):
    prefix = f"repos/{repository}/actions"
    if requested:
        if not requested.isdigit():
            raise ValueError("Invalid nightly run id")
        runs = [validate_run(api(f"{prefix}/runs/{requested}"), repository)]
    else:
        runs = api(f"{prefix}/workflows/nightly.yml/runs?branch=main&status=success&per_page=100")["workflow_runs"]
    for run in runs:
        try:
            validate_run(run, repository)
        except ValueError:
            continue
        artifacts = api(f"{prefix}/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
        matches = [artifact for artifact in artifacts
                   if artifact["name"] == "static-dashboard" and not artifact["expired"]]
        if len(matches) == 1:
            return run
    raise ValueError("No complete data artifact from a successful nightly; leaving Pages unchanged")


def github_api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


if __name__ == "__main__":
    run = select_run(github_api, os.environ["GITHUB_REPOSITORY"], os.environ.get("DATA_RUN_ID", ""))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"run_id={run['id']}\nhead_sha={run['head_sha']}\nrun_attempt={run['run_attempt']}\n")
