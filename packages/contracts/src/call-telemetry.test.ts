import { describe, expect, it } from "vitest";
import {
  callTelemetryEventInputSchema,
  describeCallTelemetryEvent,
  durableCallEventSchema
} from "./call-telemetry";

describe("durable call telemetry contracts", () => {
  it("accepts only bounded event-specific metadata", () => {
    expect(callTelemetryEventInputSchema.safeParse({
      idempotencyKey: "call:1:provider:ringing",
      payload: {
        name: "provider.status_changed",
        metadata: {
          providerStatus: "ringing",
          callStatus: "dialing",
          applied: true
        }
      }
    }).success).toBe(true);

    expect(callTelemetryEventInputSchema.safeParse({
      idempotencyKey: "call:1:provider:ringing",
      payload: {
        name: "provider.status_changed",
        metadata: {
          providerStatus: "ringing",
          callStatus: "dialing",
          applied: true,
          phoneNumber: "+41791234567"
        }
      }
    }).success).toBe(false);
  });

  it("keeps the durable descriptor deterministic", () => {
    expect(describeCallTelemetryEvent("transcription.failed")).toEqual({
      source: "transcription",
      stage: "transcription",
      severity: "error"
    });
    expect(durableCallEventSchema.safeParse({
      id: "72000000-0000-4000-8000-000000000001",
      callBriefId: "72000000-0000-4000-8000-000000000002",
      callAttemptId: null,
      userId: null,
      sequence: 1,
      schemaVersion: 1,
      source: "api",
      stage: "transcription",
      severity: "error",
      occurredAt: "2026-08-22T12:00:00.000Z",
      payload: {
        name: "transcription.failed",
        metadata: {
          model: "gpt-4o-transcribe",
          failureCode: "AUDIO_EMPTY"
        }
      }
    }).success).toBe(false);
  });

  it("accepts bounded consent evidence without raw recognized speech", () => {
    expect(callTelemetryEventInputSchema.safeParse({
      idempotencyKey: "call:1:consent:voice",
      payload: {
        name: "consent.granted",
        metadata: {
          method: "voice",
          decision: "affirmative",
          locale: "de-CH"
        }
      }
    }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({
      idempotencyKey: "call:1:consent:dtmf",
      payload: {
        name: "consent.granted",
        metadata: { method: "dtmf", digit: "1", locale: "en-GB" }
      }
    }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({
      idempotencyKey: "call:1:consent:legacy",
      payload: {
        name: "consent.granted",
        metadata: { method: "dtmf_1" }
      }
    }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({
      idempotencyKey: "call:1:consent:raw",
      payload: {
        name: "consent.granted",
        metadata: {
          method: "voice",
          decision: "affirmative",
          locale: "de-CH",
          transcript: "Ja"
        }
      }
    }).success).toBe(false);
  });
});
