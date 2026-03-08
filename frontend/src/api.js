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
export const trainModel = (virus) => fetchAPI(`/forecast/train/${encodeURIComponent(virus)}`, { method: "POST" });
export const getStates = () => fetchAPI("/states");
export const getSites = () => fetchAPI("/hospitalizations/sites");

// ─── Phase 2A: Wastewater ────────────────────────────────────────────
export const getWastewater = (params = "") => fetchAPI(`/wastewater?${params}`);
export const getWastewaterLatest = () => fetchAPI("/wastewater/latest");
export const getWastewaterCounty = (fips) => fetchAPI(`/wastewater/county/${fips}`);
export const getWastewaterStates = () => fetchAPI("/wastewater/states");

// ─── Phase 2B: Ensemble AI ──────────────────────────────────────────
export const getEnsembleForecast = (virus) => fetchAPI(`/ensemble/forecast/${encodeURIComponent(virus)}`);
export const trainXGBoost = (virus) => fetchAPI(`/ensemble/train/${encodeURIComponent(virus)}`, { method: "POST" });
export const compareModels = (virus) => fetchAPI(`/ensemble/compare/${encodeURIComponent(virus)}`);
export const getAnomalies = () => fetchAPI("/anomalies");
export const getAgeHeatmap = (network) => fetchAPI(`/age-heatmap/${encodeURIComponent(network)}`);
export const getSeasonComparison = () => fetchAPI("/season-comparison");

// ─── Phase 2C: LLM Chat ─────────────────────────────────────────────
export const chatWithData = (question) =>
  fetchAPI("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
export const getWeeklyBrief = () => fetchAPI("/weekly-brief");

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
