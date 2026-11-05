/**
 * API client for CDC Outbreak Dashboard.
 * Ask answers go through the grounded agent only (POST /api/agent/ask).
 */

import { ASK_ENDPOINT, adaptAskResponse, type AdaptedAskResponse } from "./agent/contract";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const RENDER_SPLASH = /Application loading|waking up|Start building on Render/i;

function looksLikeColdStart(status: number, raw: string, contentType: string | null): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  if (contentType && !contentType.includes("application/json") && RENDER_SPLASH.test(raw)) return true;
  return RENDER_SPLASH.test(raw.slice(0, 800));
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function detailFromBody(raw: string): string {
  try {
    const detail = JSON.parse(raw)?.detail;
    if (typeof detail === "string") return detail.trim();
    if (detail && typeof detail === "object" && typeof detail.message === "string") {
      return detail.message.trim();
    }
  } catch {
    /* non-JSON */
  }
  return "";
}

/**
 * Shared fetch with free-tier cold-start retries so Overview/sources do not
 * surface a bare 502/HTML splash as if the product were broken.
 */
async function fetchAPI(endpoint: string, options: RequestInit = {}): Promise<unknown> {
  const maxAttempts = 3;
  const signal = options.signal ?? undefined;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${endpoint}`, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts && !signal?.aborted) {
        await sleep(2500 * attempt, signal);
        continue;
      }
      throw new Error(
        "Couldn't reach the data API. It may be waking up — wait ~30s and retry.",
      );
    }

    const contentType = res.headers.get("content-type");
    const raw = await res.text();
    const cold = looksLikeColdStart(res.status, raw, contentType);

    if (cold) {
      if (attempt < maxAttempts && !signal?.aborted) {
        await sleep(4000 * attempt, signal);
        continue;
      }
      throw new Error(
        "The data API is waking up after idle time. Wait about 30–60 seconds, then retry.",
      );
    }

    if (!res.ok) {
      const detailText = detailFromBody(raw);
      throw new Error(
        detailText
          ? `API error ${res.status}: ${detailText}`
          : `API error: ${res.status}`,
      );
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("The API returned a non-JSON body. Retry in a moment.");
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}

export const getDashboardSummary = () => fetchAPI("/dashboard-summary");
export const getAriActivity = (params = "") =>
  fetchAPI(`/ari-activity${params ? "?" + params : ""}`);
export const getAriHistory = (state: string) =>
  fetchAPI(`/ari-activity/history?geography=${encodeURIComponent(state)}`);
export const getHospitalizations = (params = "") => fetchAPI(`/hospitalizations?${params}`);
export const getHospTrends = () => fetchAPI("/hospitalizations/trends");
export const getTestPositivity = (params = "") => fetchAPI(`/test-positivity?${params}`);
export const getLatestPositivity = () => fetchAPI("/test-positivity/latest");
export const getForecast = (virus: string) => fetchAPI(`/forecast/${encodeURIComponent(virus)}`);
export const getStates = () => fetchAPI("/states");
export const getSites = () => fetchAPI("/hospitalizations/sites");
export const getHealth = () => fetchAPI("/health");
export const getSources = () => fetchAPI("/sources");

export const getWastewater = (params = "") => fetchAPI(`/wastewater?${params}`);
export const getWastewaterLatest = (pathogen = "SARS-CoV-2") =>
  fetchAPI(`/wastewater/latest?pathogen=${encodeURIComponent(pathogen)}`);
export const getWastewaterCounty = (fips: string) => fetchAPI(`/wastewater/county/${fips}`);
export const getWastewaterStates = (pathogen = "SARS-CoV-2") =>
  fetchAPI(`/wastewater/states?pathogen=${encodeURIComponent(pathogen)}`);

export const getEnsembleForecast = (virus: string) =>
  fetchAPI(`/ensemble/forecast/${encodeURIComponent(virus)}`);
export const compareModels = (virus: string) =>
  fetchAPI(`/ensemble/compare/${encodeURIComponent(virus)}`);
export const getAnomalies = () => fetchAPI("/anomalies");
export const getAgeHeatmap = (network: string) =>
  fetchAPI(`/age-heatmap/${encodeURIComponent(network)}`);
export const getSeasonComparison = () => fetchAPI("/season-comparison");

export async function askAgent(
  question: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<AdaptedAskResponse> {
  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${ASK_ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal,
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts && !signal?.aborted) {
        await sleep(2500 * attempt, signal);
        continue;
      }
      throw new Error(
        "Couldn't reach the live API. It may be waking up — wait ~30s and retry.",
      );
    }

    const contentType = res.headers.get("content-type");
    const raw = await res.text();
    const cold = looksLikeColdStart(res.status, raw, contentType);

    if (!res.ok || cold) {
      const detailText = detailFromBody(raw);
      if (cold && attempt < maxAttempts && !signal?.aborted) {
        await sleep(4000 * attempt, signal);
        continue;
      }
      if (cold) {
        throw new Error(
          "The Ask service is waking up after idle time. Wait about 30–60 seconds, then retry.",
        );
      }
      throw new Error(
        detailText
          ? `Please try again in a moment. (${detailText})`
          : `Please try again in a moment. (service status ${res.status})`,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error("The API returned a non-JSON body. Retry in a moment.");
    }
    return adaptAskResponse(body as Parameters<typeof adaptAskResponse>[0]);
  }

  throw lastError ?? new Error("Ask failed after retries");
}

export const runSimulator = (params: Record<string, unknown>) =>
  fetchAPI("/simulator/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
export const getSimDefaults = () => fetchAPI("/simulator/defaults");
