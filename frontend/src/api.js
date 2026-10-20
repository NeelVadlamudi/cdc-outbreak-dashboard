/**
 * API client for CDC Outbreak Dashboard — Phase 2.
 * Includes all Phase 1 + Phase 2 endpoints (wastewater, ensemble, chat, simulator).
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

async function fetchAPI(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ─── Phase 1: Core ───────────────────────────────────────────────────
export const getDashboardSummary = () => fetchAPI("/dashboard-summary");
export const getAriActivity = (params = "") => fetchAPI(`/ari-activity${params ? "?" + params : ""}`);
export const getAriHistory = (state) => fetchAPI(`/ari-activity/history?geography=${encodeURIComponent(state)}`);
export const getHospitalizations = (params = "") => fetchAPI(`/hospitalizations?${params}`);
export const getHospTrends = () => fetchAPI("/hospitalizations/trends");
export const getTestPositivity = (params = "") => fetchAPI(`/test-positivity?${params}`);
export const getLatestPositivity = () => fetchAPI("/test-positivity/latest");
export const getForecast = (virus) => fetchAPI(`/forecast/${encodeURIComponent(virus)}`);
export const getStates = () => fetchAPI("/states");
export const getSites = () => fetchAPI("/hospitalizations/sites");

// ─── Phase 2A: Wastewater ────────────────────────────────────────────
export const getWastewater = (params = "") => fetchAPI(`/wastewater?${params}`);
export const getWastewaterLatest = (pathogen = "SARS-CoV-2") => fetchAPI(`/wastewater/latest?pathogen=${encodeURIComponent(pathogen)}`);
export const getWastewaterCounty = (fips) => fetchAPI(`/wastewater/county/${fips}`);
export const getWastewaterStates = (pathogen = "SARS-CoV-2") => fetchAPI(`/wastewater/states?pathogen=${encodeURIComponent(pathogen)}`);

// ─── Phase 2B: Ensemble models ──────────────────────────────────────────
export const getEnsembleForecast = (virus) => fetchAPI(`/ensemble/forecast/${encodeURIComponent(virus)}`);
export const compareModels = (virus) => fetchAPI(`/ensemble/compare/${encodeURIComponent(virus)}`);
export const getAnomalies = () => fetchAPI("/anomalies");
export const getAgeHeatmap = (network) => fetchAPI(`/age-heatmap/${encodeURIComponent(network)}`);
export const getSeasonComparison = () => fetchAPI("/season-comparison");

// ─── Phase 2C: Data chat ─────────────────────────────────────────────
export const chatWithData = (question) =>
  fetchAPI("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
// ─── Agent (Phase 1): field names live in ./agent/contract.js ───────
import { ASK_ENDPOINT, adaptAskResponse } from "./agent/contract.js";
export async function askAgent(question, { signal } = {}) {
  const res = await fetch(`${API_BASE}${ASK_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.detail ?? ""; } catch { /* non-JSON */ }
    throw new Error(`The agent returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return adaptAskResponse(await res.json());
}

// ─── Phase 2D: Simulator ────────────────────────────────────────────
export const runSimulator = (params) =>
  fetchAPI("/simulator/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
export const getSimDefaults = () => fetchAPI("/simulator/defaults");

// ─── SSE ─────────────────────────────────────────────────────────────
export function createEventSource(onMessage) {
  const es = new EventSource(`${API_BASE}/events/stream`);
  es.onmessage = (e) => onMessage(JSON.parse(e.data));
  es.onerror = () => es.close();
  return es;
}

// ─── Mirage review (DATA_CONTRACT.md §7). The admin key is passed in per call, never stored. ──
import { proposalsPath, auditLogPath, decisionRequest, decisionError } from "./mirage/contract.js";
export const getMirageProposals = (status) => fetchAPI(proposalsPath(status));
export const getMirageAuditLog = (proposalId) => fetchAPI(auditLogPath(proposalId));
export async function decideProposal(id, decision, { key, decidedBy, note }) {
  const { path, init } = decisionRequest(id, decision, { key, decidedBy, note });
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.detail ?? ""; } catch { /* non-JSON */ }
    throw new Error(decisionError(res.status, typeof detail === "string" ? detail : ""));
  }
  return res.json();
}
