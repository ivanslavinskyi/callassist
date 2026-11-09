import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import { evaluatePreparation } from "./preparation-evaluation";
import { preparationRoleEvaluationCorpus } from "./preparation-role-evaluation";

describe("preparation role evaluation corpus", () => {
  it("has source-grounded expectations for recipient, principal, third-party and corrected subjects", () => {
    const cases = preparationRoleEvaluationCorpus(true);
    expect(new Set(cases.map(fixture => fixture.id)).size).toBe(cases.length);
    expect(cases.some(fixture => fixture.split === "holdout")).toBe(true);
    expect(new Set(cases.flatMap(fixture => fixture.roleReview!.expectedSubjects.map(subject => subject.role))))
      .toEqual(new Set(["recipient", "represented_person", "third_party"]));
    for (const fixture of cases) {
      const raw = normalizeCreateCallBriefInput(fixture.input);
      const source = [raw.objective, ...raw.clarificationAnswers.map(answer => answer.answer)].join("\n");
      for (const subject of fixture.roleReview!.expectedSubjects) expect(source).toContain(subject.sourceQuote);
      expect(fixture.roleReview!.fields).toContain("successCriteria");
    }
    const corrected = cases.find(fixture => fixture.id === "roles-clarified-subject-de-CH")!;
    expect(corrected.input.clarificationAnswers).toHaveLength(1);
    expect(corrected.roleReview!.expectedSubjects[0]).toMatchObject({ role: "recipient", name: "Lea Berger" });
  });

  it("keeps an offline status screen separate from unreviewed semantic correctness", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NO_PROVIDER_CALLS_IN_OFFLINE_EVAL"));
    try {
      const report = await evaluatePreparation({ profiles: [{ model: "gpt-5.6", serviceTier: "default" }],
        full: false, repetitions: 1, live: false, budgetUsdMicros: 0, suite: "roles" });
      expect(fetch).not.toHaveBeenCalled();
      expect(report).toMatchObject({ suite: "roles", semanticReview: "required", criticalFailures: null,
        committedMicros: 0, humanReviewed: false, promptVersion: "preparation-live-native-roles-2026-11-09" });
      expect(report.results).toHaveLength(6);
      expect(report.summary[0].criticalFailures).toBeNull();
      expect(report.results.every(result => result.roleReview && result.criticalFailure !== false)).toBe(true);
      expect(report.results.every(result => result.operations.length === 0)).toBe(true);
      for (const result of report.results) expect(result.compilation).toMatchObject({ compilerVersion: "brief-compiler-14" });
    } finally { fetch.mockRestore(); }
  });

  it("allows an explicitly pinned baseline policy for the same role corpus", async () => {
    const report = await evaluatePreparation({ profiles: [{ model: "gpt-5.6", serviceTier: "default" }],
      full: false, repetitions: 1, live: false, budgetUsdMicros: 0, suite: "roles",
      promptVersion: "preparation-live-native-integrity-2026-11-08" });
    expect(report.promptVersion).toBe("preparation-live-native-integrity-2026-11-08");
    for (const result of report.results) expect(result.compilation).toMatchObject({ compilerVersion: "brief-compiler-13" });
  });
});
