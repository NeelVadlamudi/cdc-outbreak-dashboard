"""Agent loop: a model node and a tool node, at most MAX_TOOL_CALLS tool calls."""

import json
import logging
import time
from pathlib import Path
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from backend.agent import tools as data_tools
from backend.agent.checker import UNVERIFIED_MESSAGE, check_numbers, queue_for_review
from backend.agent.models import get_chat_model, model_label

logger = logging.getLogger(__name__)

MAX_TOOL_CALLS = 6
REFUSAL_PHRASES = ("the data does not cover", "can't answer", "cannot answer", "can not answer", "out of date", "not available", "no data")
PROMPT_VERSION = "system_v1"
SYSTEM_PROMPT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text()


def langchain_tools() -> list[StructuredTool]:
    """The data tools as LangChain tools (same functions the MCP server exposes)."""
    return [
        StructuredTool.from_function(fn, name=name, description=fn.__doc__, args_schema=schema)
        for name, (fn, schema) in data_tools.TOOLS.items()
    ]


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    trace: list
    tool_calls_made: int


def build_graph(model):
    bound = model.bind_tools(langchain_tools())

    def model_node(state: AgentState):
        start = time.perf_counter()
        if state["tool_calls_made"] >= MAX_TOOL_CALLS:
            note = HumanMessage("Tool limit reached. Answer now from the tool results above.")
            msg = model.invoke(state["messages"] + [note])
        else:
            msg = bound.invoke(state["messages"])
        usage = getattr(msg, "usage_metadata", None) or {}
        logger.info("model call", extra={
            "event": "model_call", "model": getattr(model, "_label", None),
            "elapsed_s": round(time.perf_counter() - start, 3),
            "tool_calls_requested": [c["name"] for c in getattr(msg, "tool_calls", []) or []],
            "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
        })
        return {"messages": [msg]}

    def tool_node(state: AgentState):
        last = state["messages"][-1]
        messages, trace = [], list(state["trace"])
        made = state["tool_calls_made"]
        for call in last.tool_calls:
            if made >= MAX_TOOL_CALLS:
                output = {"error": "Tool limit reached."}
                elapsed = 0.0
            else:
                start = time.perf_counter()
                output = data_tools.call_tool(call["name"], call.get("args") or {})
                elapsed = time.perf_counter() - start
                made += 1
                logger.info("tool call", extra={
                    "event": "tool_call", "tool": call["name"], "inputs": call.get("args") or {},
                    "rows_returned": len(output.get("rows", [])), "error": output.get("error"),
                    "elapsed_s": round(elapsed, 3),
                })
                trace.append({
                    "tool": call["name"],
                    "inputs": call.get("args") or {},
                    "rows_returned": len(output.get("rows", [])),
                    "elapsed_s": round(elapsed, 3),
                    "output": output,
                })
            messages.append(ToolMessage(content=data_tools.dumps(output), tool_call_id=call["id"]))
        return {"messages": messages, "trace": trace, "tool_calls_made": made}

    def route(state: AgentState):
        last = state["messages"][-1]
        return "tools" if isinstance(last, AIMessage) and last.tool_calls else END

    g = StateGraph(AgentState)
    g.add_node("model", model_node)
    g.add_node("tools", tool_node)
    g.add_edge(START, "model")
    g.add_conditional_edges("model", route, {"tools": "tools", END: END})
    g.add_edge("tools", "model")
    return g.compile()


def _text(message) -> str:
    content = message.content
    if isinstance(content, list):
        return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    return str(content)


def _stale_tables(trace: list) -> list[dict]:
    used = {t["output"].get("source_table") for t in trace}
    fresh = data_tools.get_data_freshness()["rows"]
    return [r for r in fresh if r["stale"] and r["table"] in used and not r.get("legacy")]


def run_agent(question: str, model=None, setting: str | None = None) -> dict:
    start = time.perf_counter()
    model = model or get_chat_model(setting)
    graph = build_graph(model)
    state = graph.invoke(
        {
            "messages": [SystemMessage(SYSTEM_PROMPT), HumanMessage(question)],
            "trace": [],
            "tool_calls_made": 0,
        },
        {"recursion_limit": 2 * MAX_TOOL_CALLS + 4},
    )
    trace = state["trace"]
    answer = _text(state["messages"][-1]).strip()
    outputs = [t["output"] for t in trace]
    checker = check_numbers(answer, outputs, question)

    stale = _stale_tables(trace)
    if stale:
        names = ", ".join(f"{r['table']} (latest {r['latest_week']})" for r in stale)
        answer = f"Warning: this data is more than 14 days old: {names}. " + answer
    checker["stale_tables"] = [r["table"] for r in stale]

    as_of_values = [o.get("as_of") for o in outputs if o.get("as_of")]
    as_of = max(as_of_values) if as_of_values else None
    label = getattr(model, "_label", None) or model_label(setting)

    if not checker["passed"]:
        queue_for_review({"question": question, "answer": answer, "unverified": checker["unverified"],
                          "tool_calls": trace, "model": label})
        answer = UNVERIFIED_MESSAGE

    if not checker["passed"]:
        status = "unverified"
    elif stale or any(p in answer.lower() for p in REFUSAL_PHRASES):
        status = "refused"
    else:
        status = "answered"

    elapsed_total = round(time.perf_counter() - start, 3)
    logger.info("agent answer", extra={
        "event": "agent_answer", "status": status, "model": label, "tool_calls": len(trace),
        "unverified": len(checker.get("unverified", [])), "stale_tables": checker["stale_tables"],
        "elapsed_s": elapsed_total,
    })
    return {
        "status": status,
        "answer": answer,
        "tool_calls": trace,
        "as_of": as_of,
        "elapsed_s": round(time.perf_counter() - start, 3),
        "model": label,
        "prompt_version": PROMPT_VERSION,
        "checker": checker,
    }


if __name__ == "__main__":
    import sys

    print(json.dumps(run_agent(" ".join(sys.argv[1:])), indent=2, default=str))
