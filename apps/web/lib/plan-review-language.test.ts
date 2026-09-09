import { describe, expect, it } from "vitest";
import type { LanguageCapabilities } from "./api";
import { canGenerateText } from "./text-capabilities";
import { planReviewLanguage } from "./plan-review-language";

const clarification = {
  rawBrief: { locale: "de-CH" as const },
  compiledBrief: { sourceLanguage: "ru", blockingIssues: [{ code: "missing_required_reference" as const, question: "Какой номер заявления?" }] },
  policyDecision: { status: "needs_clarification" as const, clarificationQuestions: ["Какой номер заявления?"] }
};
const context = { taskContentLanguage: "de" as const, detectedInputLanguage: "ru" };

describe("review language selection", () => {
  it("offers German help for Russian clarification even when the call is already German", () => {
    expect(planReviewLanguage(clarification, context)).toEqual({
      kind: "clarification_review", sourceLanguage: "ru", needsTranslation: true
    });
  });

  it("keeps a ready German call plan original despite a Russian objective", () => {
    expect(planReviewLanguage({ ...clarification,
      compiledBrief: { ...clarification.compiledBrief, blockingIssues: [] },
      policyDecision: { status: "ready_for_review", clarificationQuestions: [] }
    }, context)).toEqual({ kind: "plan_review", sourceLanguage: "de-CH", needsTranslation: false });
  });

  it("uses the clarification capability for blocked output and falls back to detected input", () => {
    expect(planReviewLanguage({ ...clarification, compiledBrief: null,
      policyDecision: { status: "blocked", clarificationQuestions: ["Уточните задачу"] }
    }, context)).toEqual({ kind: "clarification_review", sourceLanguage: "ru", needsTranslation: true });
  });

  it("requires a wildcard direction when clarification source is unknown", () => {
    const state = planReviewLanguage({ ...clarification,
      compiledBrief: { ...clarification.compiledBrief, sourceLanguage: "und" }
    }, { ...context, detectedInputLanguage: null });
    expect(state).toEqual({ kind: "clarification_review", sourceLanguage: "*", needsTranslation: true });
    const capabilities: LanguageCapabilities = {
      textLanguages: ["de", "ru"], selectableCallLanguages: ["de-CH"], textGenerationEnabled: true,
      processorMode: "openai", operations: [{ kind: "clarification_review", sourceLanguage: "de", targetLanguage: "de" }]
    };
    expect(canGenerateText(capabilities, state.kind, state.sourceLanguage, "de")).toBe(false);
    expect(canGenerateText({ ...capabilities, operations: [{ kind: "clarification_review", sourceLanguage: "*", targetLanguage: "de" }] },
      state.kind, state.sourceLanguage, "de")).toBe(true);
  });
});
