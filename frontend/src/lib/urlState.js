/**
 * Tiny helpers so view state can live in the URL (shareable sitrep links).
 * Missing/invalid params fall back to defaults — never invent data.
 */

export function readSearchParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function writeSearchParams(mutator, { replace = true } = {}) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  mutator(params);
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
  if (next === current) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", next);
}

export function getParam(key, fallback = "") {
  const v = readSearchParams().get(key);
  return v == null || v === "" ? fallback : v;
}

export function setParams(entries, opts) {
  writeSearchParams((params) => {
    Object.entries(entries).forEach(([k, v]) => {
      if (v == null || v === "") params.delete(k);
      else params.set(k, String(v));
    });
  }, opts);
}
