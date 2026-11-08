import { describe, expect, it } from "vitest";
import { deriveCallLifecycle, latestAttemptEvents } from "./call-lifecycle";
import type { CallTelemetryPayload } from "./call-telemetry";
const event = (sequence: number, payload: CallTelemetryPayload, callAttemptId = "attempt-1") => ({ sequence, payload, callAttemptId, occurredAt: new Date(Date.UTC(2026, 8, 15, 12, 0, sequence)).toISOString() });
const started = event(1, { name: "attempt.started", metadata: { provider: "twilio" } });
const connected = event(2, { name: "connection.confirmed", metadata: { providerStatus: "in-progress" } });
const consent = event(3, { name: "consent.granted", metadata: { method: "voice", decision: "affirmative", locale: "en-GB" } });
describe("call lifecycle evidence", () => {
  const nativeMachine = [started, connected,
    event(3, {name:"recording.started",metadata:{providerStatus:"in-progress",recordingBasis:"declarative_local"}}),
    event(4, {name:"conversation.started",metadata:{}}),
    event(5, {name:"answering.updated",metadata:{phase:"resolved",policyVersion:"twilio-async-live-inconclusive-v3",execution:"async",
      actionDispatched:true,mode:"Enable",answeredBy:"machine_start",decision:"hang_up",streamAdmitted:true,
      observedAt:"2026-09-15T12:00:05Z",durationMs:2977,message:"not_requested",failure:null}})];
  it("shows a dispatched native machine answer despite the assistant's early greeting",()=>{
    expect(deriveCallLifecycle("completed",nativeMachine)).toMatchObject({result:"automated_answer",recordingBasis:"declarative_local",
      consent:"not_requested",substantiveAnswerConfirmed:false,conversationStartedAt:nativeMachine[3].occurredAt});
  });
  it.each(["pending","unavailable"] as const)("does not hide a known machine answer behind a %s transcript assessment",status=>{
    const assessment={callAttemptId:"attempt-1",compilationId:"fixture",sourceHash:null,decision:null,
      summary:{status,conversation:null,goal:null,reason:null,updatedAt:"2026-09-15T12:00:10Z",deadlineAt:null,transcriptRevisionId:null,evaluatorVersion:null}};
    expect(deriveCallLifecycle("completed",nativeMachine,[],[assessment]).result).toBe("automated_answer");
  });
  it("preserves human evidence and refusal over a conflicting native machine callback",()=>{
    expect(deriveCallLifecycle("completed",[...nativeMachine,consent]).result).toBe("no_substantive_answer");
    expect(deriveCallLifecycle("completed",nativeMachine,[{callAttemptId:"attempt-1",settlement:"charge",qualified:true}]).result).toBe("conversation_completed");
    expect(deriveCallLifecycle("completed",[...nativeMachine,event(6,{name:"consent.failed",metadata:{reason:"negative"}})]).result).toBe("consent_declined");
  });
  it("keeps a declared recording separate from consent, disclosure and task-answer evidence", () => {
    const recording = event(3, { name: "recording.started", metadata: { providerStatus: "in-progress", recordingBasis: "declarative_local" } });
    const charge = { callAttemptId: "attempt-1", settlement: "charge", qualified: true } as const;
    expect(deriveCallLifecycle("completed", [started, connected, recording])).toMatchObject({
      result: "no_substantive_answer", consent: "not_requested", consentAt: null, disclosureAt: null, substantiveAnswerConfirmed: false
    });
    expect(deriveCallLifecycle("completed", [started, connected, recording], [charge])).toMatchObject({
      result: "conversation_completed", consent: "not_requested", recordingBasis: "declarative_local"
    });
    const declined = event(4, { name: "consent.failed", metadata: { reason: "negative" } });
    expect(deriveCallLifecycle("completed", [started, connected, recording, declined], [charge])).toMatchObject({
      result: "consent_declined", substantiveAnswerConfirmed: false
    });
    expect(deriveCallLifecycle("completed", [started, connected, recording,
      event(5, { name: "attempt.started", metadata: { provider: "twilio" } }, "attempt-2")], [charge]).recordingBasis).toBeUndefined();
  });
  it("recovers a settled credit from the atomic ledger when secondary telemetry is missing", () => {
    expect(deriveCallLifecycle("completed", [started, connected, consent], [{ callAttemptId: "attempt-1", settlement: "charge", qualified: true }])).toMatchObject({ result: "conversation_completed", credit: "used", substantiveAnswerConfirmed: true });
    expect(deriveCallLifecycle("completed", [started, connected, consent], [{ callAttemptId: "older-attempt", settlement: "charge", qualified: true }])).toMatchObject({ result: "no_substantive_answer", substantiveAnswerConfirmed: false });
  });
  it.each([ ["no-answer", "no_answer"], ["busy", "busy"], ["canceled", "canceled"] ] as const)("keeps %s separate from a failed consent", (providerStatus, result) => {
    expect(deriveCallLifecycle("failed", [started, event(2, { name: "provider.status_changed", metadata: { providerStatus, callStatus: "failed", applied: true } })])).toMatchObject({ result, connected: false, consent: "not_recorded", endedBy: "unknown" });
  });
  it("does not equate a phone connection or completed callback with a human answer", () => {
    expect(deriveCallLifecycle("completed", [started, event(2, { name: "connection.confirmed", metadata: { providerStatus: "completed" } })])).toMatchObject({ result: "consent_not_received", connected: true, connectedAt: null, endedBy: "unknown" });
    expect(deriveCallLifecycle("completed", [])).toMatchObject({ result: "ended", connected: false });
  });
  it("preserves an explicit refusal after a stream-close failure", () => {
    expect(deriveCallLifecycle("completed", [started, connected,
      event(3, { name: "consent.failed", metadata: { reason: "negative" } }),
      event(4, { name: "consent.failed", metadata: { reason: "stream_ended_before_consent" } })
    ])).toMatchObject({ result: "consent_declined", consent: "declined" });
  });
  it("requires both consent and substantive-answer evidence for a conversation", () => {
    expect(deriveCallLifecycle("completed", [started, connected, consent]).result).toBe("no_substantive_answer");
    const oldCharge = event(4, { name: "credit.settled", metadata: { settlement: "charge", connected: true } });
    expect(deriveCallLifecycle("completed", [started, connected, consent, oldCharge]).substantiveAnswerConfirmed).toBe(false);
    const charge = event(4, { name: "credit.settled", metadata: { settlement: "charge", connected: true, basis: "substantive_answer_v1", questionSegmentId: "a", answerSegmentId: "b" } });
    expect(deriveCallLifecycle("completed", [started, connected, consent, charge])).toMatchObject({ result: "conversation_completed", substantiveAnswerConfirmed: true, credit: "used" });
    expect(deriveCallLifecycle("completed", [started, connected, charge]).substantiveAnswerConfirmed).toBe(false);
  });
  it("does not assign an end party from a stop request or a socket closing", () => {
    const requested = event(3, { name: "call.stop", metadata: { phase: "requested", actor: "user" } });
    const closed = event(4, { name: "conversation.ended", metadata: { reason: "socket_closed" } });
    expect(deriveCallLifecycle("completed", [started, connected, requested, closed])).toMatchObject({ stopRequestedBy: "user", endedBy: "unknown" });
    expect(deriveCallLifecycle("stopped", [started, requested, event(4, { name: "call.stop", metadata: { actor: "user", phase: "succeeded" } })])).toMatchObject({ result: "stopped", endedBy: "user" });
  });
  it("ignores old attempts and unapplied callbacks without mixing evidence", () => {
    const retry = event(4, { name: "attempt.started", metadata: { provider: "twilio" } }, "attempt-2");
    const noAnswer = event(5, { name: "provider.status_changed", metadata: { providerStatus: "no-answer", callStatus: "failed", applied: true } }, "attempt-2");
    const late = event(6, { name: "connection.confirmed", metadata: { providerStatus: "completed" } });
    expect(deriveCallLifecycle("failed", [started, connected, consent, retry, noAnswer, late])).toMatchObject({ result: "no_answer", connected: false, consent: "not_recorded", eventSequence: 6 });
    expect(deriveCallLifecycle("completed", [started, connected, event(3, { name: "provider.status_changed", metadata: { providerStatus: "failed", callStatus: "failed", applied: false } })]).result).toBe("consent_not_received");
    expect(latestAttemptEvents([connected, noAnswer])).toEqual([]);
  });
  it("keeps ongoing calls ongoing and transcription failures separate from the conversation", () => {
    expect(deriveCallLifecycle("in_progress", [started, connected, consent]).result).toBeNull();
    expect(deriveCallLifecycle("completed", [started, connected, consent, event(4, { name: "transcription.failed", metadata: { model: "test", failureCode: "empty_audio" } })]).result).toBe("no_substantive_answer");
  });
});
