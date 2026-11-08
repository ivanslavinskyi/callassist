import { describe, expect, it } from "vitest";
import { canRepeatUnansweredCall } from "./call-retry";
import { deriveCallLifecycle, type CallLifecycle } from "./call-lifecycle";

const connected = deriveCallLifecycle("completed", [{ sequence: 1, callAttemptId: "attempt",
  occurredAt: "2026-09-25T17:22:47.000Z", payload: { name: "connection.confirmed", metadata: { providerStatus: "in-progress" } } }]);

describe("repeat eligibility before consent", () => {
  const machine:CallLifecycle={...connected,result:"automated_answer",recordingBasis:"declarative_local",consent:"not_requested",credit:"returned",
    conversationStartedAt:"2026-09-25T17:22:50.000Z",answering:{phase:"resolved",policyVersion:"twilio-async-live-inconclusive-v3",execution:"async",
      actionDispatched:true,mode:"Enable",answeredBy:"machine_start",decision:"hang_up",streamAdmitted:true,
      observedAt:"2026-09-25T17:22:53.000Z",durationMs:2977,message:"not_requested",failure:null}};
  it("allows a native machine retry after refund despite an early assistant greeting",()=>{
    expect(canRepeatUnansweredCall({status:"completed",lifecycle:machine})).toBe(true);
  });
  it.each([
    {credit:"reserved"},{credit:"used"},{consent:"granted"},{consent:"declined"},{substantiveAnswerConfirmed:true},
    {recordingBasis:"affirmative_consent"},{answering:{...machine.answering!,actionDispatched:false}},
    {answering:{...machine.answering!,answeredBy:"unknown",decision:"consent"}},
    {answering:{...machine.answering!,answeredBy:"human",decision:"consent"}}
  ] satisfies Partial<CallLifecycle>[])("does not relax native retry safety: %j",facts=>{
    expect(canRepeatUnansweredCall({status:"completed",lifecycle:{...machine,...facts}})).toBe(false);
  });
  it("keeps active native calls and journaled commitments out of retry",()=>{
    expect(canRepeatUnansweredCall({status:"in_progress",lifecycle:machine})).toBe(false);
    expect(canRepeatUnansweredCall({status:"completed",lifecycle:machine},{appointmentAction:{callAttemptId:"attempt",state:"uncertain",delivery:null}})).toBe(false);
  });
  it("allows a completed telephone connection with no consent, including missing final consent telemetry", () => {
    expect(connected.result).toBe("consent_not_received");
    expect(canRepeatUnansweredCall({ status: "completed", lifecycle: connected })).toBe(true);
    expect(canRepeatUnansweredCall({ status: "completed", lifecycle: { ...connected, consent: "not_received" } })).toBe(true);
  });
  it.each(["granted", "declined"] as const)("never retries %s consent even if other evidence is inconsistent", consent => {
    expect(canRepeatUnansweredCall({ status: "completed", lifecycle: { ...connected, consent } })).toBe(false);
  });
  it.each([
    { conversationStartedAt: "2026-09-25T17:22:50.000Z" },
    { substantiveAnswerConfirmed: true },
    { result: "consent_declined" },
    { result: "technical_failure" }
  ] satisfies Partial<CallLifecycle>[])("rejects a conversation or ambiguous connected outcome: %j", facts => {
    expect(canRepeatUnansweredCall({ status: "completed", lifecycle: { ...connected, ...facts } })).toBe(false);
  });
  it("never offers a retry while the original leg is active", () => {
    expect(canRepeatUnansweredCall({ status: "in_progress", lifecycle: connected })).toBe(false);
  });
});
