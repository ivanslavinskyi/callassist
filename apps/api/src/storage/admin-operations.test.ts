import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { InMemoryCallRepository } from "./in-memory-call-repository";

const callInput: CreateCallBriefInput = {
  recipientName: "Operations metrics test",
  phoneNumber: "+41710000061",
  objective: "Verify privacy-safe operational metrics",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Nina",
  representedPersonLastName: "Keller",
  assistanceReason: "speech_impairment",
  locale: "en-GB",
  allowLanguageSwitch: false,
  allowedFacts: []
};

describe("admin operational read models", () => {
  it("includes pre-consent Realtime time when no recording was created", async () => {
    const repository = new InMemoryCallRepository();
    const ownerUserId = randomUUID();
    await repository.grantSignupCredits(ownerUserId);
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput({
        ...callInput,
        phoneNumber: "+41710000063"
      })
    );
    const brief = await repository.create(
      { ...callInput, phoneNumber: "+41710000063" },
      compilation,
      ownerUserId
    );
    await repository.approveCompilation(brief.id);
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId: ownerUserId
    });
    await repository.appendCallTelemetryEvent(brief.id, {
      callAttemptId: started.attempt.id,
      idempotencyKey: "pre-consent-realtime-ready",
      occurredAt: new Date(Date.now() - 12_000).toISOString(),
      payload: {
        name: "realtime.ready",
        metadata: {
          model: "gpt-realtime-test",
          transcriptionModel: "gpt-transcribe-test"
        }
      }
    });
    await repository.appendCallTelemetryEvent(brief.id, {
      callAttemptId: started.attempt.id,
      idempotencyKey: "pre-consent-stream-ended",
      payload: {
        name: "consent.failed",
        metadata: { reason: "stream_ended_before_consent" }
      }
    });
    await repository.updateStatus(brief.id, "completed");

    const now = new Date();
    const facts = await repository.getAdminOperationsFacts(
      new Date(now.getTime() - 60_000).toISOString(),
      new Date(now.getTime() + 60_000).toISOString(),
      brief.id
    );
    expect(facts.usageSeconds.realtime).toBeGreaterThanOrEqual(11);
    expect(facts.usageSeconds.transcription).toBe(0);
    expect(facts.recordedDurationSeconds.samples).toBe(0);
  });

  it("derives cohort metrics and system workload from bounded facts", async () => {
    const repository = new InMemoryCallRepository();
    const ownerUserId = randomUUID();
    await repository.grantSignupCredits(ownerUserId);
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(callInput)
    );
    const brief = await repository.create(
      callInput,
      compilation,
      ownerUserId
    );
    await repository.approveCompilation(brief.id);
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId: ownerUserId
    });
    const providerCallId = `CA-operations-${brief.id}`;
    await repository.attachProviderCall(
      started.attempt.id,
      providerCallId,
      "queued"
    );
    const telephonyOperationId = randomUUID();
    await repository.startTelephonyProviderOperation({
      id: telephonyOperationId,
      callBriefId: brief.id,
      callAttemptId: started.attempt.id,
      provider: "twilio",
      operationType: "telephony_leg",
      stage: "outbound_call",
      requestedModel: "programmable_voice",
      clientRequestId: telephonyOperationId,
      startedAt: new Date().toISOString()
    });
    await repository.applyProviderStatus(
      providerCallId,
      "in-progress",
      "in_progress",
      brief.id
    );
    await repository.appendCallTelemetryEvent(brief.id, {
      callAttemptId: started.attempt.id,
      idempotencyKey: "operations-realtime-ready",
      payload: {
        name: "realtime.ready",
        metadata: {
          model: "gpt-realtime-test",
          transcriptionModel: "gpt-transcribe-test"
        }
      }
    });
    await repository.appendCallTelemetryEvent(brief.id, {
      callAttemptId: started.attempt.id,
      idempotencyKey: "operations-first-audio",
      payload: {
        name: "conversation.first_audio",
        metadata: { latencyMs: 420 }
      }
    });
    const begun = await repository.beginRecording(brief.id);
    await repository.attachProviderRecording(
      begun.recording.id,
      `RE-operations-${brief.id}`,
      "in-progress"
    );
    await repository.applyRecordingStatus({
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      providerCallId,
      providerRecordingId: `RE-operations-${brief.id}`,
      providerStatus: "completed",
      durationSeconds: 120,
      channels: 2
    });
    await repository.claimFinalTranscript(
      begun.recording.id,
      "gpt-transcribe-test"
    );
    await repository.failFinalTranscript(
      begun.recording.id,
      "bounded_failure"
    );
    await repository.claimFinalTranscript(
      begun.recording.id,
      "gpt-transcribe-test",
      true
    );
    await repository.recordTelephonyLegUsage({
      fallbackOperationId: telephonyOperationId,
      callBriefId: brief.id,
      callAttemptId: started.attempt.id,
      providerCallId,
      providerStatus: "completed",
      durationSeconds: 125,
      billableSeconds: 180,
      occurredAt: new Date().toISOString(),
      sequenceNumber: 1
    });
    await repository.updateStatus(brief.id, "completed");
    await repository.submitOwnerCallFeedback(brief.id, ownerUserId, {
      idempotencyKey: randomUUID(),
      goalResult: "yes",
      transcriptQuality: "good",
      comment: null
    });

    const now = new Date();
    const facts = await repository.getAdminOperationsFacts(
      new Date(now.getTime() - 60_000).toISOString(),
      new Date(now.getTime() + 60_000).toISOString()
    );
    expect(facts).toMatchObject({
      createdCalls: 1,
      attemptedCalls: 1,
      terminalCalls: 1,
      connectedCalls: 1,
      consentGrantedCalls: 1,
      feedbackResponses: 1,
      semanticOutcomes: { resolved: 1, unclassified: 0 },
      recordedDurationSeconds: {
        samples: 1,
        total: 120,
        average: 120,
        p95: 120
      },
      firstAudioLatencyMs: {
        samples: 1,
        total: 420,
        average: 420,
        p95: 420
      },
      transcriptionRetries: 1,
      usageSeconds: { realtime: 120, transcription: 120 },
      providerUsage: {
        operationCount: 1,
        usageRecordCount: 1,
        buckets: [expect.objectContaining({
          provider: "twilio",
          operationType: "telephony_leg",
          model: "programmable_voice",
          usageRecords: 1,
          requestCount: 1,
          durationSeconds: 125,
          durationSamples: 1,
          billableSeconds: 180,
          billableSamples: 1
        })]
      }
    });

    await repository.setOutboundCallsEnabled(false, {
      actorUserId: randomUUID(),
      reason: "Investigating provider failures"
    });
    await repository.recordProviderWebhookDelivery({
      kind: "voice",
      outcome: "failed",
      receivedAt: new Date(now.getTime() - 31 * 86_400_000).toISOString(),
      errorCode: "OLD_FAILURE"
    });
    await repository.recordProviderWebhookDelivery({
      kind: "voice",
      outcome: "accepted",
      receivedAt: new Date(now.getTime() - 30_000).toISOString()
    });
    await repository.recordProviderWebhookDelivery({
      kind: "call_status",
      outcome: "unmatched",
      receivedAt: new Date(now.getTime() - 20_000).toISOString(),
      errorCode: "WEBHOOK_TARGET_NOT_FOUND"
    });
    await repository.recordProviderWebhookDelivery({
      kind: "recording_status",
      outcome: "rejected",
      receivedAt: new Date(now.getTime() - 10_000).toISOString(),
      errorCode: "INVALID_TWILIO_SIGNATURE"
    });
    const system = await repository.getAdminSystemFacts(
      now.toISOString(),
      new Date(now.getTime() - 86_400_000).toISOString()
    );
    expect(system).toMatchObject({
      outboundCalls: {
        enabled: false,
        reason: "Investigating provider failures"
      },
      activeCalls: 0,
      transcriptionProcessing: 1,
      transcriptionFailed: 0,
      retentionScheduled: 0,
      callPlanCutover: {
        recoverableLegacyCalls: 0,
        archivedLegacyCalls: 0,
        recompileRequiredCalls: 0,
        unavailableLegacyCalls: 0,
        executableLegacyCalls: 0,
        historicalAttemptsWithoutCompilation: 0,
        historicalAttemptsWithoutExecutionSnapshot: 0,
        activeLegacyAttempts: 0,
        activeRecompilations: 0
      },
      webhooks: {
        voice: {
          accepted: 1,
          failed: 0,
          lastAcceptedAt: expect.any(String)
        },
        call_status: {
          unmatched: 1,
          lastProblemCode: "WEBHOOK_TARGET_NOT_FOUND"
        },
        recording_status: {
          rejected: 1,
          lastProblemCode: "INVALID_TWILIO_SIGNATURE"
        }
      }
    });
  });
});
