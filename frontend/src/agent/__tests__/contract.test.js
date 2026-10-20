// Run: node --test src/agent/__tests__/   (uses the EXAMPLE fixture; never shipped)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adaptAskResponse, formatDuration, formatInputs } from "../contract.js";

const FX = JSON.parse(readFileSync(new URL("./ask.fixture.EXAMPLE.json", import.meta.url)));

test("fixture is labelled EXAMPLE", () => assert.match(FX._label, /^EXAMPLE/));

test("adapts the ok response", () => {
  const r = adaptAskResponse(FX.ok);
  assert.equal(r.status, "ok");
  assert.equal(r.toolCalls.length, 2);
  assert.deepEqual(r.toolCalls[0], { tool: "EXAMPLE_query_tool", inputs: { virus: "EXAMPLE", state: "EX" }, rows: 3, ms: 120 });
  assert.equal(r.toolCalls[1].rows, null); // optional rows stays null, never invented
  assert.equal(formatDuration(r.elapsedMs), "1.4 s");
});

test("detects refusal / could-not-verify", () => {
  assert.equal(adaptAskResponse(FX.refusal).status, "unverified");
  assert.equal(adaptAskResponse({ ...FX.ok, answer: "I can't answer that." }).status, "refused");
  assert.equal(adaptAskResponse({ ...FX.ok, status: "unverified" }).status, "unverified");
});

test("rejects empty response", () => assert.throws(() => adaptAskResponse(null)));

test("durations: two largest units, zeros dropped", () => {
  assert.equal(formatDuration(125000), "2 min 5 s");
  assert.equal(formatDuration(120000), "2 min");
  assert.equal(formatDuration(3600000 + 5000), "1 h 5 s");
  assert.equal(formatDuration(3723000), "1 h 2 min");
  assert.equal(formatDuration(850), "850 ms");
  assert.equal(formatDuration(59960), "1 min");
  assert.equal(formatDuration(undefined), null);
});

test("formats inputs", () => assert.equal(formatInputs({ a: 1, b: "x" }), "a=1, b=x"));
