import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { CallRepositoryError } from "./call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";

const input: CreateCallBriefInput = {
  recipientName: "Outcome test office",
  phoneNumber: "+41710000041",
  objective: "Ask whether the requested appointment is available",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Nina",
  representedPersonLastName: "Keller",
  assistanceReason: "speech_impairment",
  locale: "en-GB",
  allowLanguageSwitch: false,
  allowedFacts: []
};

async function createReadyCall(
  repository: InMemoryCallRepository,
  userId: string
) {
  const compilation = await new DeterministicBriefCompiler().compile(
    normalizeCreateCallBriefInput(input)
  );
  const brief = await repository.create(input, compilation, userId);
  await repository.approveCompilation(brief.id);
  return brief;
}

describe("call outcomes and owner feedback", () => {
  it("keeps technical failure separate from explicit semantic feedback", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId);

    await expect(repository.submitOwnerCallFeedback(brief.id, userId, {
      idempotencyKey: randomUUID(),
      goalResult: "yes",
      transcriptQuality: null,
      comment: null
    })).rejects.toEqual(expect.objectContaining<Partial<CallRepositoryError>>({
      code: "CALL_FEEDBACK_NOT_AVAILABLE"
    }));

    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId
    });
    await repository.attachProviderCall(started.attempt.id, "CA-outcome", "queued");
    await repository.applyProviderStatus(
      "CA-outcome",
      "no-answer",
      "failed",
      brief.id
    );
    const technical = await repository.recordSystemCallOutcome(brief.id);
    expect(technical).toMatchObject({
      technical: {
        connection: "not_confirmed",
        terminalStatus: "failed",
        failureStage: "provider",
        failureCode: "no-answer"
      },
      latestOutcome: null,
      latestFeedback: null
    });

    const idempotencyKey = randomUUID();
    const feedbackInput = {
      idempotencyKey,
      goalResult: "no" as const,
      transcriptQuality: null,
      comment: "The recipient could not be reached."
    };
    const submitted = await repository.submitOwnerCallFeedback(
      brief.id,
      userId,
      feedbackInput
    );
    const replayed = await repository.submitOwnerCallFeedback(
      brief.id,
      userId,
      feedbackInput
    );
    expect(replayed).toEqual(submitted);
    expect(submitted.latestOutcome).toMatchObject({
      revision: 2,
      outcome: "unresolved",
      provenance: "user",
      actorUserId: userId,
      reason: "owner_feedback"
    });
    expect(submitted.latestFeedback).toMatchObject({
      revision: 1,
      goalResult: "no",
      comment: feedbackInput.comment
    });

    await expect(repository.submitOwnerCallFeedback(
      brief.id,
      userId,
      { ...feedbackInput, goalResult: "yes" }
    )).rejects.toEqual(expect.objectContaining<Partial<CallRepositoryError>>({
      code: "CALL_FEEDBACK_IDEMPOTENCY_CONFLICT"
    }));
    await expect(repository.submitOwnerCallFeedback(
      brief.id,
      randomUUID(),
      { ...feedbackInput, idempotencyKey: randomUUID() }
    )).rejects.toEqual(expect.objectContaining<Partial<CallRepositoryError>>({
      code: "CALL_NOT_FOUND"
    }));

    const metrics = await repository.getCallOutcomeMetrics();
    expect(metrics).toMatchObject({
      terminalCalls: 1,
      feedbackResponses: 1,
      goalResults: { yes: 0, partly: 0, no: 1 },
      semanticOutcomes: { unresolved: 1 },
      technicalFailures: { provider: 1 }
    });
    expect(JSON.stringify(metrics)).not.toContain(feedbackInput.comment);
  });

  it("creates revisions when the owner updates an answer", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId);
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId
    });
    await repository.attachProviderCall(
      started.attempt.id,
      "CA-outcome-connected",
      "completed"
    );
    await repository.updateStatus(brief.id, "completed");
    await repository.recordSystemCallOutcome(brief.id);

    const first = await repository.submitOwnerCallFeedback(brief.id, userId, {
      idempotencyKey: randomUUID(),
      goalResult: "partly",
      transcriptQuality: "some_errors",
      comment: null
    });
    const revised = await repository.submitOwnerCallFeedback(brief.id, userId, {
      idempotencyKey: randomUUID(),
      goalResult: "yes",
      transcriptQuality: "good",
      comment: "Confirmed after checking the recording."
    });

    expect(first.latestFeedback?.revision).toBe(1);
    expect(revised.latestFeedback).toMatchObject({
      revision: 2,
      goalResult: "yes",
      transcriptQuality: "good"
    });
    expect(revised.latestOutcome).toMatchObject({
      revision: 3,
      outcome: "resolved",
      provenance: "user"
    });
  });
});
