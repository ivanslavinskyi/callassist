import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import type { CallAdmissionPolicy } from "./call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";

const generousPolicy: CallAdmissionPolicy = {
  maxStartsPerHour: 20,
  maxStartsPerDay: 20,
  maxStartsPerRecipientPerDay: 20,
  maxDurationSeconds: 900
};

async function createReadyCall(
  repository: InMemoryCallRepository,
  userId: string,
  phoneNumber: string,
  suffix: string
) {
  const input: CreateCallBriefInput = {
    recipientName: `Safety test ${suffix}`,
    phoneNumber,
    objective: "Verify outbound call admission controls",
    assistantProfileId: "sebastian",
    representedPersonFirstName: "Nina",
    representedPersonLastName: "Keller",
    assistanceReason: "speech_impairment",
    locale: "en-GB",
    allowLanguageSwitch: false,
    allowedFacts: []
  };
  const compilation = await new DeterministicBriefCompiler().compile(
    normalizeCreateCallBriefInput(input)
  );
  const brief = await repository.create(input, compilation, userId);
  await repository.approveCompilation(brief.id);
  return brief;
}

describe("call admission controls", () => {
  it("blocks suppressed recipients before reservation and supports an audited lift boundary", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    const phoneE164 = "+41790000001";
    await repository.grantSignupCredits(userId);
    const brief = await createReadyCall(repository, userId, phoneE164, "suppressed");
    await repository.suppressRecipient({
      phoneE164,
      source: "recipient_request",
      reason: "Recipient opted out"
    });

    await expect(repository.startAttempt(brief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: generousPolicy
    })).rejects.toMatchObject({ code: "RECIPIENT_SUPPRESSED" });
    expect((await repository.getCreditUsage(userId)).balance).toBe(3);

    await repository.liftRecipientSuppression(phoneE164, {
      reason: "Recipient withdrew the opt-out"
    });
    await expect(repository.startAttempt(brief.id, {
      provider: "twilio",
      userId,
      admissionPolicy: generousPolicy
    })).resolves.toBeDefined();
  });

  it("blocks new reservations with the kill switch without ending an active call", async () => {
    const repository = new InMemoryCallRepository();
    const userId = randomUUID();
    await repository.grantSignupCredits(userId);
    const active = await createReadyCall(
      repository,
      userId,
      "+41790000002",
      "active"
    );
    const waiting = await createReadyCall(
      repository,
      userId,
      "+41790000003",
      "waiting"
    );
    await repository.startAttempt(active.id, {
      provider: "twilio",
      userId,
      admissionPolicy: generousPolicy
    });
    await repository.setOutboundCallsEnabled(false, {
      reason: "Emergency pause test"
    });

    expect((await repository.get(active.id))?.brief.status).toBe("dialing");
    await expect(repository.startAttempt(waiting.id, {
      provider: "twilio",
      userId,
      admissionPolicy: generousPolicy
    })).rejects.toMatchObject({ code: "OUTBOUND_CALLS_DISABLED" });
    expect((await repository.getCreditUsage(userId)).balance).toBe(2);

    await repository.setOutboundCallsEnabled(true, {
      reason: "Emergency pause cleared"
    });
    await repository.updateStatus(active.id, "failed");
    await expect(repository.startAttempt(waiting.id, {
      provider: "twilio",
      userId,
      admissionPolicy: generousPolicy
    })).resolves.toBeDefined();
  });

  it("counts refunded starts toward hourly, daily, and recipient limits", async () => {
    const cases: Array<{
      expectedCode: string;
      policy: CallAdmissionPolicy;
      phones: string[];
    }> = [
      {
        expectedCode: "HOURLY_CALL_LIMIT",
        policy: { ...generousPolicy, maxStartsPerHour: 2 },
        phones: ["+41790000004", "+41790000005", "+41790000006"]
      },
      {
        expectedCode: "DAILY_CALL_LIMIT",
        policy: { ...generousPolicy, maxStartsPerDay: 2 },
        phones: ["+41790000007", "+41790000008", "+41790000009"]
      },
      {
        expectedCode: "RECIPIENT_REPEAT_LIMIT",
        policy: { ...generousPolicy, maxStartsPerRecipientPerDay: 2 },
        phones: ["+41790000010", "+41790000010", "+41790000010"]
      }
    ];

    for (const { expectedCode, policy, phones } of cases) {
      const repository = new InMemoryCallRepository();
      const userId = randomUUID();
      await repository.grantSignupCredits(userId);
      for (const [index, phone] of phones.entries()) {
        const brief = await createReadyCall(repository, userId, phone, `${expectedCode}-${index}`);
        if (index < 2) {
          await repository.startAttempt(brief.id, {
            provider: "twilio",
            userId,
            admissionPolicy: policy
          });
          await repository.updateStatus(brief.id, "failed");
        } else {
          await expect(repository.startAttempt(brief.id, {
            provider: "twilio",
            userId,
            admissionPolicy: policy
          })).rejects.toMatchObject({ code: expectedCode });
        }
      }
      expect((await repository.getCreditUsage(userId)).balance).toBe(3);
    }
  });
});
