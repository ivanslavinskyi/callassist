import type { AppointmentAuthorization, CallCompilation } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { planReviewFields } from "./plan-review-fields";

const authorization: AppointmentAuthorization = {
  operation: "book", serviceDescription: "Anmeldung im Gemeindeamt", providerScope: "called_recipient", timeZone: "Europe/Zurich",
  windows: [{ date: "2026-09-18", startTime: "09:00", endTime: "12:00" }, { date: "2026-09-19", startTime: "10:30", endTime: "10:30" }],
  selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms"
};
const legacy = {
  compiledBrief: { schemaVersion: "3", localizedObjective: "Nach einem passenden Termin fragen.", backgroundSummary: "",
    opening: { recipientAddress: "Guten Tag.", purposeStatement: "Terminfrage", readinessQuestion: "Haben Sie Zeit?" },
    orderedQuestions: [], conditionalFollowUps: [], successCriteria: [], unresolvedCriteria: [], stopConditions: [], prohibitedActions: [],
    approvedFacts: [], blockingIssues: [] },
  policyDecision: { clarificationQuestions: [] }
} as unknown as CallCompilation;

describe("appointment review translation fields", () => {
  it("adds only the service description and never emits execution controls for translation", () => {
    for (const operation of ["book", "confirm_existing"] as const) {
      const compilation = { ...structuredClone(legacy), compiledBrief: { ...structuredClone(legacy.compiledBrief!), schemaVersion: "4" as const,
        appointmentAuthorization: { ...structuredClone(authorization), operation,
          windows: operation === "confirm_existing" ? [structuredClone(authorization.windows[1]!)] : structuredClone(authorization.windows) } } };
      const before = structuredClone(compilation);
      const fields = planReviewFields(compilation);
      expect(fields.filter((field) => field.id.startsWith("appointmentAuthorization."))).toEqual([
        { id: "appointmentAuthorization.serviceDescription", text: authorization.serviceDescription }
      ]);
      expect(fields).toHaveLength(planReviewFields(legacy).length + 1);
      expect(compilation).toEqual(before);
    }
  });

  it("keeps old plans and current plans without appointment permission unchanged", () => {
    const absent = { ...legacy, compiledBrief: { ...legacy.compiledBrief!, schemaVersion: "4" as const, appointmentAuthorization: null } };
    expect(planReviewFields(absent)).toEqual(planReviewFields(legacy));
    expect(planReviewFields(absent).some((field) => field.id.startsWith("appointmentAuthorization."))).toBe(false);
  });
});
