/**
 * Single adapter for POST /api/agent/ask (backend/agent/graph.py run_agent, PR #2).
 * If a backend field is renamed, change it ONLY in FIELDS below.
 *
 * Response:
 * { status: "answered"|"refused"|"unverified", answer, as_of: "YYYY-MM-DD"|null, elapsed_s,
 *   model, prompt_version, checker: { passed, unverified, stale_tables },
 *   tool_calls: [ { tool, inputs, rows_returned, elapsed_s,
 *                   output: { as_of, source_table, rows: [...], units? } } ] }
 */
export const ASK_ENDPOINT = "/agent/ask";

export const FIELDS = {
  answer: "answer",
  status: "status",
  toolCalls: "tool_calls",
  asOf: "as_of",
  elapsedS: "elapsed_s",
  model: "model",
  checker: "checker",
  call: {
    tool: "tool",
    inputs: "inputs",
    rowsReturned: "rows_returned",
    elapsedS: "elapsed_s",
    output: "output",
  },
  output: { asOf: "as_of", sourceTable: "source_table", rows: "rows", units: "units", error: "error" },
};

export const STATUSES = ["answered", "refused", "unverified"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v ? v : null);
const secToMs = (s) => (num(s) == null ? null : s * 1000);

function adaptCall(c) {
  const F = FIELDS.call, O = FIELDS.output;
  const out = c?.[F.output] && typeof c[F.output] === "object" ? c[F.output] : {};
  return {
    tool: String(c?.[F.tool] ?? "unknown"),
    inputs: c?.[F.inputs] ?? {},
    rowsReturned: num(c?.[F.rowsReturned]),
    elapsedMs: secToMs(c?.[F.elapsedS]),
    asOf: str(out[O.asOf]),
    sourceTable: str(out[O.sourceTable]),
    units: str(out[O.units]),
    rows: Array.isArray(out[O.rows]) ? out[O.rows] : null,
    error: str(out[O.error]),
  };
}

export function adaptAskResponse(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Empty response from the agent");
  const calls = Array.isArray(raw[FIELDS.toolCalls]) ? raw[FIELDS.toolCalls] : [];
  const ck = raw[FIELDS.checker] && typeof raw[FIELDS.checker] === "object" ? raw[FIELDS.checker] : null;
  return {
    answer: typeof raw[FIELDS.answer] === "string" ? raw[FIELDS.answer] : "",
    // Missing or unknown status -> "answered". No text matching.
    status: STATUSES.includes(raw[FIELDS.status]) ? raw[FIELDS.status] : "answered",
    asOf: str(raw[FIELDS.asOf]),
    elapsedMs: secToMs(raw[FIELDS.elapsedS]),
    model: str(raw[FIELDS.model]),
    staleTables: ck && Array.isArray(ck.stale_tables) ? ck.stale_tables : [],
    toolCalls: calls.map(adaptCall),
  };
}

/** Two largest non-zero units. <1 s -> "N ms"; <60 s -> one decimal "1.4 s". Input in ms. */
export function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s1 = Math.round(ms / 100) / 10;
  if (s1 < 60) return `${s1 % 1 === 0 ? s1.toFixed(0) : s1.toFixed(1)} s`;
  let rest = Math.round(ms / 1000);
  const parts = [];
  for (const [label, size] of [["d", 86400], ["h", 3600], ["min", 60], ["s", 1]]) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${label}`);
  }
  return parts.slice(0, 2).join(" ");
}

/** Same formatter for backend seconds (elapsed_s). */
export const formatSeconds = (s) => (num(s) == null ? null : formatDuration(s * 1000));

export function formatInputs(inputs) {
  if (inputs == null) return "";
  if (typeof inputs !== "object") return String(inputs);
  return Object.entries(inputs).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
}
