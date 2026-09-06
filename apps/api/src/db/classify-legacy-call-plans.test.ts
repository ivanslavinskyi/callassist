import { describe, expect, it } from "vitest";
import {
  assertLegacyCallPlanClassificationConfirmation,
  legacyCallPlanClassificationConfirmation,
  legacyCallPlanClassificationErrorCode,
  parseLegacyCallPlanClassificationBatchSize,
  parseLegacyCallPlanClassificationMode
} from "./classify-legacy-call-plans";

describe("legacy call-plan classification command boundary", () => {
  it("defaults to a read-only dry run and accepts only explicit execution", () => {
    expect(parseLegacyCallPlanClassificationMode([])).toBe("dry_run");
    expect(parseLegacyCallPlanClassificationMode(["--execute"]))
      .toBe("execute");
    expect(parseLegacyCallPlanClassificationMode(["--", "--execute"]))
      .toBe("execute");
    expect(() => parseLegacyCallPlanClassificationMode(["--dry-run"]))
      .toThrow("accepts only --execute");
  });

  it("requires the exact destructive-operation confirmation", () => {
    expect(() => assertLegacyCallPlanClassificationConfirmation(
      legacyCallPlanClassificationConfirmation
    )).not.toThrow();
    expect(() => assertLegacyCallPlanClassificationConfirmation(undefined))
      .toThrow("must explicitly confirm");
    expect(() => assertLegacyCallPlanClassificationConfirmation("yes"))
      .toThrow("must explicitly confirm");
  });

  it("bounds each classification batch", () => {
    expect(parseLegacyCallPlanClassificationBatchSize(undefined)).toBe(100);
    expect(parseLegacyCallPlanClassificationBatchSize("1")).toBe(1);
    expect(parseLegacyCallPlanClassificationBatchSize("500")).toBe(500);
    expect(() => parseLegacyCallPlanClassificationBatchSize("0"))
      .toThrow("1..500");
    expect(() => parseLegacyCallPlanClassificationBatchSize("501"))
      .toThrow("1..500");
  });

  it("maps precondition failures to bounded codes", () => {
    expect(legacyCallPlanClassificationErrorCode(
      new Error("Valid legacy compilations remain; run backfill first")
    )).toBe("LEGACY_CALL_PLAN_BACKFILL_REQUIRED");
    expect(legacyCallPlanClassificationErrorCode(
      new Error("Active recompilations prevent legacy classification")
    )).toBe("LEGACY_CALL_PLAN_RECOMPILATION_ACTIVE");
    expect(legacyCallPlanClassificationErrorCode(new Error("private data")))
      .toBe("LEGACY_CALL_PLAN_CLASSIFICATION_FAILED");
  });
});
