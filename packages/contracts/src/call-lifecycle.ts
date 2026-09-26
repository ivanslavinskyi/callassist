import { answeringResult, answeringStateSchema, answeringResultSchema } from "./call-answering";
import { callAssessmentSummarySchema, goalAssessmentCountsSchema, emptyGoalAssessmentCounts, countGoalAssessment, type CallAssessmentRecord } from "./call-assessment";
import { z } from "zod";
import type { CallBriefStatus } from "./call-brief";
import type { DurableCallEvent } from "./call-telemetry";

export const callResultSchema = z.enum([
  "conversation_completed", "no_answer", "busy", "canceled", "consent_declined",
  "consent_not_received", "no_substantive_answer", "assessment_pending", "assessment_unavailable", "technical_failure", "stopped", "ended", ...answeringResultSchema.options
]);
export type CallResult = z.infer<typeof callResultSchema>;

export const callLifecycleSchema = z.strictObject({
  result: callResultSchema.nullable(),
  assessment: callAssessmentSummarySchema.optional(),
  answering: answeringStateSchema.optional(),
  sipResponseCode: z.number().int().min(100).max(699).optional(),
  eventSequence: z.number().int().nonnegative(),
  attemptedAt: z.iso.datetime().nullable(),
  ringingAt: z.iso.datetime().nullable(),
  connected: z.boolean(),
  connectedAt: z.iso.datetime().nullable(),
  disclosureAt: z.iso.datetime().nullable(),
  consent: z.enum(["not_recorded", "granted", "declined", "not_received", "not_requested"]),
  consentAt: z.iso.datetime().nullable(),
  conversationStartedAt: z.iso.datetime().nullable(),
  substantiveAnswerConfirmed: z.boolean(),
  endedAt: z.iso.datetime().nullable(),
  stopRequestedBy: z.enum(["user", "system"]).nullable(),
  endedBy: z.enum(["user", "assistant", "system", "unknown"]),
  credit: z.enum(["not_recorded", "reserved", "used", "returned"])
});
export type CallLifecycle = z.infer<typeof callLifecycleSchema>;
type LifecycleEvent = Pick<DurableCallEvent, "callAttemptId" | "sequence" | "occurredAt" | "payload">;
export type CallSettlementFact = { callAttemptId: string; settlement: "charge" | "refund"; qualified: boolean };

/** Late callbacks from earlier attempts must not change the current attempt's result. */
export function latestAttemptEvents<T extends LifecycleEvent>(events: readonly T[]): T[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const started = ordered.findLast((event) => event.payload.name === "attempt.started");
  if (started) return ordered.filter((event) => event.callAttemptId === started.callAttemptId && event.sequence >= started.sequence);
  // Legacy data without attempt.started: do not combine evidence from multiple attempts.
  const attemptIds = new Set(ordered.map((event) => event.callAttemptId).filter(Boolean));
  return attemptIds.size <= 1 ? ordered : [];
}

/** Evidence projection, not a replacement for the orchestration state or goal feedback. */
export function deriveCallLifecycle(status: CallBriefStatus, events: readonly LifecycleEvent[], settlements: readonly CallSettlementFact[] = [], assessments: readonly CallAssessmentRecord[] = []): CallLifecycle {
  const current = latestAttemptEvents(events);
  const terminal = ["completed", "failed", "stopped"].includes(status);
  const value: CallLifecycle = {
    result: null, eventSequence: Math.max(0, ...events.map((event) => event.sequence)),
    attemptedAt: null, ringingAt: null, connected: false, connectedAt: null,
    disclosureAt: null, consent: "not_recorded", consentAt: null,
    conversationStartedAt: null, substantiveAnswerConfirmed: false, endedAt: null,
    stopRequestedBy: null, endedBy: "unknown", credit: "not_recorded"
  };
  let providerResult: string | null = null;
  let technicalFailure = status === "blocked";
  let qualifiedCharge = false;
  for (const event of current) {
    const { payload, occurredAt } = event;
    switch (payload.name) {
      case "answering.updated": value.answering = payload.metadata; break;
      case "provider.sip_response": value.sipResponseCode = payload.metadata.code; break;
      case "attempt.started": value.attemptedAt = occurredAt; break;
      case "provider.status_changed":
        if (!payload.metadata.applied) break;
        if (payload.metadata.providerStatus === "ringing") value.ringingAt ??= occurredAt;
        if (payload.metadata.providerStatus === "in-progress") {
          value.connected = true;
          value.connectedAt ??= occurredAt;
        }
        if (["completed", "no-answer", "busy", "canceled", "failed"].includes(payload.metadata.providerStatus)) {
          providerResult = payload.metadata.providerStatus;
          value.endedAt ??= occurredAt;
        }
        break;
      case "connection.confirmed":
        value.connected = true;
        // A completed callback proves a connection, but does not give the answer time.
        if (payload.metadata.providerStatus === "in-progress") value.connectedAt ??= occurredAt;
        break;
      case "disclosure.started": value.disclosureAt ??= occurredAt; break;
      case "consent.granted": value.connected = true; value.consent = "granted"; value.consentAt = occurredAt; break;
      case "consent.failed":
        if (["recording_start_failed", "recognition_failed"].includes(payload.metadata.reason)) technicalFailure = true;
        if (payload.metadata.reason === "negative") value.connected = true;
        if (value.consent !== "granted" && value.consent !== "declined") {
          value.consent = payload.metadata.reason === "negative" ? "declined" : "not_received";
          value.consentAt = occurredAt;
        }
        break;
      case "conversation.started": value.conversationStartedAt ??= occurredAt; break;
      case "conversation.ended":
        if (["openai_error", "openai_closed", "recording_failure"].includes(payload.metadata.reason)) technicalFailure = true;
        if (["agent_hangup", "agent_hangup_fallback"].includes(payload.metadata.reason)) value.endedBy = "assistant";
        break;
      case "call.stop":
        if (payload.metadata.phase === "requested") value.stopRequestedBy = payload.metadata.actor;
        if (payload.metadata.phase === "succeeded") { value.endedBy = payload.metadata.actor; value.endedAt ??= occurredAt; }
        break;
      case "call.recovered": technicalFailure = true; break;
      case "credit.reserved": value.credit = "reserved"; break;
      case "credit.settled":
        value.credit = payload.metadata.settlement === "charge" ? "used" : "returned";
        qualifiedCharge = payload.metadata.settlement === "charge" && payload.metadata.basis === "substantive_answer_v1";
        break;
    }
  }
  // The immutable ledger commits before its secondary telemetry. Read it too:
  // a crash between those writes must not hide a charge or the answer evidence.
  const currentAttemptId = current.find((event) => event.callAttemptId)?.callAttemptId;
  const settlement = settlements.find((fact) => fact.callAttemptId === currentAttemptId);
  if (settlement) {
    value.credit = settlement.settlement === "charge" ? "used" : "returned";
    qualifiedCharge = settlement.settlement === "charge" && settlement.qualified;
  }
  const assessment = assessments.find(a=>a.callAttemptId === current.find(e=>e.payload.name === "attempt.started")?.callAttemptId)?.summary;
  if (assessment) value.assessment = assessment;
  value.substantiveAnswerConfirmed = value.consent === "granted" && (assessment?.status === "ready" ? assessment.conversation === "confirmed" : qualifiedCharge);
  if (value.answering && !value.disclosureAt && value.consent === "not_recorded") value.consent = "not_requested";
  if (!terminal) return value;
  if (value.answering?.message === "issued") value.answering = { ...value.answering,
    message: value.stopRequestedBy ? "interrupted" : "unknown" };
  if (value.connected && value.consent === "not_recorded") value.consent = "not_received";
  if (providerResult === "no-answer" && !value.connected) value.result = "no_answer";
  else if (providerResult === "busy" && !value.connected) value.result = "busy";
  else if (providerResult === "canceled" && !value.connected) value.result = "canceled";
  else if (value.substantiveAnswerConfirmed) value.result = "conversation_completed";
  else if (value.consent === "granted" && assessment?.status === "pending") value.result = "assessment_pending";
  else if (value.consent === "granted" && (assessment?.status === "unavailable" || assessment?.conversation === "uncertain")) value.result = "assessment_unavailable";
  else if (status === "stopped" || value.endedBy === "user" || value.endedBy === "system") value.result = "stopped";
  else if (value.consent === "declined") value.result = "consent_declined";
  else if (technicalFailure || providerResult === "failed") value.result = "technical_failure";
  else if (value.answering?.phase === "pending" && value.connected) value.result = "answer_detection_failed";
  else if (value.answering && answeringResult(value.answering) && !value.conversationStartedAt && value.consent !== "granted") value.result = answeringResult(value.answering);
  else if (technicalFailure || providerResult === "failed" || status === "failed") value.result = "technical_failure";
  else if (value.consent === "granted") value.result = "no_substantive_answer";
  else if (value.connected) value.result = "consent_not_received";
  else value.result = "ended";
  return value;
}

export const callLifecycleCountsSchema = z.strictObject({
  results: z.record(callResultSchema, z.number().int().nonnegative()),
  conversations: z.number().int().nonnegative(),
  messages: z.record(answeringStateSchema.shape.message, z.number().int().nonnegative()).optional(),
  goals: goalAssessmentCountsSchema.optional()
});
export type CallLifecycleCounts = z.infer<typeof callLifecycleCountsSchema>;
export function emptyCallLifecycleCounts(): CallLifecycleCounts {
  return { results: Object.fromEntries(callResultSchema.options.map((key) => [key, 0])) as Record<CallResult, number>, conversations: 0, goals: emptyGoalAssessmentCounts(),
    messages: Object.fromEntries(answeringStateSchema.shape.message.options.map(key => [key, 0])) as NonNullable<CallLifecycleCounts["messages"]> };
}
export function countCallLifecycle(counts: CallLifecycleCounts, lifecycle: CallLifecycle) {
  if (counts.messages && lifecycle.answering) counts.messages[lifecycle.answering.message] += 1;
  if (counts.goals) countGoalAssessment(counts.goals,lifecycle.assessment);
  if (lifecycle.result) counts.results[lifecycle.result] += 1;
  if (lifecycle.substantiveAnswerConfirmed) counts.conversations += 1;
}
