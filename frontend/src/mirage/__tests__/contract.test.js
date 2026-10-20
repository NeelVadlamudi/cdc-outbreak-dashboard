// Run: node --test src/mirage/__tests__/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { decisionRequest, canDecide, isDemo, actionLabel, decisionError, proposalsPath, auditLogPath, PENDING } from "../contract.js";

test("paths match backend/mirage_routes.py", () => {
  assert.equal(proposalsPath(PENDING), "/mirage/proposals?status=waiting%20for%20approval");
  assert.equal(auditLogPath(1), "/mirage/audit-log?proposal_id=1");
  assert.equal(auditLogPath(), "/mirage/audit-log");
});
test("decision request: header key, decided_by, optional note", () => {
  const r = decisionRequest(2, "approve", { key: "k-typed-at-runtime", decidedBy: " EXAMPLE name ", note: "" });
  assert.equal(r.path, "/proposals/2/approve");
  assert.equal(r.init.method, "POST");
  assert.equal(r.init.headers["X-API-Key"], "k-typed-at-runtime");
  assert.deepEqual(JSON.parse(r.init.body), { decided_by: "EXAMPLE name" });
  assert.deepEqual(JSON.parse(decisionRequest(2, "reject", { key: "k", decidedBy: "x", note: " n " }).init.body), { decided_by: "x", note: "n" });
  assert.throws(() => decisionRequest(2, "delete", { key: "k", decidedBy: "x" }));
  assert.throws(() => decisionRequest("2", "approve", { key: "k", decidedBy: "x" }));
});
test("only waiting proposals can be decided", () => {
  assert.equal(canDecide({ status: "waiting for approval" }), true);
  assert.equal(canDecide({ status: "approved" }), false);
  assert.equal(canDecide({ status: "rejected" }), false);
});
test("Demo reviewer and labels", () => {
  assert.equal(isDemo("Demo reviewer"), true);
  assert.equal(isDemo("EXAMPLE person"), false);
  assert.deepEqual(["recount", "pull_to_floor", "reorder"].map(actionLabel), ["Recount", "Pull to floor", "Reorder"]);
});
test("API errors from §7", () => {
  assert.match(decisionError(401), /admin key/);
  assert.match(decisionError(409, "proposal 1 is already approved"), /already decided.*proposal 1 is already approved/);
  assert.match(decisionError(503), /ADMIN_API_KEY is not set/);
  assert.match(decisionError(422), /name/);
  assert.match(decisionError(404), /No such proposal/);
});
test("no key is read from env or persisted anywhere in src", () => {
  const files = ["../../pages/MirageReview.jsx", "../../api.js", "../contract.js"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8"));
  for (const s of files) {
    assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(s));
    assert.ok(!/VITE_[A-Z_]*KEY|ADMIN_API_KEY\s*[=:]/.test(s));
  }
});
test("built bundle has no admin key env and no storage of it", () => {
  let dir; try { dir = readdirSync(new URL("../../../dist/assets/", import.meta.url)); } catch { return; }
  for (const f of dir.filter((f) => f.endsWith(".js"))) {
    const s = readFileSync(new URL(`../../../dist/assets/${f}`, import.meta.url), "utf8");
    assert.ok(!/VITE_[A-Z_]*KEY/.test(s), f);
  }
});
