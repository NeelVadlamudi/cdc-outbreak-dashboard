"""Open a GitHub issue for each alert in status.json (label nightly-alert). Comments instead if one is already open."""

import argparse
import json
import os
import urllib.request
from pathlib import Path

LABEL = "nightly-alert"


def api(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}{path}",
        method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
                 "Accept": "application/vnd.github+json", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("status", type=Path)
    args = ap.parse_args()
    status = json.loads(args.status.read_text())
    alerts = status.get("alerts", [])
    if not alerts:
        print("no alerts")
        return
    try:
        api("POST", "/labels", {"name": LABEL, "color": "d93f0b", "description": "Raised by the nightly run"})
    except urllib.error.HTTPError as e:
        if e.code != 422:  # 422 = label already exists
            raise
    open_titles = {i["title"]: i["number"] for i in api("GET", f"/issues?state=open&labels={LABEL}&per_page=100")}
    run = status["run"]
    footer = f"\n\nNightly run: {run.get('url') or 'n/a'}\nResult: {run['result']}\nstatus.json generated at {status['generated_at']}"
    for a in alerts:
        body = a["detail"] + footer
        if a["title"] in open_titles:
            api("POST", f"/issues/{open_titles[a['title']]}/comments", {"body": "Still happening. " + body})
            print(f"commented on #{open_titles[a['title']]}: {a['title']}")
        else:
            issue = api("POST", "/issues", {"title": a["title"], "body": body, "labels": [LABEL]})
            print(f"opened #{issue['number']}: {a['title']}")


if __name__ == "__main__":
    main()
