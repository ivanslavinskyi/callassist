import { describe, expect, it } from "vitest";
import { isPlanPreparationFailure } from "./plan-preparation-failure";

describe("plan preparation failure presentation", () => {
  it.each(["fact_integrity_failure", "plan_constraint_failure"] as const)("offers preparation recovery for %s", (reason) => {
    expect(isPlanPreparationFailure({ status: "blocked", reasonCodes: [reason] })).toBe(true);
  });
  it("recognizes combined integrity failures", () => {
    expect(isPlanPreparationFailure({ status: "blocked", reasonCodes: ["fact_integrity_failure", "plan_constraint_failure"] })).toBe(true);
  });
  it.each(["unsupported_task", "prohibited_content", "input_moderation_flagged", "model_refusal"] as const)("does not replace a genuine %s block with technical retry", (reason) => {
    expect(isPlanPreparationFailure({ status: "blocked", reasonCodes: [reason] })).toBe(false);
    expect(isPlanPreparationFailure({ status: "blocked", reasonCodes: ["plan_constraint_failure", reason] })).toBe(false);
  });
  it("preserves clarification and ready states, and does not guess for an unexplained block", () => {
    expect(isPlanPreparationFailure({ status: "needs_clarification", reasonCodes: ["required_information_missing"] })).toBe(false);
    expect(isPlanPreparationFailure({ status: "ready_for_review", reasonCodes: [] })).toBe(false);
    expect(isPlanPreparationFailure({ status: "blocked", reasonCodes: [] })).toBe(false);
  });
});
