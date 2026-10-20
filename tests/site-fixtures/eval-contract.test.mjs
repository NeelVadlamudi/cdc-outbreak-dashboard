// Run: node --test tests/site-fixtures/   Checks the EXAMPLE eval fixture uses exactly the
// evals/run_evals.py summarize() keys (PR #2, lines 185-191 + token medians).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUN_EVALS_KEYS = ["questions", "numeric_accuracy", "tool_choice", "correct_refusals", "false_refusals",
  "grounded_answers", "median_s", "p95_s", "median_input_tokens", "median_output_tokens"];
const RATES = ["numeric_accuracy", "tool_choice", "correct_refusals", "false_refusals", "grounded_answers"];
const fx = JSON.parse(readFileSync(new URL("./eval.json", import.meta.url)));
const js = readFileSync(new URL("../../site/assets/site.js", import.meta.url), "utf8");

test("fixture is EXAMPLE", () => assert.match(fx._label, /^EXAMPLE/));
test("summary keys match run_evals.py exactly", () => {
  for (const r of fx.runs) assert.deepEqual(Object.keys(r.summary).sort(), [...RUN_EVALS_KEYS].sort());
});
test("rates are 0-100 with at most 1 decimal, or null", () => {
  for (const r of fx.runs) for (const k of RATES) {
    const v = r.summary[k];
    if (v === null) continue;
    assert.ok(v >= 0 && v <= 100, k);
    assert.equal(Math.round(v * 10) / 10, v, k);
  }
});
test("site.js eval columns use exactly these keys, no checker column", () => {
  const block = js.slice(js.indexOf("const EVAL_COLS"), js.indexOf("];", js.indexOf("const EVAL_COLS")));
  const keys = [...block.matchAll(/\["([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, RUN_EVALS_KEYS);
  assert.ok(!/checker_catches/.test(js));
});
