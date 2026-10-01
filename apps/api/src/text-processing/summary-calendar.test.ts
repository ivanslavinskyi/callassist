import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CallSummaryPayload, SummarySourceContext } from "@callassist/contracts";
import { composeCalendarSummary } from "./summary-calendar";
import { validateTextProcessingOutput } from "./text-validation";
import type { TextProcessingInput } from "./text-processor";

export const calendarContext: SummarySourceContext = { version: 1, callAttemptId: randomUUID(), compilationId: randomUUID(), compilationSnapshotHash: "a".repeat(64),
  transcriptRevisionId: randomUUID(), transcriptSourceHash: "b".repeat(64), callCreatedAt: "2026-10-01T08:08:43.772Z",
  callConnectedAt: "2026-10-01T08:08:50.246Z", callEndedAt: "2026-10-01T08:10:22.315Z", approvedAt: "2026-10-01T08:08:43.000Z",
  appointmentAuthorization: { operation: "book", serviceDescription: "Sports massage", providerScope: "called_recipient", timeZone: "Europe/Zurich",
    windows: [{ date: "2026-10-03", startTime: "09:00", endTime: "18:00" }], selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms" }, actionEvidence: null };
const extraction = () => ({ candidates: [{ id: "slot", date: "2026-10-03", startTime: "11:00", timeZone: "Europe/Zurich",
  zoneSource: "approved_plan" as const, status: "reported_confirmed" as const, supersedes: [], sourceSegmentIds: ["ask", "answer"] }],
  conditions: [{ checkId: "criterion.0", kind: "calendar_only" as const, candidateId: "slot" }] });
const summary = (): CallSummaryPayload => ({ schemaVersion: 3, overview: [{ label: "Result", text: "The recipient confirmed the appointment.", findingIds: ["goal"] }],
  findings: [{ id: "goal", label: "Result", text: "The recipient confirmed the appointment.", certainty: "reported", sourceSegmentIds: ["ask", "answer"] },
    { id: "criterion.0", label: "Time", text: "The recipient confirmed the time.", certainty: "reported", sourceSegmentIds: ["ask", "answer"] }],
  nextSteps: [], unresolved: [], unresolvedDetails: [], appointmentExtraction: extraction(),
  assessment: { conversation: { status: "confirmed", category: "task_answer", questionSegmentId: "ask", answerSegmentId: "answer", answerQuote: "Yes, confirmed." },
    goal: { status: "achieved", sourceSegmentIds: ["answer"] }, criteria: [{ id: "criterion.0", status: "achieved", sourceSegmentIds: ["answer"] }] } });
const input = (): Extract<TextProcessingInput, {kind: "call_summary"}> => ({ kind: "call_summary", targetLanguage: "en", sourceContext: calendarContext,
  context: { objective: "Book a massage", taskType: "appointment", recipient: "Office", representedPerson: "Example Person" },
  checks: [{ id: "goal", text: "Book a massage" }, { id: "criterion.0", text: "Within the next two weeks" }], assessmentMode: "evaluate",
  segments: [{ id: "ask", role: "assistant", text: "Saturday, October third, at eleven?", startSeconds: 0, endSeconds: 1 },
    { id: "answer", role: "recipient", text: "Yes, confirmed.", startSeconds: 2, endSeconds: 3 }] });

describe("server calendar composition", () => {
  it("resolves the date while preserving the missing application confirmation", () => {
    expect(() => validateTextProcessingOutput(input(), summary())).not.toThrow();
    const result = composeCalendarSummary(summary(), calendarContext, "ru");
    expect(result.calendar).toMatchObject({ eligibility: "within", actionState: "unconfirmed", windowIndex: 0, startsAt: "2026-10-03T09:00:00.000Z" });
    expect(result.calendar!.sourceText).toContain("3 октября 2026");
    expect(result.assessment!.criteria[0]!.status).toBe("achieved");
    expect(result.assessment!.goal.status).toBe("partial");
    expect(result.unresolved).toEqual([]);
    expect(result.overview[0]!.text).toBe(summary().overview[0]!.text);
  });
  it.each(["en", "de", "fr", "it", "ru", "uk"] as const)("renders calendar provenance in %s", language => {
    const result = composeCalendarSummary(summary(), calendarContext, language);
    expect(result.calendar!.text.length).toBeGreaterThan(20);
    expect(result.calendar!.sourceText).toContain("09:00–18:00");
  });
  it("retains a composite semantic uncertainty even when the calendar matches", () => {
    const s = summary(); s.appointmentExtraction!.conditions[0]!.kind = "combined";
    s.assessment!.criteria[0]!.status = "uncertain";
    expect(composeCalendarSummary(s, calendarContext, "en").assessment!.criteria[0]!.status).toBe("uncertain");
  });
  it("applies mandatory bounds even if the model omits all conditions", () => {
    const s = summary(); s.appointmentExtraction!.conditions = [];
    s.appointmentExtraction!.candidates[0]!.startTime = "18:01";
    expect(composeCalendarSummary(s, calendarContext, "en")).toMatchObject({ calendar: { eligibility: "outside" }, assessment: { goal: { status: "partial" } } });
  });
  it("uses explicit corrections and refuses competing final dates", () => {
    const s = summary(); const first = s.appointmentExtraction!.candidates[0]!;
    first.date = "2026-10-02";
    s.appointmentExtraction!.candidates.push({ ...first, id: "correction", date: "2026-10-03", supersedes: ["slot"] });
    expect(composeCalendarSummary(s, calendarContext, "en").calendar!.eligibility).toBe("within");
    s.appointmentExtraction!.candidates[1]!.supersedes = [];
    expect(composeCalendarSummary(s, calendarContext, "en").calendar!.reason).toBe("conflicting_candidates");
  });
  it("rejects injected trusted findings, foreign references and conversational numeric leakage", () => {
    const s = summary(); const enriched = composeCalendarSummary(s, calendarContext, "en");
    expect(() => validateTextProcessingOutput(input(), enriched)).toThrow();
    s.appointmentExtraction!.candidates[0]!.sourceSegmentIds = ["foreign"];
    expect(() => validateTextProcessingOutput(input(), s)).toThrow();
    s.appointmentExtraction = extraction(); s.findings[0]!.text = "The call was on 2026-10-01.";
    expect(() => validateTextProcessingOutput(input(), s)).toThrow();
  });
  it("does not add authority to an information task", () => {
    const i = input(); i.sourceContext = { ...calendarContext, appointmentAuthorization: null };
    expect(() => validateTextProcessingOutput(i, summary())).toThrow();
  });
});
