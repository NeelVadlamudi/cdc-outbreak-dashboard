import { useState } from "react";
import { ChevronRight, ShieldAlert, Wrench } from "lucide-react";
import { formatDuration, formatInputs } from "../agent/contract.js";

export default function AgentAnswer({ result }) {
  const [open, setOpen] = useState(false);
  const refused = result.status !== "answered";
  const took = formatDuration(result.elapsedMs);
  const n = result.toolCalls.length;
  return (
    <div className={`agent-answer${refused ? " agent-refused" : ""}`}>
      {refused && (
        <div className="agent-flag"><ShieldAlert size={14} />
          {result.status === "unverified" ? "Could not verify" : "Agent declined to answer"}
        </div>
      )}
      <div className="agent-text">{result.answer || "(empty answer)"}</div>
      <div className="agent-meta">
        <span>as of {result.asOfWeek ?? "unknown week"}</span>
        {took && <span>took {took}</span>}
      </div>
      {n > 0 && (
        <div className="agent-calls">
          <button className="agent-calls-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : "none" }} />
            <Wrench size={13} /> {n} tool call{n === 1 ? "" : "s"}
          </button>
          {open && (
            <ol className="agent-calls-list">
              {result.toolCalls.map((c, i) => (
                <li key={i}>
                  <code className="agent-tool">{c.tool}</code>
                  <span className="agent-inputs">{formatInputs(c.inputs) || "no inputs"}</span>
                  <span className="agent-rows">
                    {c.rows != null ? `${c.rows.toLocaleString()} row${c.rows === 1 ? "" : "s"}` : "rows not reported"}
                    {c.ms != null && ` · ${formatDuration(c.ms)}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
