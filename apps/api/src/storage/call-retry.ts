import { answeringResultSchema, canRepeatUnansweredCall, type CallSnapshot } from "@callassist/contracts";
import { hasValidCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { CallRepositoryError, type CallAttemptRecord } from "./call-repository";

export function assertRetryableCall(snapshot: CallSnapshot, attempt: CallAttemptRecord | null) {
  const providerStates = (snapshot.brief.lifecycle?.result === "consent_not_received" || !!snapshot.brief.lifecycle?.answering || answeringResultSchema.safeParse(snapshot.brief.lifecycle?.result).success)
    ? ["completed", "busy", "no-answer", "failed", "canceled"] : ["busy", "no-answer", "canceled", "failed"];
  if (!canRepeatUnansweredCall(snapshot.brief) || snapshot.recording || !attempt?.endedAt ||
      !providerStates.includes(attempt.providerStatus ?? "")) {
    throw new CallRepositoryError("CALL_RETRY_NOT_AVAILABLE");
  }
  if (!snapshot.compilation || snapshot.executionPlanSource !== "immutable" ||
      snapshot.compilation.policyDecision.status !== "ready_for_review" || !hasValidCompilationSnapshotHash(snapshot.compilation)) {
    throw new CallRepositoryError("CALL_COMPILATION_RECOMPILE_REQUIRED");
  }
}
