import { describe, expect, it } from "vitest";
import { accountBudgetReservation, priceBudgetOperation, summarizeBetaSpend, type BudgetOperation, type BudgetReservation } from "./beta-spend-accounting";

const operation = (overrides: Partial<BudgetOperation> = {}): BudgetOperation => ({
  id: "operation", provider: "openai", operationType: "brief_compilation", stage: "compilation", model: "gpt-5.6-sol",
  outcome: "succeeded", costs: [], separatelyReserved: false,
  usage: { input_text_tokens: 3000, cached_input_text_tokens: 0, output_text_tokens: 400, total_tokens: 3400 }, ...overrides
});
const reservation = (overrides: Partial<BudgetReservation> = {}): BudgetReservation => ({
  key: "provider:operation", kind: "text", amount: 500_000, call: null, operations: [operation()], ...overrides
});
const call = (overrides: Partial<BudgetReservation> = {}): BudgetReservation => reservation({
  key: "call:attempt", kind: "call", amount: 4_200_000, call: { terminal: true, providerStatus: "completed" },
  operations: [
    operation({ provider: "twilio", operationType: "telephony_leg", usage: { billable_seconds: 120 }, costs: [{ component: "connectivity", amount: 360_400, currency: "USD" }] }),
    operation({ operationType: "realtime_session", usage: { duration_seconds: 100 } }),
    operation({ operationType: "realtime_response", model: "gpt-realtime-2.1", usage: {
      input_text_tokens: 1000, output_text_tokens: 100, input_audio_tokens: 500, output_audio_tokens: 1000, total_tokens: 2600
    } })
  ], ...overrides
});

describe("beta spending from provider evidence", () => {
  it("replaces a 50-cent text reserve with a 2-cent usage calculation", () => {
    expect(accountBudgetReservation(reservation())).toEqual({ reportedCostMicros: 0, usageCostMicros: 20_000, pendingReserveMicros: 0 });
  });
  it("counts charged invalid responses and cost above the original allowance", () => {
    expect(accountBudgetReservation(reservation({ amount: 10_000, operations: [operation({ outcome: "invalid_response" })] })).usageCostMicros).toBe(20_000);
  });
  it("prices free moderation as zero even when no usage is returned", () => {
    expect(accountBudgetReservation(reservation({ operations: [operation({ operationType: "brief_moderation", usage: null, outcome: null })] })).pendingReserveMicros).toBe(0);
  });
  it.each([
    operation({ outcome: "network_error", usage: null }),
    operation({ outcome: null }),
    operation({ model: "future-unpriced-model" }),
    operation({ usage: { output_text_tokens: 400 } }),
    operation({ usage: { input_text_tokens: 1000, output_text_tokens: 100, total_tokens: 1200 } }),
    operation({ usage: { input_text_tokens: 1000, cached_input_text_tokens: 800, cache_write_input_text_tokens: 800, output_text_tokens: 100 } })
  ])("keeps incomplete or uncertain provider costs reserved (%#)", op => {
    expect(priceBudgetOperation(op)).toBeNull();
    expect(accountBudgetReservation(reservation({ operations: [op] })).pendingReserveMicros).toBe(500_000);
  });
  it("preserves unlinked test requests and messaging allowances", () => {
    expect(accountBudgetReservation(reservation({ operations: [] })).pendingReserveMicros).toBe(500_000);
    expect(accountBudgetReservation(reservation({ kind: "sms", operations: [] })).pendingReserveMicros).toBe(500_000);
  });
  it("counts a completed call's connectivity and tokens plus ancillary allowance for actual billed minutes", () => {
    expect(accountBudgetReservation(call())).toEqual({ reportedCostMicros: 360_400, usageCostMicros: 86_400, pendingReserveMicros: 20_000 });
    expect(summarizeBetaSpend([call()]).reservedMicros).toBe(466_800);
  });
  it("does not release a call from local termination alone", () => {
    expect(summarizeBetaSpend([call({ call: { terminal: false, providerStatus: "in-progress" } })]).reservedMicros).toBe(4_200_000);
  });
  it.each(["missing price", "other currency", "unknown usage", "failed session", "missing session", "missing duration"])("keeps the call reserve on %s", failure => {
    const c = call();
    if (failure === "missing price") c.operations[0].costs = [];
    if (failure === "other currency") c.operations[0].costs[0].currency = "CHF";
    if (failure === "unknown usage") c.operations[2].usage = null;
    if (failure === "failed session") c.operations[1].outcome = "network_error";
    if (failure === "missing session") c.operations.splice(1, 1);
    if (failure === "missing duration") c.operations[0].usage = null;
    expect(summarizeBetaSpend([c]).reservedMicros).toBe(4_200_000);
  });
  it("does not count separately reserved final transcription twice", () => {
    const c = call(); c.operations.push(operation({ separatelyReserved: true }));
    expect(summarizeBetaSpend([c, reservation()]).reservedMicros).toBe(486_800);
  });
  it("counts late provider observations and does not cap an overrun", () => {
    const c = call({ amount: 100_000 });
    expect(summarizeBetaSpend([c]).reservedMicros).toBe(466_800);
    c.operations.push(operation());
    expect(summarizeBetaSpend([c]).reservedMicros).toBe(486_800);
  });
  it("releases an unanswered call only with provider-reported zero cost and zero duration", () => {
    const c = call({ call: { terminal: true, providerStatus: "busy" } });
    c.operations = [operation({ provider: "twilio", operationType: "telephony_leg", usage: { billable_seconds: 0 }, costs: [{ component: "connectivity", currency: "USD", amount: 0 }] })];
    expect(summarizeBetaSpend([c]).reservedMicros).toBe(0);
  });
});
