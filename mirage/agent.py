"""Run the audit agent: the same agent loop and number checker as the CDC agent, with the Mirage tools."""

from pathlib import Path

from backend.agent.graph import run_agent
from mirage import tools

PROMPT_VERSION = "audit_v1"
SYSTEM_PROMPT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text()


def run_audit(question: str, model=None, setting: str | None = None) -> dict:
    result = run_agent(question, model=model, setting=setting, toolset=tools.AuditToolset(), system_prompt=SYSTEM_PROMPT,
                       prompt_version=PROMPT_VERSION, check_freshness=False)
    result["proposals"] = [row for t in result["tool_calls"] if t["tool"] == "propose_action"
                           for row in t["output"].get("rows", [])]
    return result
