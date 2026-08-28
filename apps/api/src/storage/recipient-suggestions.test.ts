import { randomUUID } from "node:crypto";
import type { CreateCallBriefInput } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "./in-memory-call-repository";

const baseInput = {
  objective: "Ask for the organisation's opening hours next Monday",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Nina",
  representedPersonLastName: "Keller",
  assistanceReason: "speech_impairment",
  locale: "de-CH",
  allowLanguageSwitch: false,
  allowedFacts: []
} satisfies Omit<CreateCallBriefInput, "recipientName" | "phoneNumber">;

describe("recipient suggestions", () => {
  it("scopes, searches, deduplicates, limits, and excludes deleted call data", async () => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository);
    const userA = randomUUID();
    const userB = randomUUID();

    try {
      await service.create({
        ...baseInput,
        recipientName: "Beta Clinic",
        phoneNumber: "+41710000002"
      }, userA);
      await service.create({
        ...baseInput,
        recipientName: "Beta  Clinic",
        phoneNumber: "+41710000002"
      }, userA);
      await service.create({
        ...baseInput,
        recipientName: "Alpine Council",
        phoneNumber: "+41710000003"
      }, userA);
      await service.create({
        ...baseInput,
        recipientName: "Other User Clinic",
        phoneNumber: "+41710000004"
      }, userB);
      const deleted = await service.create({
        ...baseInput,
        recipientName: "Deleted Recipient",
        phoneNumber: "+41710000005"
      }, userA);
      await repository.updateStatus(deleted.id, "stopped");
      await repository.deleteCallData({
        callId: deleted.id,
        userId: userA,
        requestId: randomUUID(),
        providerRecordingDisposition: "not_present",
        deletedAt: new Date().toISOString()
      });

      const all = await repository.listRecipientSuggestions({ userId: userA, limit: 10 });
      expect(all.items).toHaveLength(2);
      expect(all.items.map(({ recipientName }) => recipientName)).not.toContain("Other User Clinic");
      expect(all.items.map(({ recipientName }) => recipientName)).not.toContain("Deleted Recipient");

      const searched = await repository.listRecipientSuggestions({
        userId: userA,
        query: "clinic",
        limit: 10
      });
      expect(searched.items).toHaveLength(1);
      expect(searched.items[0]).toMatchObject({ phoneNumber: "+41710000002" });

      const limited = await repository.listRecipientSuggestions({ userId: userA, limit: 1 });
      expect(limited.items).toHaveLength(1);
    } finally {
      await service.close();
    }
  });
});
