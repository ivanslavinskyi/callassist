import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import type { CallAdmissionPolicy } from "./call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";

const telemetryTestPolicy: CallAdmissionPolicy = {
  maxStartsPerHour: 20,
  maxStartsPerDay: 20,
  maxStartsPerRecipientPerDay: 20,
  maxDurationSeconds: 900
};

const privateFact = "Private fact that must not enter telemetry";

const baseInput: CreateCallBriefInput = {
  recipientName: "Private telemetry recipient",
  phoneNumber: "+41710000031",
  objective: "Ask for a private appointment window",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Private",
  representedPersonLastName: "Caller",
  assistanceReason: "speech_impairment",
  locale: "en-GB",
  allowLanguageSwitch: false,
  allowedFacts: [privateFact]
};

async function createReadyCall(
  repository: InMemoryCallRepository,
  userId: string,
  suffix: string
) {
  const input = {
    ...baseInput,
    recipientName: `${baseInput.recipientName} ${suffix}`
  };
  const compilation = await new DeterministicBriefCompiler().compile(
    normalizeCreateCallBriefInput(input)
  );
  const brief = await repository.create(input, compilation, userId);
  await repository.approveCompilation(brief.id);
  return brief;
}

describe("durable call telemetry", () => {
  it("reconstructs a pre-connection refund without storing call PII", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId, "unanswered");
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: telemetryTestPolicy
    });
    await repository.attachProviderCall(started.attempt.id, "CA-telemetry", "queued");
    await repository.applyProviderStatus(
      "CA-telemetry",
      "ringing",
      "dialing",
      brief.id
    );
    await repository.applyProviderStatus(
      "CA-telemetry",
      "no-answer",
      "failed",
      brief.id
    );
    await repository.applyProviderStatus(
      "CA-telemetry",
      "no-answer",
      "failed",
      brief.id
    );

    const events = await repository.listCallTelemetryEvents(brief.id);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      events.map((_, index) => index + 1)
    );
    expect(events.every(({ schemaVersion }) => schemaVersion === 1)).toBe(true);
    expect(events.filter(({ payload }) => payload.name === "connection.confirmed"))
      .toHaveLength(0);
    expect(events.filter(({ payload }) => payload.name === "provider.status_changed"))
      .toHaveLength(2);
    expect(events.filter(({ payload }) => payload.name === "credit.settled"))
      .toEqual([
        expect.objectContaining({
          payload: {
            name: "credit.settled",
            metadata: { settlement: "refund", connected: false }
          }
        })
      ]);

    const serialized = JSON.stringify(events);
    for (const privateValue of [
      baseInput.recipientName,
      baseInput.phoneNumber,
      baseInput.objective,
      baseInput.representedPersonFirstName,
      baseInput.representedPersonLastName,
      privateFact
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("settles a charge once and records the confirmed connection once", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId, "answered");
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: telemetryTestPolicy
    });
    await repository.attachProviderCall(started.attempt.id, "CA-answered", "queued");
    await repository.applyProviderStatus(
      "CA-answered",
      "in-progress",
      "in_progress",
      brief.id
    );
    await repository.applyProviderStatus(
      "CA-answered",
      "in-progress",
      "in_progress",
      brief.id
    );
    await repository.applyProviderStatus(
      "CA-answered",
      "completed",
      "completed",
      brief.id
    );
    const lateRinging = await repository.applyProviderStatus(
      "CA-answered",
      "ringing",
      "dialing",
      brief.id
    );

    const events = await repository.listCallTelemetryEvents(brief.id);
    expect(lateRinging?.snapshot.brief.status).toBe("completed");
    expect(events.filter(({ payload }) => payload.name === "connection.confirmed"))
      .toHaveLength(1);
    expect(events.filter(({ payload }) => payload.name === "credit.settled"))
      .toEqual([
        expect.objectContaining({
          payload: {
            name: "credit.settled",
            metadata: { settlement: "charge", connected: true }
          }
        })
      ]);
    expect(
      events.find(
        ({ payload }) =>
          payload.name === "provider.status_changed" &&
          payload.metadata.providerStatus === "ringing"
      )?.payload
    ).toEqual({
      name: "provider.status_changed",
      metadata: {
        providerStatus: "ringing",
        callStatus: "dialing",
        applied: false
      }
    });
  });

  it("does not infer a charge from a terminal state without connection evidence", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId, "unconfirmed");
    await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: telemetryTestPolicy
    });

    await repository.updateStatus(brief.id, "completed");

    const usage = await repository.getCreditUsage(userId);
    expect(usage.balance).toBe(3);
    expect(usage.transactions.filter(({ type }) => type === "call_charge"))
      .toHaveLength(0);
    const events = await repository.listCallTelemetryEvents(brief.id);
    expect(events.some(({ payload }) => payload.name === "connection.confirmed"))
      .toBe(false);
    expect(events.filter(({ payload }) => payload.name === "credit.settled"))
      .toEqual([
        expect.objectContaining({
          payload: {
            name: "credit.settled",
            metadata: { settlement: "refund", connected: false }
          }
        })
      ]);
  });

  it("records bounded recording and transcription failures", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId, "processing");
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: telemetryTestPolicy
    });
    await repository.attachProviderCall(started.attempt.id, "CA-processing", "queued");
    await repository.applyProviderStatus(
      "CA-processing",
      "in-progress",
      "in_progress",
      brief.id
    );
    const begun = await repository.beginRecording(brief.id, {
      method: "voice",
      decision: "affirmative",
      locale: "en-GB"
    });
    await repository.attachProviderRecording(
      begun.recording.id,
      "RE-processing",
      "in-progress"
    );
    await repository.applyRecordingStatus({
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      providerCallId: "CA-processing",
      providerRecordingId: "RE-processing",
      providerStatus: "completed",
      durationSeconds: 17,
      channels: 2
    });
    await repository.claimFinalTranscript(
      begun.recording.id,
      "gpt-4o-mini-transcribe"
    );
    await repository.failFinalTranscript(
      begun.recording.id,
      "provider response contained private diagnostic text"
    );

    const events = await repository.listCallTelemetryEvents(brief.id);
    expect(events.map(({ payload }) => payload.name)).toEqual(
      expect.arrayContaining([
        "consent.granted",
        "recording.started",
        "recording.completed",
        "transcription.started",
        "transcription.failed"
      ])
    );
    const failed = events.find(
      ({ payload }) => payload.name === "transcription.failed"
    );
    expect(failed?.payload).toEqual({
      name: "transcription.failed",
      metadata: {
        model: "gpt-4o-mini-transcribe",
        failureCode: "transcription_failed"
      }
    });
    expect(
      events.find(({ payload }) => payload.name === "consent.granted")?.payload
    ).toEqual({
      name: "consent.granted",
      metadata: {
        method: "voice",
        decision: "affirmative",
        locale: "en-GB"
      }
    });
    expect(JSON.stringify(events)).not.toContain("private diagnostic text");
  });

  it("records a bounded recording failure without the provider message", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId, "recording-failure");
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: telemetryTestPolicy
    });
    await repository.attachProviderCall(
      started.attempt.id,
      "CA-recording-failure",
      "in-progress"
    );
    const begun = await repository.beginRecording(brief.id);
    await repository.failRecording(
      begun.recording.id,
      "provider exposed private diagnostic text"
    );

    const events = await repository.listCallTelemetryEvents(brief.id);
    expect(
      events.find(({ payload }) => payload.name === "recording.failed")?.payload
    ).toEqual({
      name: "recording.failed",
      metadata: { failureCode: "recording_failed" }
    });
    expect(JSON.stringify(events)).not.toContain("private diagnostic text");
  });
});
