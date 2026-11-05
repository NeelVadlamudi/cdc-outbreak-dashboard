import { useState } from "react";
import { ChevronRight, Info, Wrench } from "lucide-react";
import { formatDuration, formatInputs } from "../agent/contract";

function OutputRows({ rows }) {
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return null;
  const cols = [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
  return (
    <div className="agent-output">
      <button className="agent-calls-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : "none" }} />
        {open ? "Hide" : "Show"} output rows
      </button>
      {open && (
        <div className="agent-output-scroll">
          <table className="agent-output-table">
            <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{cols.map((c) => <td key={c}>{r?.[c] == null ? "—" : String(r[c])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AgentAnswer({ result }) {
  const [open, setOpen] = useState(false);
  const flagged = result.status !== "answered";
  const took = formatDuration(result.elapsedMs);
  const n = result.toolCalls.length;
  return (
    <div className={`agent-answer${flagged ? " agent-refused" : ""}`}>
      {flagged && (
        <div className="agent-flag"><Info size={14} />
          {result.status === "unverified"
            ? "Could not fully verify this answer against the data (QA note—not a disease alert)"
            : "Could not answer from the available data"}
        </div>
      )}
      <div className="agent-text">{result.answer || "(no answer returned)"}</div>
      <div className="agent-meta">
        <span>Data week: {result.asOf ?? "not reported"}</span>
        {took && <span>Answered in {took}</span>}
        {result.toolCallCount != null && (
          <span>{result.toolCallCount} tool step{result.toolCallCount === 1 ? "" : "s"}</span>
        )}
        {result.promptVersion && <span>Prompt {result.promptVersion}</span>}
        {result.model && <span>Model {result.model}</span>}
        {(result.inputTokens != null || result.outputTokens != null) && (
          <span>
            Tokens{" "}
            {result.inputTokens != null ? `${result.inputTokens.toLocaleString()} in` : "—"}
            {" / "}
            {result.outputTokens != null ? `${result.outputTokens.toLocaleString()} out` : "—"}
          </span>
        )}
        {result.staleTables.length > 0 && (
          <span>Some sources may be behind: {result.staleTables.join(", ")}</span>
        )}
      </div>
      {n > 0 && (
        <div className="agent-calls">
          <button className="agent-calls-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : "none" }} />
            <Wrench size={13} /> {open ? "Hide" : "Show"} data sources checked ({n})
          </button>
          {open && (
            <ol className="agent-calls-list">
              {result.toolCalls.map((c, i) => (
                <li key={i}>
                  <div className="agent-call-head">
                    <code className="agent-tool">{c.tool}</code>
                    <span className="agent-inputs">{formatInputs(c.inputs) || "no inputs"}</span>
                  </div>
                  <div className="agent-rows">
                    {c.rowsReturned != null ? `${c.rowsReturned.toLocaleString()} row${c.rowsReturned === 1 ? "" : "s"} returned` : "rows not reported"}
                    {c.elapsedMs != null && ` · ${formatDuration(c.elapsedMs)}`}
                    {c.sourceTable && ` · table ${c.sourceTable}`}
                    {c.units && ` · ${c.units}`}
                    {c.error && ` · error: ${c.error}`}
                  </div>
                  <OutputRows rows={c.rows} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
