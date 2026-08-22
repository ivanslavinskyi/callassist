import { describe, expect, it } from "vitest";
import {
  callOutcomeRevisionSchema,
  deriveTechnicalCallOutcome,
  ownerCallFeedbackInputSchema,
  semanticOutcomeForGoalResult
} from "./call-outcome";
import {
  describeCallTelemetryEvent,
  durableCallEventSchema,
  type CallTelemetryPayload
} from "./call-telemetry";

describe("call outcome contracts", () => {
  it("derives technical state without inferring semantic success", () => {
    const technical = deriveTechnicalCallOutcome("completed", [
      event(1, {
        name: "connection.confirmed",
        metadata: { providerStatus: "in-progress" }
      }),
      event(2, {
        name: "provider.status_changed",
        metadata: {
          providerStatus: "completed",
          callStatus: "completed",
          applied: true
        }
      })
    ]);

    expect(technical).toEqual({
      connection: "confirmed",
      terminalStatus: "completed",
      consent: "not_recorded",
      recording: "not_recorded",
      transcription: "not_recorded",
      failureStage: null,
      failureCode: null
    });
    expect(callOutcomeRevisionSchema.safeParse({
      id: "72000000-0000-4000-8000-000000000001",
      callBriefId: "72000000-0000-4000-8000-000000000002",
      revision: 1,
      schemaVersion: 1,
      outcome: "resolved",
      provenance: "system",
      actorUserId: null,
      reason: "technical_state_changed",
      technical,
      createdAt: "2026-08-22T12:00:00.000Z"
    }).success).toBe(false);
  });

  it("keeps provider and later processing failures reconstructable", () => {
    expect(deriveTechnicalCallOutcome("failed", [
      event(1, {
        name: "provider.status_changed",
        metadata: {
          providerStatus: "no-answer",
          callStatus: "failed",
          applied: true
        }
      })
    ])).toMatchObject({
      connection: "not_confirmed",
      terminalStatus: "failed",
      failureStage: "provider",
      failureCode: "no-answer"
    });

    expect(deriveTechnicalCallOutcome("completed", [
      event(1, {
        name: "connection.confirmed",
        metadata: { providerStatus: "completed" }
      }),
      event(2, {
        name: "transcription.failed",
        metadata: {
          model: "gpt-4o-mini-transcribe",
          failureCode: "audio_empty"
        }
      })
    ])).toMatchObject({
      connection: "confirmed",
      failureStage: "transcription",
      failureCode: "audio_empty",
      transcription: "failed"
    });
  });

  it("bounds private owner feedback and maps only explicit answers", () => {
    expect(semanticOutcomeForGoalResult("yes")).toBe("resolved");
    expect(ownerCallFeedbackInputSchema.safeParse({
      idempotencyKey: "72000000-0000-4000-8000-000000000003",
      goalResult: "partly",
      transcriptQuality: "some_errors",
      comment: "Useful but one time was transcribed incorrectly."
    }).success).toBe(true);
    expect(ownerCallFeedbackInputSchema.safeParse({
      idempotencyKey: "72000000-0000-4000-8000-000000000003",
      goalResult: "no",
      transcriptQuality: "poor",
      comment: "x".repeat(501)
    }).success).toBe(false);
  });
});

function event(sequence: number, payload: CallTelemetryPayload) {
  const descriptor = describeCallTelemetryEvent(payload.name);
  return durableCallEventSchema.parse({
    id: `72000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    callBriefId: "72000000-0000-4000-8000-000000000010",
    callAttemptId: null,
    userId: null,
    sequence,
    schemaVersion: 1,
    ...descriptor,
    occurredAt: `2026-08-22T12:00:0${sequence}.000Z`,
    payload
  });
}
