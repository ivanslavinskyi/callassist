import { expect, it } from "vitest";
import { createSpokenIdentities } from "@callassist/contracts";
import { approvedCall } from "./voice-test-helpers";
import { executionData, liveExecutionContext, managedBackendInstructions } from "./live-managed-tools";
import { buildLiveInstructions } from "./live-conversation";
import type { VoiceConversationContext } from "./voice-runtime";

it("projects only known identities into every Live prompt without changing the approved plan", async () => {
  const call = await approvedCall(undefined, undefined, "de-CH");
  try {
    const snapshot = structuredClone(call.snapshot);
    snapshot.runtime.spokenIdentities = createSpokenIdentities("de-CH", "Иван", "Юлия Петрова");
    snapshot.plan.localizedObjective = "Иван fragen, was er zum Mittagessen möchte.";
    snapshot.plan.opening.recipientAddress = "Guten Tag, Иван.";
    snapshot.plan.backgroundSummary = "Юлия Петрова fragt nach dem Mittagessen.";
    snapshot.plan.successCriteria = ["Иван hat seine Wahl genannt."];
    const parties = { recipientName: "Иван", representedPerson: "Юлия Петрова" };
    const original = JSON.stringify(snapshot);
    const context = { snapshot, brief: { ...call.brief, ...parties } } as VoiceConversationContext;
    const prompts = [buildLiveInstructions(context), JSON.stringify(executionData(snapshot, parties)),
      ...liveExecutionContext(snapshot, parties), managedBackendInstructions(snapshot, parties)].join("\n");
    expect(prompts).toContain("Ivan fragen");
    expect(prompts).toContain("Yuliya Petrova");
    expect(prompts).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(JSON.stringify(snapshot)).toBe(original);
  } finally { await call.service.close(); }
});
