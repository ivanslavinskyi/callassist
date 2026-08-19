import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import {
  CallRepositoryError,
  type CallAdmissionPolicy
} from "./call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";

const ledgerTestPolicy: CallAdmissionPolicy = {
  maxStartsPerHour: 20,
  maxStartsPerDay: 20,
  maxStartsPerRecipientPerDay: 20,
  maxDurationSeconds: 900
};

const baseInput: CreateCallBriefInput = {
  recipientName: "Credit test office",
  phoneNumber: "+41710000004",
  objective: "Verify credit accounting before making the outbound call",
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

describe("credit ledger", () => {
  it("grants exactly three signup credits once and serializes active calls", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    await repository.grantSignupCredits(userId);
    const first = await createReadyCall(repository, userId, "A");
    const second = await createReadyCall(repository, userId, "B");

    const results = await Promise.allSettled([
      repository.startAttempt(first.id, { provider: "twilio", userId }),
      repository.startAttempt(second.id, { provider: "twilio", userId })
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      reason: expect.objectContaining({ code: "CONCURRENT_CALL_LIMIT" })
    });
    const usage = await repository.getCreditUsage(userId);
    expect(usage).toMatchObject({ balance: 2 });
    expect(usage.activeCallBriefId).not.toBeNull();
    expect(usage.transactions.map(({ type }) => type)).toEqual([
      "call_reservation",
      "signup_grant"
    ]);
  });

  it.each(["busy", "no-answer", "canceled", "failed"] as const)(
    "refunds %s before connection even when webhooks repeat",
    async (terminalStatus) => {
      const repository = new InMemoryCallRepository();
      const userId = randomUUID();
      await repository.grantSignupCredits(userId);
      const brief = await createReadyCall(repository, userId, "charged");
      const started = await repository.startAttempt(brief.id, {
        provider: "twilio",
        userId
      });
      const providerCallId = `CA-${terminalStatus}`;
      await repository.attachProviderCall(
        started.attempt.id,
        providerCallId,
        "queued"
      );
      await repository.applyProviderStatus(
        providerCallId,
        "ringing",
        "dialing",
        brief.id
      );
      await repository.applyProviderStatus(
        providerCallId,
        terminalStatus,
        "failed",
        brief.id
      );
      await repository.applyProviderStatus(
        providerCallId,
        terminalStatus,
        "failed",
        brief.id
      );

      const usage = await repository.getCreditUsage(userId);
      expect(usage.balance).toBe(3);
      expect(usage.activeCallBriefId).toBeNull();
      expect(usage.transactions.filter(({ type }) => type === "call_charge"))
        .toHaveLength(0);
      expect(usage.transactions.filter(({ type }) => type === "call_refund"))
        .toHaveLength(1);
    }
  );

  it("charges exactly once after the recipient answers", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId, "answered");
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId
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

    const usage = await repository.getCreditUsage(userId);
    expect(usage.balance).toBe(2);
    expect(usage.activeCallBriefId).toBeNull();
    expect(usage.transactions.filter(({ type }) => type === "call_charge"))
      .toHaveLength(1);
    expect(usage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(0);
  });

  it("refunds a pre-dial failure exactly once and never allows a negative balance", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const failedBrief = await createReadyCall(repository, userId, "refunded");
    await repository.startAttempt(failedBrief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: ledgerTestPolicy
    });
    await repository.updateStatus(failedBrief.id, "failed");
    await repository.updateStatus(failedBrief.id, "failed");

    let usage = await repository.getCreditUsage(userId);
    expect(usage.balance).toBe(3);
    expect(usage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(1);

    for (const suffix of ["one", "two", "three"]) {
      const brief = await createReadyCall(repository, userId, suffix);
      const attempt = await repository.startAttempt(brief.id, {
        provider: "twilio",
        userId,
        admissionPolicy: ledgerTestPolicy
      });
      await repository.attachProviderCall(
        attempt.attempt.id,
        `CA-${suffix}`,
        "ringing"
      );
      await repository.applyProviderStatus(
        `CA-${suffix}`,
        "completed",
        "completed",
        brief.id
      );
    }
    usage = await repository.getCreditUsage(userId);
    expect(usage.balance).toBe(0);

    const denied = await createReadyCall(repository, userId, "denied");
    await expect(
      repository.startAttempt(denied.id, {
        provider: "twilio",
        userId,
        admissionPolicy: ledgerTestPolicy
      })
    ).rejects.toEqual(expect.objectContaining<Partial<CallRepositoryError>>({
      code: "INSUFFICIENT_CREDITS"
    }));
    expect((await repository.getCreditUsage(userId)).balance).toBe(0);
  });
});
