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
      usageSeconds: { realtime: 120, transcription: 120 }
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
