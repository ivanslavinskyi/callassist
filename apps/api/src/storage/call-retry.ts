import { canRepeatUnansweredCall, type CallSnapshot } from "@callassist/contracts";
import { hasValidCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { CallRepositoryError, type CallAttemptRecord } from "./call-repository";

export function assertRetryableCall(snapshot: CallSnapshot, attempt: CallAttemptRecord | null) {
  if (!canRepeatUnansweredCall(snapshot.brief) || !attempt?.endedAt ||
      !["busy", "no-answer", "canceled", "failed"].includes(attempt.providerStatus ?? "")) {
    throw new CallRepositoryError("CALL_RETRY_NOT_AVAILABLE");
  }
  if (!snapshot.compilation || snapshot.executionPlanSource !== "immutable" ||
      snapshot.compilation.policyDecision.status !== "ready_for_review" || !hasValidCompilationSnapshotHash(snapshot.compilation)) {
    throw new CallRepositoryError("CALL_COMPILATION_RECOMPILE_REQUIRED");
  }
}
