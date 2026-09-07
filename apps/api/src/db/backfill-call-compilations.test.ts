import { describe, expect, it } from "vitest";
import {
  assertCallCompilationBackfillConfirmation,
  callCompilationBackfillErrorCode,
  callCompilationBackfillConfirmation,
  parseCallCompilationBackfillBatchSize,
  parseCallCompilationBackfillMode
} from "./backfill-call-compilations";
import { CallRepositoryError } from "../storage/call-repository";

describe("call compilation backfill command boundary", () => {
  it("defaults to a read-only dry run and requires the explicit execute flag", () => {
    expect(parseCallCompilationBackfillMode([])).toBe("dry_run");
    expect(parseCallCompilationBackfillMode(["--execute"])).toBe("execute");
    expect(parseCallCompilationBackfillMode(["--", "--execute"]))
      .toBe("execute");
    expect(() => parseCallCompilationBackfillMode(["--dry-run"]))
      .toThrow("accepts only --execute");
  });

  it("requires the exact destructive-operation confirmation", () => {
    expect(() => assertCallCompilationBackfillConfirmation(
      callCompilationBackfillConfirmation
    )).not.toThrow();
    expect(() => assertCallCompilationBackfillConfirmation(undefined))
      .toThrow("must explicitly confirm");
    expect(() => assertCallCompilationBackfillConfirmation("yes"))
      .toThrow("must explicitly confirm");
  });

  it("bounds each committed batch", () => {
    expect(parseCallCompilationBackfillBatchSize(undefined)).toBe(100);
    expect(parseCallCompilationBackfillBatchSize("1")).toBe(1);
    expect(parseCallCompilationBackfillBatchSize("500")).toBe(500);
    expect(() => parseCallCompilationBackfillBatchSize("0"))
      .toThrow("1..500");
    expect(() => parseCallCompilationBackfillBatchSize("501"))
      .toThrow("1..500");
  });

  it("emits bounded failure codes without exception details", () => {
    expect(callCompilationBackfillErrorCode(
      new CallRepositoryError("CALL_COMPILATION_INTEGRITY_FAILED")
    )).toBe("CALL_COMPILATION_INTEGRITY_FAILED");
    expect(callCompilationBackfillErrorCode(
      new Error("CALL_EXECUTION_SNAPSHOT_NOT_APPROVED")
    )).toBe("CALL_EXECUTION_SNAPSHOT_NOT_APPROVED");
    expect(callCompilationBackfillErrorCode(new Error("private data")))
      .toBe("CALL_COMPILATION_BACKFILL_FAILED");
  });
});
