import { describe, expect, it } from "vitest";
import type { LanguageCapabilities } from "./api";
import { canGenerateText } from "./text-capabilities";

const enabled: LanguageCapabilities = {
  textLanguages: ["ru"], selectableCallLanguages: ["de-CH"], textGenerationEnabled: true, processorMode: "openai",
  operations: [{ kind: "plan_review", sourceLanguage: "de", targetLanguage: "ru" },
    { kind: "transcript_translation", sourceLanguage: "de", targetLanguage: "ru" },
    { kind: "call_summary", sourceLanguage: "de", targetLanguage: "ru" }]
};

describe("text generation capability boundaries", () => {
  it("requires the global generation switch even when the configured direction remains listed", () => {
    expect(canGenerateText(enabled, "plan_review", "de-CH", "ru")).toBe(true);
    expect(canGenerateText({ ...enabled, textGenerationEnabled: false }, "plan_review", "de-CH", "ru")).toBe(false);
    expect(canGenerateText(null, "plan_review", "de-CH", "ru")).toBe(false);
  });

  it("does not infer transcript or summary source language from the selected German call locale", () => {
    for (const kind of ["transcript_translation", "call_summary"] as const) {
      expect(canGenerateText(enabled, kind, "*", "ru")).toBe(false);
      expect(canGenerateText({ ...enabled, operations: [{ kind, sourceLanguage: "*", targetLanguage: "ru" }] }, kind, "*", "ru")).toBe(true);
    }
  });
});
