/**
 * Single adapter for POST /api/agent/ask (backend/agent/graph.py run_agent).
 * If a backend field is renamed, change it ONLY in FIELDS below.
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
} as const;

export const STATUSES = ["answered", "refused", "unverified"] as const;
export type AgentStatus = (typeof STATUSES)[number];

export type AdaptedToolCall = {
  tool: string;
  inputs: Record<string, unknown>;
  rowsReturned: number | null;
  elapsedMs: number | null;
  asOf: string | null;
  sourceTable: string | null;
  units: string | null;
  rows: unknown[] | null;
  error: string | null;
};

export type AdaptedAskResponse = {
  answer: string;
  status: AgentStatus;
  asOf: string | null;
  elapsedMs: number | null;
  model: string | null;
  staleTables: string[];
  toolCalls: AdaptedToolCall[];
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;
const secToMs = (s: unknown): number | null =>
  num(s) == null ? null : (s as number) * 1000;

function adaptCall(c: Record<string, unknown> | null | undefined): AdaptedToolCall {
  const F = FIELDS.call;
  const O = FIELDS.output;
  const rawOut = c?.[F.output];
  const out = rawOut && typeof rawOut === "object" ? (rawOut as Record<string, unknown>) : {};
  return {
    tool: String(c?.[F.tool] ?? "unknown"),
    inputs: (c?.[F.inputs] as Record<string, unknown>) ?? {},
    rowsReturned: num(c?.[F.rowsReturned]),
    elapsedMs: secToMs(c?.[F.elapsedS]),
    asOf: str(out[O.asOf]),
    sourceTable: str(out[O.sourceTable]),
    units: str(out[O.units]),
    rows: Array.isArray(out[O.rows]) ? (out[O.rows] as unknown[]) : null,
    error: str(out[O.error]),
  };
}

export function adaptAskResponse(raw: unknown): AdaptedAskResponse {
  if (!raw || typeof raw !== "object") throw new Error("Empty response from the agent");
  const body = raw as Record<string, unknown>;
  const calls = Array.isArray(body[FIELDS.toolCalls])
    ? (body[FIELDS.toolCalls] as Record<string, unknown>[])
    : [];
  const ck = body[FIELDS.checker] && typeof body[FIELDS.checker] === "object"
    ? (body[FIELDS.checker] as Record<string, unknown>)
    : null;
  const statusRaw = body[FIELDS.status];
  return {
    answer: typeof body[FIELDS.answer] === "string" ? (body[FIELDS.answer] as string) : "",
    status: (STATUSES as readonly string[]).includes(statusRaw as string)
      ? (statusRaw as AgentStatus)
      : "answered",
    asOf: str(body[FIELDS.asOf]),
    elapsedMs: secToMs(body[FIELDS.elapsedS]),
    model: str(body[FIELDS.model]),
    staleTables: ck && Array.isArray(ck.stale_tables) ? (ck.stale_tables as string[]) : [],
    toolCalls: calls.map(adaptCall),
  };
}

/** Two largest non-zero units. <1 s -> "N ms"; <60 s -> one decimal "1.4 s". Input in ms. */
export function formatDuration(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s1 = Math.round(ms / 100) / 10;
  if (s1 < 60) return `${s1 % 1 === 0 ? s1.toFixed(0) : s1.toFixed(1)} s`;
  let rest = Math.round(ms / 1000);
  const parts: string[] = [];
  for (const [label, size] of [["d", 86400], ["h", 3600], ["min", 60], ["s", 1]] as const) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${label}`);
  }
  return parts.slice(0, 2).join(" ");
}

/** Same formatter for backend seconds (elapsed_s). */
export const formatSeconds = (s: unknown): string | null =>
  num(s) == null ? null : formatDuration((s as number) * 1000);

export function formatInputs(inputs: unknown): string {
  if (inputs == null) return "";
  if (typeof inputs !== "object") return String(inputs);
  return Object.entries(inputs as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(", ");
}
