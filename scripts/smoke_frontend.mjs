#!/usr/bin/env node
/**
 * Minimal frontend smoke (no Playwright dependency).
 * - Loads the typed agent contract and adapts a fixture-shaped response
 * - Optionally checks dist/ after build (SMOKE_REQUIRE_DIST=1)
 * - Optionally hits live API (SMOKE_API_URL) for /health status + as_of
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(root, "frontend");

// Dynamic import via tsx when available; otherwise skip contract if not built.
let adaptAskResponse;
try {
  ({ adaptAskResponse } = await import(join(frontend, "src/agent/contract.ts")));
} catch {
  console.log("contract.ts import needs tsx; run via npm run smoke from frontend/");
  process.exitCode = 0;
}

if (adaptAskResponse) {
  const adapted = adaptAskResponse({
    status: "answered",
    answer: "COVID-19 test positivity was 3.6%.",
    as_of: "2026-10-10",
    elapsed_s: 1.4,
    model: "smoke",
    checker: { passed: true, unverified: [], stale_tables: [] },
    tool_calls: [
      {
        tool: "get_test_positivity",
        inputs: { pathogen: "COVID-19" },
        rows_returned: 1,
        elapsed_s: 0.1,
        output: {
          as_of: "2026-10-10",
          source_table: "test_positivity",
          rows: [{ percent_positive: 3.6 }],
        },
      },
    ],
  });
  assert.equal(adapted.status, "answered");
  assert.equal(adapted.asOf, "2026-10-10");
  assert.equal(adapted.toolCalls.length, 1);
  assert.equal(adapted.toolCalls[0].tool, "get_test_positivity");
  console.log("contract smoke ok");
}

const distIndex = join(frontend, "dist", "index.html");
if (process.env.SMOKE_REQUIRE_DIST === "1") {
  assert.ok(existsSync(distIndex), "frontend/dist/index.html missing — run npm run build first");
  const html = readFileSync(distIndex, "utf8");
  assert.match(html, /<div id="root">/);
  console.log("dist smoke ok");
} else if (existsSync(distIndex)) {
  console.log("dist present (optional check skipped)");
}

const api = process.env.SMOKE_API_URL;
if (api) {
  const res = await fetch(`${api.replace(/\/$/, "")}/health`);
  assert.ok(res.ok, `health HTTP ${res.status}`);
  const body = await res.json();
  assert.ok(body.as_of || body.latest_week, "health missing as_of");
  assert.ok(Array.isArray(body.tables), "health missing tables[]");
  console.log("api health smoke ok", body.as_of || body.latest_week);
}

console.log("smoke_frontend done");
