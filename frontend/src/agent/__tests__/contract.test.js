// Run: node --test src/agent/__tests__/   (fixtures here are test-only; never imported by shipped code)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adaptAskResponse, formatDuration, formatSeconds, formatInputs, STATUSES } from "../contract.js";

const FX = JSON.parse(readFileSync(new URL("./ask.fixture.EXAMPLE.json", import.meta.url)));
const REAL = JSON.parse(readFileSync(new URL("./agent-samples.REAL.json", import.meta.url)));

test("fixture is labelled EXAMPLE", () => assert.match(FX._label, /^EXAMPLE/));

test("adapts the answered response (PR #2 field names)", () => {
  const r = adaptAskResponse(FX.ok);
  assert.equal(r.status, "answered");
  assert.equal(r.asOf, "2000-01-01");
  assert.equal(r.elapsedMs, 1400);
  assert.equal(formatDuration(r.elapsedMs), "1.4 s");
  assert.equal(r.model, "EXAMPLE-model");
  assert.deepEqual(r.toolCalls[0], {
    tool: "EXAMPLE_query_tool", inputs: { pathogen: "EXAMPLE" }, rowsReturned: 2, elapsedMs: 120,
    asOf: "2000-01-01", sourceTable: "example_table", units: "EXAMPLE units",
    rows: FX.ok.tool_calls[0].output.rows, error: null,
  });
  // optional fields stay null, never invented
  assert.equal(r.toolCalls[1].rowsReturned, null);
  assert.equal(r.toolCalls[1].elapsedMs, null);
  assert.equal(r.toolCalls[1].units, null);
});

test("status drives refused / unverified; stale tables surface", () => {
  const ref = adaptAskResponse(FX.refused);
  assert.equal(ref.status, "refused");
  assert.equal(ref.asOf, null);
  assert.deepEqual(ref.staleTables, ["example_table"]);
  assert.equal(adaptAskResponse(FX.unverified).status, "unverified");
  assert.equal(formatDuration(adaptAskResponse(FX.unverified).elapsedMs), "2 min 5 s");
});

test("missing or unknown status falls back to answered (no text matching)", () => {
  const { status, ...noStatus } = FX.ok;
  assert.equal(status, "answered");
  assert.equal(adaptAskResponse(noStatus).status, "answered");
  assert.equal(adaptAskResponse({ ...noStatus, answer: "Could not verify that." }).status, "answered");
  assert.equal(adaptAskResponse({ ...FX.ok, status: "weird" }).status, "answered");
});

test("rejects empty response", () => assert.throws(() => adaptAskResponse(null)));

test("REAL PR #2 samples adapt with every field mapped", () => {
  assert.ok(REAL.length > 0);
  for (const { question, response } of REAL) {
    const r = adaptAskResponse(response);
    assert.ok(STATUSES.includes(response.status), question);
    assert.equal(r.status, response.status, question);
    assert.equal(r.answer, response.answer);
    assert.equal(r.asOf, response.as_of ?? null);
    assert.equal(r.elapsedMs, response.elapsed_s * 1000);
    assert.ok(formatDuration(r.elapsedMs));
    assert.equal(r.toolCalls.length, response.tool_calls.length);
    response.tool_calls.forEach((c, i) => {
      const a = r.toolCalls[i];
      assert.equal(a.tool, c.tool);
      assert.deepEqual(a.inputs, c.inputs);
      assert.equal(a.rowsReturned, c.rows_returned);
      assert.equal(a.elapsedMs, c.elapsed_s * 1000);
      assert.equal(a.sourceTable, c.output.source_table ?? null);
      assert.equal(a.units, c.output.units ?? null);
      assert.equal(a.rows, c.output.rows ?? null);
      assert.equal(a.error, c.output.error ?? null);
      assert.equal(a.rows?.length ?? 0, c.rows_returned); // backend: rows_returned = len(output.get("rows", []))
    });
  }
  // error-only output (e.g. get_wastewater with no data) maps to error, rows null
  const err = REAL.flatMap((s) => s.response.tool_calls).find((c) => c.output.error);
  if (err) assert.equal(adaptAskResponse({ tool_calls: [err] }).toolCalls[0].error, err.output.error);
  // the sample covers both answered and refused
  assert.ok(REAL.some((s) => s.response.status === "refused"));
});

test("durations: two largest units, zeros dropped", () => {
  assert.equal(formatDuration(125000), "2 min 5 s");
  assert.equal(formatDuration(120000), "2 min");
  assert.equal(formatDuration(3600000 + 5000), "1 h 5 s");
  assert.equal(formatDuration(3723000), "1 h 2 min");
  assert.equal(formatDuration(850), "850 ms");
  assert.equal(formatDuration(59960), "1 min");
  assert.equal(formatSeconds(0.013), "13 ms");
  assert.equal(formatSeconds(1.887), "1.9 s");
  assert.equal(formatDuration(undefined), null);
});

test("formats inputs", () => assert.equal(formatInputs({ a: 1, b: "x" }), "a=1, b=x"));
