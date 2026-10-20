/**
 * Mirage review API (site/DATA_CONTRACT.md §7, backend/mirage_routes.py).
 *   GET  /api/mirage/proposals?status=waiting for approval -> { proposals: [...] }
 *   GET  /api/mirage/audit-log[?proposal_id=N]             -> { audit_log: [...] }
 *   POST /api/proposals/{id}/approve | /reject
 *        header X-API-Key, body { decided_by, note? }       -> 200 { proposal, audit: [...] }
 * The admin key is typed in at runtime and passed per request. It is never read from env,
 * never written to browser storage or cookies, and never bundled.
 */
export const PENDING = "waiting for approval";
export const DEMO_REVIEWER = "Demo reviewer";
export const ACTIONS = { recount: "Recount", pull_to_floor: "Pull to floor", reorder: "Reorder" };

export const proposalsPath = (status) => `/mirage/proposals${status ? `?status=${encodeURIComponent(status)}` : ""}`;
export const auditLogPath = (proposalId) => `/mirage/audit-log${proposalId != null ? `?proposal_id=${encodeURIComponent(proposalId)}` : ""}`;

export function decisionRequest(id, decision, { key, decidedBy, note }) {
  if (decision !== "approve" && decision !== "reject") throw new Error("decision must be approve or reject");
  if (!Number.isInteger(id)) throw new Error("proposal id must be an integer");
  const body = { decided_by: (decidedBy ?? "").trim() };
  if (note && note.trim()) body.note = note.trim();
  return {
    path: `/proposals/${id}/${decision}`,
    init: { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": key ?? "" }, body: JSON.stringify(body) },
  };
}

export const canDecide = (p) => !!p && p.status === PENDING;
export const isDemo = (name) => name === DEMO_REVIEWER;
export const actionLabel = (a) => (a == null ? null : ACTIONS[a] || String(a));

const ERRORS = {
  401: "Missing or wrong admin key.",
  404: "No such proposal.",
  409: "This proposal was already decided. Decisions are final.",
  422: "Enter the name of the person deciding.",
  503: "Approvals are off: ADMIN_API_KEY is not set on the server.",
};
export function decisionError(status, detail) {
  const base = ERRORS[status] || `The API returned ${status}.`;
  return detail && typeof detail === "string" && !base.includes(detail) ? `${base} (${detail})` : base;
}
