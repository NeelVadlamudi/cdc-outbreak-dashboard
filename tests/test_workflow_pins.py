import re
from pathlib import Path


def test_all_workflow_actions_are_sha_pinned_with_version_comments():
    workflows = Path(__file__).resolve().parents[1] / ".github/workflows"
    found = []
    for path in workflows.glob("*.yml"):
        for line in path.read_text().splitlines():
            if not re.match(r"\s*(?:-\s*)?uses:", line):
                continue
            match = re.fullmatch(r"\s*(?:-\s*)?uses:\s+([\w./-]+)@([0-9a-f]{40})\s+#\s+(v[\w.-]+)\s*", line)
            assert match, f"Unpinned action or missing version comment in {path.name}: {line}"
            found.append(match.groups())
    assert found, "No workflow actions found"
