import { describe, expect, it } from "vitest";
import { deriveCallLifecycle, latestAttemptEvents } from "./call-lifecycle";
import type { CallTelemetryPayload } from "./call-telemetry";
const event = (sequence: number, payload: CallTelemetryPayload, callAttemptId = "attempt-1") => ({ sequence, payload, callAttemptId, occurredAt: new Date(Date.UTC(2026, 8, 15, 12, 0, sequence)).toISOString() });
const started = event(1, { name: "attempt.started", metadata: { provider: "twilio" } });
const connected = event(2, { name: "connection.confirmed", metadata: { providerStatus: "in-progress" } });
const consent = event(3, { name: "consent.granted", metadata: { method: "voice", decision: "affirmative", locale: "en-GB" } });
describe("call lifecycle evidence", () => {
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
