import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { type CallCompilation } from "@callassist/contracts";
import { TranslatedPlanReview } from "../components/translated-plan-review";

vi.mock("../components/use-text-capabilities", () => ({
  useTextCapabilities: () => { throw new Error("Preparation recovery must not wait for translation capabilities"); }
}));
vi.mock("../components/use-call-text-artifacts", () => ({
  useCallTextArtifacts: () => { throw new Error("Preparation recovery must not fetch translations"); }
}));
afterEach(() => vi.unstubAllGlobals());

it("shows preparation retry immediately without asking the user to fix the input language", () => {
  vi.stubGlobal("React", React);
  const compilation = { rawBrief: { locale: "de-CH" }, compiledBrief: null,
    policyDecision: { status: "blocked", reasonCodes: ["plan_constraint_failure"], clarificationQuestions: [] }
  } as unknown as CallCompilation;
  const html = renderToStaticMarkup(React.createElement(TranslatedPlanReview, {
    callId: "call", userId: "user", compilation, busy: false, recipientName: "Testbüro",
    source: { compilationId: "source", revision: 1, snapshotHash: "a".repeat(64), reviewPolicyVersion: 2 },
    languageContext: { taskContentLanguage: "ru", selectionSource: "detection", selectionRevision: 1,
      detectedInputLanguage: "ru", detectionStatus: "detected", compilationRevision: 1 },
    onAnswerClarifications: async () => undefined, onApproveAndCall: vi.fn(), onEdit: vi.fn(), onRetryPreparation: vi.fn()
  }));
  expect(html).toContain("SHPROHLI could not prepare a reliable plan. Your request is saved.");
  expect(html).toContain("Retry preparation");
  expect(html).not.toContain("Approve &amp; call");
  expect(html).not.toContain("translation");
  expect(html).not.toContain("plan_constraint_failure");
});
