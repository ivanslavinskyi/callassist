import { describe, expect, it } from "vitest";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { hasValidCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { historyObjective } from "./history-objective";

async function compilation() {
  return new DeterministicBriefCompiler().compile(normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41523686688",
    objective: "Узнать часы работы офиса", assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Owner", locale: "de-CH", allowedFacts: [] }));
}
describe("history objective projection", () => {
  it("preserves input text when no source-language compiled summary exists", async () => {
    const value = await compilation();
    expect(historyObjective(value).displayObjective).toBe(value.rawBrief.objective);
    expect(historyObjective(null).displayObjective).toBeNull();
  });
  it("uses saved display metadata without changing the historical execution hash", async () => {
    const value = await compilation();
    const enriched = { ...value, displayObjective: { text: "Часы работы", language: "ru" } };
    expect(hasValidCompilationSnapshotHash(enriched)).toBe(true);
    expect(historyObjective(enriched)).toEqual({ displayObjective: "Часы работы", objectiveLanguage: "ru" });
  });
  it("uses only a ready translation for the current source and original input language", async () => {
    const value = await compilation();
    value.compiledBrief!.sourceLanguage = "ru";
    const artifact = { kind: "plan_review" as const, status: "ready" as const, sourceHash: value.snapshotHash,
      targetLanguage: "ru", payload: { fields: [{ id: "localizedObjective", text: "Уточнить часы работы" }] } };
    expect(historyObjective(value, [artifact]).displayObjective).toBe("Уточнить часы работы");
    for (const wrong of [{ ...artifact, targetLanguage: "fr" }, { ...artifact, sourceHash: "outdated" }, { ...artifact, status: "failed" as const }]) {
      expect(historyObjective(value, [wrong]).displayObjective).toBe(value.rawBrief.objective);
    }
  });
});
