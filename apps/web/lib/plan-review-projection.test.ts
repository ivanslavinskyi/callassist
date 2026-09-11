import { getAppointmentAuthorization, type AppointmentAuthorization, type CallCompilation, type CallTextArtifact, type PlanSource } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { currentPlanReviewArtifact, projectPlanReview } from "./plan-review-projection";

const source: PlanSource = { compilationId: "c1", revision: 1, snapshotHash: "a".repeat(64), reviewPolicyVersion: 2 };
const compilation = {
  snapshotHash: source.snapshotHash, revision: 1,
  rawBrief: { allowedFacts: ["A-17"], objective: "Is the application received?" },
  policyDecision: { status: "needs_clarification", clarificationQuestions: ["Which application?"], reasonCodes: [] },
  compiledBrief: {
    schemaVersion: "3",
    localizedObjective: "Eingang bestätigen", backgroundSummary: "", callLocale: "de-CH", sourceLanguage: "ru",
    taskType: "receipt_confirmation", tone: "formal", addressingStyle: "formal", resultHandling: "capture_in_callassist",
    opening: { recipientAddress: "Guten Tag", purposeStatement: "Ich rufe wegen A-17 an", readinessQuestion: "Haben Sie kurz Zeit?" },
    orderedQuestions: [{ text: "Ist A-17 eingegangen?", purpose: "Eingang prüfen", required: true }],
    conditionalFollowUps: [{ condition: "Wenn nicht", question: "Wie soll ich es senden?" }],
    successCriteria: ["Eingang geklärt"], unresolvedCriteria: ["Keine Auskunft"], stopConditions: ["Ablehnung"],
    approvedFacts: [{ sourceText: "A-17", callLanguageText: "A-17" }], prohibitedActions: ["Keine Zusagen"],
    blockingIssues: [{ code: "missing_request_detail", question: "Welcher Antrag?" }],
    riskCategories: [], namedEntities: [], assumptions: []
  }
} as unknown as CallCompilation;
const ids = ["localizedObjective", "opening.recipientAddress", "opening.purposeStatement", "opening.readinessQuestion", "orderedQuestions.0.text", "orderedQuestions.0.purpose", "conditionalFollowUps.0.condition", "conditionalFollowUps.0.question", "successCriteria.0", "unresolvedCriteria.0", "stopConditions.0", "approvedFacts.0.callLanguageText", "prohibitedActions.0", "blockingIssues.0.question", "policyDecision.clarificationQuestions.0"];
function artifact(): CallTextArtifact {
  return { id: "a1", kind: "plan_review", status: "ready", compilationId: source.compilationId, sourceHash: source.snapshotHash,
    payloadHash: "b".repeat(64), targetLanguage: "ru", payload: { fields: ids.map((id) => ({ id, text: `Перевод ${id}` })) }
  } as CallTextArtifact;
}
const appointmentAuthorization: AppointmentAuthorization = {
  operation: "book", serviceDescription: "Anmeldung im Gemeindeamt", providerScope: "called_recipient", timeZone: "Europe/Zurich",
  windows: [{ date: "2026-09-18", startTime: "09:00", endTime: "12:00" }, { date: "2026-09-19", startTime: "10:30", endTime: "10:30" }],
  selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms"
};
function withAuthorization(authorization: AppointmentAuthorization | null): CallCompilation {
  return { ...structuredClone(compilation), compiledBrief: { ...structuredClone(compilation.compiledBrief!), schemaVersion: "4", appointmentAuthorization: authorization } };
}
function appointmentArtifact(): CallTextArtifact {
  const ready = artifact();
  const fields = (ready.payload as { fields: Array<{ id: string; text: string }> }).fields;
  return { ...ready, payload: { fields: [...fields, { id: "appointmentAuthorization.serviceDescription", text: "Регистрация в муниципалитете" }] } };
}

describe("translated plan projection", () => {
  it("translates only the appointment service while preserving the exact original authorization and approval binding", () => {
    for (const operation of ["book", "confirm_existing"] as const) {
      const authorization = { ...structuredClone(appointmentAuthorization), operation,
        windows: operation === "confirm_existing" ? [structuredClone(appointmentAuthorization.windows[1]!)] : structuredClone(appointmentAuthorization.windows) };
      const original = withAuthorization(authorization);
      const before = structuredClone(original);
      const ready = appointmentArtifact();
      const display = projectPlanReview(original, source, ready);
      expect(display).not.toBeNull();
      expect(getAppointmentAuthorization(display!.compiledBrief!)).toEqual({ ...authorization, serviceDescription: "Регистрация в муниципалитете" });
      expect(display?.snapshotHash).toBe(original.snapshotHash);
      expect(display?.revision).toBe(original.revision);
      expect(display?.rawBrief).toEqual(original.rawBrief);
      expect(display?.policyDecision.status).toBe(original.policyDecision.status);
      expect(display?.policyDecision.reasonCodes).toEqual(original.policyDecision.reasonCodes);
      expect(original).toEqual(before);
      expect(currentPlanReviewArtifact([ready], original, source, "ru", "plan_review")).toBe(ready);
      expect(projectPlanReview(original, { ...source, snapshotHash: "c".repeat(64) }, ready)).toBeNull();
    }
  });
  it("rejects omitted appointment descriptions and any attempted translation of permission fields", () => {
    const original = withAuthorization(structuredClone(appointmentAuthorization));
    const ready = appointmentArtifact();
    const fields = (ready.payload as { fields: Array<{ id: string; text: string }> }).fields;
    expect(projectPlanReview(original, source, artifact())).toBeNull();
    for (const id of ["operation", "providerScope", "timeZone", "windows.0.date", "windows.0.startTime", "windows.0.endTime", "selection", "maxAppointments", "financialPolicy"]) {
      expect(projectPlanReview(original, source, { ...ready, payload: { fields: [...fields, { id: `appointmentAuthorization.${id}`, text: "changed" }] } })).toBeNull();
    }
  });
  it("leaves legacy and explicitly absent appointment authority unchanged", () => {
    for (const original of [compilation, withAuthorization(null)]) {
      const display = projectPlanReview(original, source, artifact());
      expect(display).not.toBeNull();
      expect(getAppointmentAuthorization(display!.compiledBrief!)).toBeNull();
      expect(projectPlanReview(original, source, appointmentArtifact())).toBeNull();
    }
    expect(projectPlanReview(compilation, source, artifact())?.compiledBrief).not.toHaveProperty("appointmentAuthorization");
    expect(projectPlanReview(withAuthorization(null), source, artifact())?.compiledBrief).toHaveProperty("appointmentAuthorization", null);
  });
  it("retains a valid saved reader and its approval hash when a newer generator fails for the same source", () => {
    const saved = { ...artifact(), createdAt: "2026-09-09T12:00:00Z" };
    const failed = { ...saved, id: "failed-new-generator", status: "failed" as const, payload: null, payloadHash: null,
      createdAt: "2026-09-09T13:00:00Z" };
    const foreign = { ...saved, id: "foreign", compilationId: "other", createdAt: "2026-09-09T14:00:00Z" };
    expect(currentPlanReviewArtifact([foreign, failed, saved], compilation, source, "ru", "plan_review")).toBe(saved);
    expect(currentPlanReviewArtifact([foreign, failed, saved], compilation, source, "uk", "plan_review")).toBeUndefined();
    expect(currentPlanReviewArtifact([saved], compilation, { ...source, compilationId: "next" }, "ru", "plan_review")).toBeUndefined();
  });
  it("changes only the declared readable leaves and keeps the original immutable", () => {
    const display = projectPlanReview(compilation, source, artifact());
    expect(display?.compiledBrief?.localizedObjective).toBe("Перевод localizedObjective");
    expect(display?.compiledBrief?.orderedQuestions[0]?.required).toBe(true);
    expect(display?.compiledBrief?.approvedFacts[0]?.sourceText).toBe("A-17");
    expect(display?.compiledBrief?.blockingIssues[0]?.code).toBe(compilation.compiledBrief?.blockingIssues[0]?.code);
    expect(display?.rawBrief).toEqual(compilation.rawBrief);
    expect(display?.snapshotHash).toBe(compilation.snapshotHash);
    expect(compilation.compiledBrief?.localizedObjective).toBe("Eingang bestätigen");
  });
  it("rejects missing fields, duplicate fields, nontext policy changes and foreign sources", () => {
    const ready = artifact();
    const fields = (ready.payload as { fields: Array<{ id: string; text: string }> }).fields;
    for (const candidate of [
      { ...ready, compilationId: "other" }, { ...ready, sourceHash: "c".repeat(64) }, { ...ready, status: "stale" as const },
      { ...ready, payload: { fields: fields.slice(1) } },
      { ...ready, payload: { fields: [...fields, fields[0]!] } },
      { ...ready, payload: { fields: [...fields, { id: "policyDecision.status", text: "ready_for_review" }] } },
      { ...ready, payload: { fields: [...fields, { id: "__proto__.polluted", text: "yes" }] } }
    ]) expect(projectPlanReview(compilation, source, candidate)).toBeNull();
  });
});
