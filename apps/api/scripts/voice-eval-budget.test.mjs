import { it as test } from "vitest";
import assert from "node:assert/strict";
import { reserveVoiceEval, validateLunaRequest, voiceEvalRunPaths } from "./voice-eval-budget.mjs";

test("candidate revisions share the original budget and exclusive lock", () => {
  const original = voiceEvalRunPaths("fixture");
  const revision = voiceEvalRunPaths("fixture", "fix-1");
  assert.equal(revision.ledger, original.ledger);
  assert.equal(revision.lock, original.lock);
  assert.notEqual(revision.output, original.output);
  assert.equal(revision.reservationPrefix, "fix-1/");
  for (const name of ["../other", "a/b", "a\\b", ".", "A", "x".repeat(65)]) {
    assert.throws(() => voiceEvalRunPaths("fixture", name), /INVALID_REVISION/);
  }
  const past = reserveVoiceEval([], "original", "responses", 4_990_000, 5_000_000);
  assert.throws(() => reserveVoiceEval([past], revision.reservationPrefix + "new", "responses", 20_000, 5_000_000), /BUDGET_EXHAUSTED/);
});

test("reservations survive unknown outcomes and cannot exceed the user's five dollars", () => {
  const first = reserveVoiceEval([], "a", "responses", 4_990_000, 5_000_000);
  assert.throws(() => reserveVoiceEval([first], "b", "live", 20_000, 5_000_000), /BUDGET_EXHAUSTED/);
  assert.equal(reserveVoiceEval([first], "b", "responses", 10_000, 5_000_000).reservedMicros, 10_000);
  assert.throws(() => reserveVoiceEval([first], "a", "responses", 1, 5_000_000), /ALREADY_EXISTS/);
});
test("rejects unsafe budgets and corrupt ledgers before provider work", () => {
  for (const n of [NaN, Infinity, 0, -1, 5_000_001, 1.5]) assert.throws(() => reserveVoiceEval([], "a", "live", 1, n));
  for (const n of [NaN, Infinity, 0, -1, 1.5]) assert.throws(() => reserveVoiceEval([], "a", "live", n, 5_000_000));
  assert.throws(() => reserveVoiceEval([{ id: "old", reservedMicros: -1 }], "a", "live", 1, 5_000_000));
});
test("Luna requests have bounded tokens, bytes and no paid hosted tools", () => {
  const body = { model: "gpt-6-luna", max_output_tokens: 512, service_tier: "default", store: false, tools: [{ type: "function" }] };
  validateLunaRequest(body);
  for (const patch of [{ model: "other" }, { max_output_tokens: 10000 }, { service_tier: "priority" },
    { store: true }, { tools: [{ type: "web_search" }] }, { input: "x".repeat(50_000) }]) {
    assert.throws(() => validateLunaRequest({ ...body, ...patch }), /UNBOUNDED_MODEL_REQUEST/);
  }
});
