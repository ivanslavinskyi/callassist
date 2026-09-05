import { describe, expect, it } from "vitest";
import type { AdminSystemFacts } from "../storage/call-repository";
import {
  callPlanCutoverVerificationErrorCode,
  evaluateCallPlanCutoverGate
} from "./verify-call-plan-cutover";

const facts: AdminSystemFacts["callPlanCutover"] = {
  recoverableLegacyCalls: 0,
  archivedLegacyCalls: 6,
  recompileRequiredCalls: 2,
  unavailableLegacyCalls: 15,
  executableLegacyCalls: 0,
  historicalAttemptsWithoutCompilation: 28,
  historicalAttemptsWithoutExecutionSnapshot: 28,
  activeLegacyAttempts: 0,
  activeRecompilations: 0
};

describe("call-plan cutover release gate", () => {
  it("allows historical limitations and explicitly disposed records", () => {
    expect(evaluateCallPlanCutoverGate(facts)).toEqual({
      ready: true,
      blockers: []
    });
  });

  it("reports every active execution or maintenance blocker", () => {
    expect(evaluateCallPlanCutoverGate({
      ...facts,
      recoverableLegacyCalls: 1,
      executableLegacyCalls: 2,
      activeLegacyAttempts: 3,
      activeRecompilations: 4
    })).toEqual({
      ready: false,
      blockers: [
        "recoverable_legacy_calls",
        "executable_legacy_calls",
        "active_legacy_attempts",
        "active_recompilations"
      ]
    });
  });

  it("returns only bounded command failure codes", () => {
    expect(callPlanCutoverVerificationErrorCode(new Error("private text")))
      .toBe("CALL_PLAN_CUTOVER_VERIFICATION_FAILED");
  });
});
