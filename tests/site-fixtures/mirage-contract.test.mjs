// Run: node --test tests/site-fixtures/   Mirage files, DATA_CONTRACT.md §7. Fixtures are EXAMPLE; the real
// site/data files are only read here to check they have the same shape (no values are copied).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const fx = (n) => JSON.parse(readFileSync(new URL(`./${n}.json`, import.meta.url)));
const realPath = (n) => new URL(`../../site/data/${n}.json`, import.meta.url);
const real = (n) => (existsSync(realPath(n)) ? JSON.parse(readFileSync(realPath(n))) : null);
const js = readFileSync(new URL("../../site/assets/site.js", import.meta.url), "utf8");
const keys = (o) => Object.keys(o).filter((k) => k !== "_label").sort();

const EVAL_KEYS = ["question_set", "questions", "overall_correct", "numeric_accuracy", "case_and_step", "proposal_accuracy",
  "unrequested_proposals", "tool_choice", "blocked_proposals", "correct_refusals", "false_refusals", "grounded_answers", "median_s", "p95_s"];
const PROPOSAL_KEYS = ["id", "created_at", "club", "store_id", "sku_id", "sku_name", "action", "reason", "status", "decided_by", "decided_at"];
const AUDIT_KEYS = ["id", "proposal_id", "decision", "decided_by", "decided_at", "note"];
const STEPS = ["ask", "queue", "approve_without_key", "approve", "decide_again", "audit_log"];
const ANSWER_KEYS = ["status", "answer", "tool_calls", "as_of", "elapsed_s", "model", "prompt_version", "checker", "proposals"];
const ACTIONS = ["recount", "pull_to_floor", "reorder"];
const STATUSES = ["waiting for approval", "approved", "rejected"];

for (const n of ["mirage_eval", "mirage_replay", "mirage_proposals", "mirage_audit"]) {
  test(`${n} fixture is EXAMPLE`, () => assert.match(fx(n)._label, /^EXAMPLE/));
  test(`${n} is listed in the fixture manifest`, () => assert.ok(fx("index").available.includes(n)));
}
for (const [label, get] of [["fixture", fx], ["real site/data", real]]) {
  test(`7a mirage_eval summary keys (${label})`, (t) => {
    const d = get("mirage_eval"); if (!d) return t.skip("not written");
    assert.deepEqual(keys(d), ["run_at", "runs"]);
    for (const r of d.runs) {
      assert.deepEqual(Object.keys(r.summary).sort(), [...EVAL_KEYS].sort());
      for (const k of EVAL_KEYS.filter((k) => !["question_set", "questions", "blocked_proposals", "median_s", "p95_s"].includes(k))) {
        const v = r.summary[k]; if (v === null) continue;
        assert.ok(v >= 0 && v <= 100 && Math.round(v * 10) / 10 === v, k);
      }
      assert.ok(Number.isInteger(r.summary.blocked_proposals));
    }
  });
  test(`7b mirage_replay answers (${label})`, (t) => {
    const d = get("mirage_replay"); if (!d) return t.skip("not written");
    assert.deepEqual(keys(d), ["answers", "recorded_at"]);
    for (const a of d.answers) {
      assert.deepEqual(Object.keys(a).sort(), ["correct", "id", "question", "response", "type"]);
      assert.deepEqual(Object.keys(a.response).sort(), [...ANSWER_KEYS].sort());
      for (const p of a.response.proposals) assert.deepEqual(Object.keys(p).sort(), ["action", "club", "proposal_id", "sku_id", "sku_name", "status"]);
      for (const c of a.response.tool_calls) for (const r of c.output.rows || []) if (r.next_step) assert.ok(ACTIONS.includes(r.next_step), r.next_step);
    }
  });
  test(`7d mirage_proposals (${label})`, (t) => {
    const d = get("mirage_proposals"); if (!d) return t.skip("not written");
    assert.deepEqual(keys(d), ["audit_log", "generated_at", "proposals", "second_answer", "source"]);
    for (const p of d.proposals) { assert.deepEqual(Object.keys(p).sort(), [...PROPOSAL_KEYS].sort()); assert.ok(STATUSES.includes(p.status)); assert.ok(ACTIONS.includes(p.action)); }
    for (const a of d.audit_log) assert.deepEqual(Object.keys(a).sort(), [...AUDIT_KEYS].sort());
    const sa = d.second_answer, req = ["answer", "question", "status"], opt = ["tool_calls", "proposal_id"];
    assert.ok(req.every((k) => k in sa), "second_answer required keys");
    assert.ok(Object.keys(sa).every((k) => req.includes(k) || opt.includes(k)), Object.keys(sa).join(","));
    if ("tool_calls" in sa) assert.ok(Array.isArray(sa.tool_calls));
    if ("proposal_id" in sa) assert.ok(Number.isInteger(sa.proposal_id));
  });
  test(`7c mirage_audit steps in order, placeholder key only (${label})`, (t) => {
    const d = get("mirage_audit"); if (!d) return t.skip("not written");
    assert.deepEqual(d.steps.map((s) => s.step), STEPS);
    assert.deepEqual(d.steps.filter((s) => "status_code" in s).map((s) => s.status_code), [401, 200, 409]);
    for (const s of d.steps) if (s.request.headers) assert.equal(s.request.headers["X-API-Key"], "<ADMIN_API_KEY>");
  });
}
test("static site makes no write calls and holds no key", () => {
  const fetches = [...js.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(fetches.length > 0 && fetches.every((f) => /^[`"]data\//.test(f)), fetches.join(" | "));
  assert.ok(!/method\s*:/.test(js), "no request methods");
  assert.ok(!/X-API-Key|ADMIN_API_KEY|\/api\/proposals|localStorage|sessionStorage/.test(js));
});
test("Demo reviewer gets a visible Demo label in site.js", () => {
  assert.match(js, /const DEMO = "Demo reviewer"/);
  assert.match(js, /chip demo", text: "Demo"/);
});
test("fixture second_answer exercises the optional tool_calls and proposal_id", () => {
  const sa = fx("mirage_proposals").second_answer;
  assert.ok(Array.isArray(sa.tool_calls) && sa.tool_calls.length && Number.isInteger(sa.proposal_id));
});
test("case counts carry the overlap note", () => assert.match(js, /"Categories can overlap"/));
