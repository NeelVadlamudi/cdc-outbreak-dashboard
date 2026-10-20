/**
 * Single adapter for POST /api/agent/ask.
 * If bob renames a field, change it ONLY here (FIELDS below).
 * Contract: { answer, status, tool_calls: [ {tool, inputs, rows?, ms?} ], as_of_week, elapsed_ms }
 * status: "answered" | "refused" | "unverified" (missing or unknown -> "answered")
 */
export const ASK_ENDPOINT = "/agent/ask";

export const FIELDS = {
  answer: "answer",
  status: "status",
  toolCalls: "tool_calls",
  asOfWeek: "as_of_week",
  elapsedMs: "elapsed_ms",
  call: { tool: "tool", inputs: "inputs", rows: "rows", ms: "ms" },
};

export const STATUSES = ["answered", "refused", "unverified"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function adaptAskResponse(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Empty response from the agent");
  const answer = typeof raw[FIELDS.answer] === "string" ? raw[FIELDS.answer] : "";
  const calls = Array.isArray(raw[FIELDS.toolCalls]) ? raw[FIELDS.toolCalls] : [];
  const status = STATUSES.includes(raw[FIELDS.status]) ? raw[FIELDS.status] : "answered";
  return {
    answer,
    status,
    asOfWeek: raw[FIELDS.asOfWeek] ?? null,
    elapsedMs: num(raw[FIELDS.elapsedMs]),
    toolCalls: calls.map((c) => ({
      tool: String(c?.[FIELDS.call.tool] ?? "unknown"),
      inputs: c?.[FIELDS.call.inputs] ?? {},
      rows: num(c?.[FIELDS.call.rows]),
      ms: num(c?.[FIELDS.call.ms]),
    })),
  };
}

/** Two largest non-zero units. <1 s -> "N ms"; <60 s -> one decimal "1.4 s". */
export function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) {
    const s = Math.round(ms / 100) / 10;
    if (s < 60) return `${s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)} s`;
  }
  let rest = Math.round(ms / 1000);
  const units = [["d", 86400], ["h", 3600], ["min", 60], ["s", 1]];
  const parts = [];
  for (const [label, size] of units) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${label}`);
  }
  // two largest units that are present (zeros dropped)
  return parts.slice(0, 2).join(" ");
}

export function formatInputs(inputs) {
  if (inputs == null) return "";
  if (typeof inputs !== "object") return String(inputs);
  return Object.entries(inputs).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
}
