import { ANSWERING_POLICY_VERSION, answeredBySchema, answeringMode, decideAnswering, type AnsweringState, type AnsweringDecision } from "@callassist/contracts";
import type { CallAttemptRecord } from "../storage/call-repository";

export type AnsweringTransitionInput = {
  attemptId: string; providerCallId: string; snapshotHash: string;
  kind: "bind" | "resolve" | "complete" | "admit" | "timeout";
  answeredBy?: string; durationMs?: number; now: string;
};
export type AnsweringTransitionResult = { state: AnsweringState | null; decision: AnsweringDecision; applied: boolean };

/** Invoked under the repository's call lock. No IO and no model decisions. */
export function transitionAnswering(attempt: CallAttemptRecord, current: AnsweringState | null, input: AnsweringTransitionInput, active: boolean): AnsweringTransitionResult {
  const deny: AnsweringTransitionResult = { state: current, decision: "hang_up", applied: false };
  const snapshot = attempt.executionSnapshot;
  if (attempt.id !== input.attemptId || attempt.compilationSnapshotHash !== input.snapshotHash ||
      (attempt.providerCallId && attempt.providerCallId !== input.providerCallId) ||
      attempt.provider !== "twilio" || snapshot?.version !== 3) return deny;
  if (input.kind === "bind") {
    if (!active && attempt.providerCallId !== input.providerCallId) return deny;
    return { applied: true, decision: "hang_up", state: current ?? {
      policyVersion: ANSWERING_POLICY_VERSION, phase: "pending", mode: answeringMode(snapshot.answering.action),
      answeredBy: null, decision: null, streamAdmitted: false, observedAt: input.now, durationMs: null,
      message: snapshot.answering.action === "hang_up" ? "not_requested" : "not_attempted", failure: null
    } };
  }
  if (input.kind === "complete") {
    if (current?.message !== "issued" && current?.message !== "unknown") return deny;
    return { applied: true, decision: "hang_up", state: { ...current, message: "playback_completed", observedAt: input.now } };
  }
  if (!active || attempt.endedAt) return deny;
  if (input.kind === "admit") {
    if (current?.decision !== "consent" || current.streamAdmitted) return deny;
    return { applied: true, decision: "consent", state: { ...current, streamAdmitted: true, observedAt: input.now } };
  }
  if (current && current.phase !== "pending" && !(input.kind === "timeout" && current.decision === "consent" && !current.streamAdmitted)) return deny;
  const parsed = answeredBySchema.safeParse(input.answeredBy);
  const answer = parsed.success ? parsed.data : null;
  const mode = answeringMode(snapshot.answering.action);
  const compatible = answer === "human" || answer === "unknown" || answer === "fax" ||
    (mode === "Enable" ? answer === "machine_start" : answer?.startsWith("machine_end_"));
  const failure = input.kind === "timeout" ? "timeout" : !answer || !compatible ? "invalid_result" : null;
  const decision = failure ? "hang_up" : decideAnswering(snapshot.answering.action, answer);
  return { applied: true, decision, state: {
    policyVersion: ANSWERING_POLICY_VERSION, phase: failure ? "failed" : "resolved", mode,
    answeredBy: answer, decision, streamAdmitted: false, observedAt: input.now,
    durationMs: Number.isInteger(input.durationMs) && input.durationMs! >= 0 && input.durationMs! <= 120_000 ? input.durationMs! : null,
    message: decision === "message" ? "issued" : snapshot.answering.action === "hang_up" ? "not_requested" : "not_attempted", failure
  } };
}
