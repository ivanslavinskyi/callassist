import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { decodeAdminCallCursor } from "./call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";

function input(phoneNumber: string, locale: "en-GB" | "de-CH"):
CreateCallBriefInput {
  return {
    recipientName: "Admin inspector test recipient",
    phoneNumber,
    objective: "Verify the privacy-safe administrator call inspector",
    assistantProfileId: "sebastian",
    representedPersonFirstName: "Nina",
    representedPersonLastName: "Keller",
    assistanceReason: "speech_impairment",
    locale,
    allowLanguageSwitch: false,
    allowedFacts: []
  };
}

async function createReadyCall(
  repository: InMemoryCallRepository,
  ownerUserId: string,
  callInput: CreateCallBriefInput
) {
  const compilation = await new DeterministicBriefCompiler().compile(
    normalizeCreateCallBriefInput(callInput)
  );
  const brief = await repository.create(callInput, compilation, ownerUserId);
  await repository.approveCompilation(brief.id);
  return brief;
}

describe("admin calls read model", () => {
  it("filters and paginates minimized summaries and reconstructs Inspector", async () => {
    const repository = new InMemoryCallRepository();
    const ownerUserId = randomUUID();
    await repository.grantSignupCredits(ownerUserId);

    const completed = await createReadyCall(
      repository,
      ownerUserId,
      input("+41710000051", "de-CH")
    );
    const completedAttempt = await repository.startAttempt(completed.id, {
      provider: "twilio",
      userId: ownerUserId
    });
    await repository.attachProviderCall(
      completedAttempt.attempt.id,
      "CA-admin-completed",
      "completed"
    );
    await repository.appendCallTelemetryEvent(completed.id, {
      callAttemptId: completedAttempt.attempt.id,
      idempotencyKey: "admin-consent-granted",
      payload: {
        name: "consent.granted",
        metadata: { method: "dtmf_1" }
      }
    });
    await repository.updateStatus(completed.id, "completed");
    await repository.recordSystemCallOutcome(completed.id);
    const privateComment = "Private support context";
    await repository.submitOwnerCallFeedback(completed.id, ownerUserId, {
      idempotencyKey: randomUUID(),
      goalResult: "yes",
      transcriptQuality: null,
      comment: privateComment
    });

    const failed = await createReadyCall(
      repository,
      ownerUserId,
      input("+41710000052", "en-GB")
    );
    const failedAttempt = await repository.startAttempt(failed.id, {
      provider: "twilio",
      userId: ownerUserId
    });
    await repository.attachProviderCall(
      failedAttempt.attempt.id,
      "CA-admin-failed",
      "queued"
    );
    await repository.applyProviderStatus(
      "CA-admin-failed",
      "no-answer",
      "failed",
      failed.id
    );
    await repository.recordSystemCallOutcome(failed.id);

    await createReadyCall(
      repository,
      ownerUserId,
      input("+41710000053", "en-GB")
    );

    const firstPage = await repository.listAdminCalls({ limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const cursor = decodeAdminCallCursor(firstPage.nextCursor!);
    expect(cursor).not.toBeNull();
    const secondPage = await repository.listAdminCalls({
      limit: 1,
      cursor: cursor!
    });
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    const resolved = await repository.listAdminCalls({
      limit: 20,
      outcome: "resolved",
      consent: "granted",
      locale: "de-CH"
    });
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]).toMatchObject({
      id: completed.id,
      ownerUserId,
      semanticOutcome: "resolved",
      outcomeProvenance: "user",
      technical: { consent: "granted", connection: "confirmed" }
    });
    expect(JSON.stringify(resolved)).not.toContain(privateComment);
    expect(resolved.items[0]).not.toHaveProperty("phoneNumber");
    expect(resolved.items[0]).not.toHaveProperty("recipientName");

    const providerFailures = await repository.listAdminCalls({
      limit: 20,
      failureStage: "provider"
    });
    expect(providerFailures.items.map(({ id }) => id)).toContain(failed.id);

    const inspector = await repository.getAdminCallInspector(completed.id);
    expect(inspector.timeline.map(({ sequence }) => sequence)).toEqual(
      [...inspector.timeline.map(({ sequence }) => sequence)]
        .sort((left, right) => left - right)
    );
    expect(inspector.timeline[0]).not.toHaveProperty("userId");
    expect(inspector.outcomeHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ provenance: "system", outcome: null }),
      expect.objectContaining({ provenance: "user", outcome: "resolved" })
    ]));
  });

  it("returns sensitive content only through a reasoned audited method", async () => {
    const repository = new InMemoryCallRepository();
    const ownerUserId = randomUUID();
    const actorUserId = randomUUID();
    const brief = await createReadyCall(
      repository,
      ownerUserId,
      input("+41710000054", "en-GB")
    );
    await repository.updateStatus(brief.id, "completed");
    await repository.submitOwnerCallFeedback(brief.id, ownerUserId, {
      idempotencyKey: randomUUID(),
      goalResult: "partly",
      transcriptQuality: null,
      comment: "Visible only after audited access"
    });

    const sensitive = await repository.getAdminCallSensitiveContent(
      brief.id,
      actorUserId,
      "Investigating support ticket 123"
    );
    expect(sensitive).toMatchObject({
      callBriefId: brief.id,
      phoneNumber: "+41710000054",
      feedbackComment: "Visible only after audited access"
    });
    expect(repository.sensitiveCallAccessEventsForTest()).toEqual([
      expect.objectContaining({
        callBriefId: brief.id,
        actorUserId,
        reason: "Investigating support ticket 123"
      })
    ]);
  });
});
