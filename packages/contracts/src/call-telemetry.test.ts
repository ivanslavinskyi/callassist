import { describe, expect, it } from "vitest";
import {
  callTelemetryEventInputSchema,
  describeCallTelemetryEvent,
  durableCallEventSchema
} from "./call-telemetry";

describe("durable call telemetry contracts", () => {
  it("retains historical task events and records recovery without recipient content", () => {
    for (const runtimeVersion of ["live-managed-v2", "live-managed-v3", "live-managed-v7", "live-managed-v8", "live-managed-v9"]) {
      const payload = { name: "conversation.task", metadata: { runtimeVersion, phase: "stale", revision: 3,
        cause: "obsolete_backend_timeout", responseId: "old-response", released: false } };
      expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "recovery:1", payload }).success).toBe(true);
      expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "recovery:1", payload: {
        ...payload, metadata: { ...payload.metadata, recipientText: "private details" }
      } }).success).toBe(false);
    }
  });
  it("accepts the stabilization runtime and typed task decisions without storing a spoken summary", () => {
    for (const runtimeVersion of ["live-managed-v1", "live-managed-v2", "live-managed-v3", "live-managed-v7", "live-managed-v8", "live-managed-v9"]) {
      expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: `live:${runtimeVersion}`, payload: {
        name: "realtime.ready", metadata: { model: "gpt-live-1", transcriptionModel: "gpt-live-1", runtimeVersion }
      } }).success).toBe(true);
    }
    const payload = { name: "conversation.tool_result", metadata: { tool: "report_task_state", outcome: "accepted",
      reason: "keep_closing", requestFingerprint: "a".repeat(64), snapshotHash: "b".repeat(64), generation: 5 } };
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "decision:1", payload }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "decision:1", payload: {
      ...payload, metadata: { ...payload.metadata, summary: "private recipient words" }
    } }).success).toBe(false);
  });
  it("persists only bounded Live error diagnostics", () => {
    const payload = { name: "realtime.error", metadata: {
      phase: "conversation", disposition: "retrying", code: "invalid_request_error",
      type: "invalid_request_error", param: "session.delegation", command: "session.update",
      clientEventId: "8c5909ef-2bb3-4f19-b78d-cda54fcd3b20", attempt: 1
    } };
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "live:error:1", payload }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "live:error:2", payload: {
      ...payload, metadata: { ...payload.metadata, command: "response.item.create" }
    } }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "live:error:1", payload: {
      ...payload, metadata: { ...payload.metadata, message: "private provider text" }
    } }).success).toBe(false);
    expect(describeCallTelemetryEvent("realtime.error")).toEqual({
      source: "realtime", stage: "realtime", severity: "warning"
    });
  });
  it("retains speech failure codes without allowing spoken text in end metadata", () => {
    const payload = { name: "conversation.ended", metadata: { reason: "openai_error", failureCode: "LIVE_SPEECH_MEANING_UNVERIFIED", failurePhase: "disclosure" } };
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "end:1", payload }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "end:1", payload: {
      ...payload, metadata: { ...payload.metadata, transcript: "private words" }
    } }).success).toBe(false);
  });
  it("accepts bounded agent hangup reasons but rejects transcript metadata", () => {
    const payload = { name: "conversation.hangup", metadata: { phase: "fallback", reason: "cannot_proceed", generation: 1, trigger: "playback_timeout" } };
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "hangup:1", payload }).success).toBe(true);
    expect(callTelemetryEventInputSchema.safeParse({ idempotencyKey: "hangup:1", payload: {
      ...payload, metadata: { ...payload.metadata, transcript: "private words" }
    } }).success).toBe(false);
  });
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
