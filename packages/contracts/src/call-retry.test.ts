import { describe, expect, it } from "vitest";
import { canRepeatUnansweredCall } from "./call-retry";
import { deriveCallLifecycle, type CallLifecycle } from "./call-lifecycle";

const connected = deriveCallLifecycle("completed", [{ sequence: 1, callAttemptId: "attempt",
  occurredAt: "2026-09-25T17:22:47.000Z", payload: { name: "connection.confirmed", metadata: { providerStatus: "in-progress" } } }]);

describe("repeat eligibility before consent", () => {
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
