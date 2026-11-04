import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CallSummaryPayload, CallTextArtifact, SummarySourceContext } from "@callassist/contracts";
import { assertSummaryArtifactOutput, composeCalendarSummary } from "./summary-calendar";
import { textPayloadHash } from "../storage/call-text-repository";
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
  const confirmedContext = (): SummarySourceContext => ({ ...structuredClone(calendarContext), actionEvidence: {
    id: randomUUID(), version: 5, state: "confirmed", date: "2026-10-03", startTime: "11:00", timeZone: "Europe/Zurich"
  } });
  const withAlternative = (): CallSummaryPayload => {
    const value = summary();
    value.appointmentExtraction!.candidates.push({ ...value.appointmentExtraction!.candidates[0]!,
      id: "alternative", startTime: "11:30", status: "offered", sourceSegmentIds: ["offer"] });
    return value;
  };
  it("keeps a confirmed appointment when the recipient also offered an unselected alternative", () => {
    const source = withAlternative(), context = confirmedContext();
    const result = composeCalendarSummary(source, context, "ru");
    expect(result).toMatchObject({ calendar: { candidateId: "slot", eligibility: "within", actionState: "confirmed" },
      assessment: { goal: { status: "achieved" }, criteria: [{ status: "achieved" }] } });
    expect(result.appointmentExtraction).toEqual(source.appointmentExtraction);
    expect(source.calendar).toBeUndefined();
    expect(composeCalendarSummary(result, context, "ru")).toEqual(result);
  });
  it.each(["reported_confirmed", "conditional", "ambiguous"] as const)(
    "does not discard a competing %s as an unselected offer", status => {
      const source = withAlternative(); source.appointmentExtraction!.candidates[1]!.status = status;
      expect(composeCalendarSummary(source, confirmedContext(), "en")).toMatchObject({
        calendar: { reason: "conflicting_candidates", actionState: "unconfirmed" }, assessment: { goal: { status: "partial" } }
      });
    });
  it.each(["conditional", "ambiguous"] as const)("does not override a %s qualification of the same slot", status => {
    const source = withAlternative();
    Object.assign(source.appointmentExtraction!.candidates[1]!, { startTime: "11:00", status });
    expect(composeCalendarSummary(source, confirmedContext(), "en").assessment!.goal.status).toBe("partial");
  });
  it("does not promote availability to booking even when the journal is confirmed", () => {
    const source = withAlternative(); source.appointmentExtraction!.candidates[0]!.status = "offered";
    expect(composeCalendarSummary(source, confirmedContext(), "en").assessment!.goal.status).toBe("partial");
    source.appointmentExtraction!.candidates.pop();
    expect(composeCalendarSummary(source, confirmedContext(), "en").assessment!.goal.status).toBe("partial");
  });
  it.each([null, "sending", "delivered", "uncertain", "mismatch"] as const)("requires matching confirmed journal evidence: %s", state => {
    const context = confirmedContext();
    if (state === null) context.actionEvidence = null;
    else if (state === "mismatch") context.actionEvidence!.startTime = "11:30";
    else context.actionEvidence!.state = state;
    expect(composeCalendarSummary(withAlternative(), context, "en").assessment!.goal.status).toBe("partial");
  });
  it("does not discard a superseding offer or a correction in favor of the old confirmation", () => {
    const source = withAlternative(); source.appointmentExtraction!.candidates[1]!.supersedes = ["slot"];
    expect(composeCalendarSummary(source, confirmedContext(), "en").assessment!.goal.status).toBe("partial");
    source.appointmentExtraction!.candidates[1]!.status = "corrected";
    expect(composeCalendarSummary(source, confirmedContext(), "en").assessment!.goal.status).toBe("partial");
  });
  it("accepts repeated confirmation of the same slot without erasing semantic uncertainty", () => {
    const source = withAlternative();
    source.appointmentExtraction!.candidates.push({ ...source.appointmentExtraction!.candidates[0]!, id: "repeat" });
    expect(composeCalendarSummary(source, confirmedContext(), "en").assessment!.goal.status).toBe("achieved");
    source.appointmentExtraction!.conditions[0]!.kind = "combined";
    source.assessment!.criteria[0]!.status = "uncertain";
    expect(composeCalendarSummary(source, confirmedContext(), "en").assessment!.goal.status).toBe("partial");
  });
  it("retains calendar bounds and past-time guards after selecting the confirmed slot", () => {
    const context = confirmedContext(); context.appointmentAuthorization!.windows[0] = { date: "2026-10-03", startTime: "12:00", endTime: "18:00" };
    expect(composeCalendarSummary(withAlternative(), context, "en")).toMatchObject({
      calendar: { eligibility: "outside" }, assessment: { goal: { status: "partial" } }
    });
    context.appointmentAuthorization = structuredClone(calendarContext.appointmentAuthorization);
    context.callConnectedAt = "2026-10-04T08:00:00.000Z";
    expect(composeCalendarSummary(withAlternative(), context, "en")).toMatchObject({
      calendar: { eligibility: "within", pastAtReference: true }, assessment: { goal: { status: "partial" } }
    });
  });
  it("distinguishes an unmatched saved action from a missing confirmation", () => {
    const context = confirmedContext(); context.actionEvidence!.startTime = "11:30";
    const result = composeCalendarSummary(withAlternative(), context, "ru");
    expect(result.calendar!.actionText).toContain("сопоставить сохранённое действие");
    expect(result.calendar!.actionState).toBe("unconfirmed");
    expect(context.actionEvidence!.state).toBe("confirmed");
  });
  it.each(["summary-v4", "summary-v5"])("validates the pinned %s projection without rewriting historical results", version => {
    const context = confirmedContext(), generatorVersion = `${version}:grounded-v3:openai:fixture`;
    const payload = composeCalendarSummary(withAlternative(), context, "en", generatorVersion);
    const artifact: CallTextArtifact = { id: randomUUID(), callId: randomUUID(), kind: "call_summary",
      compilationId: context.compilationId, transcriptRevisionId: context.transcriptRevisionId,
      sourceHash: context.transcriptSourceHash, targetLanguage: "en", generatorVersion,
      sourceContext: context, contextHash: textPayloadHash(context), status: "ready", payload,
      payloadHash: textPayloadHash(payload), failureCode: null, retryable: false,
      createdAt: context.callCreatedAt, updatedAt: context.callCreatedAt };
    expect(payload.assessment!.goal.status).toBe(version === "summary-v4" ? "partial" : "achieved");
    expect(() => assertSummaryArtifactOutput(artifact, payload)).not.toThrow();
    expect(composeCalendarSummary(payload, context, "en", generatorVersion)).toEqual(payload);
    const tampered = structuredClone(payload); tampered.calendar!.startsAt = "2026-10-03T10:00:00.000Z";
    expect(() => assertSummaryArtifactOutput(artifact, tampered)).toThrow("SUMMARY_CONTEXT_INVALID");
    if (version === "summary-v4") {
      expect(() => assertSummaryArtifactOutput(artifact, composeCalendarSummary(withAlternative(), context, "en")))
        .toThrow("SUMMARY_CONTEXT_INVALID");
    }
  });
  it("leaves an ordinary information summary unchanged", () => {
    const source = summary(); source.appointmentExtraction = { candidates: [], conditions: [] };
    expect(composeCalendarSummary(source, { ...calendarContext, appointmentAuthorization: null }, "en")).toEqual(source);
  });
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
