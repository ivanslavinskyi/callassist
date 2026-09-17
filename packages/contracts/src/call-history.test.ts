import { describe, expect, it } from "vitest";
import { callPresentation, callStage, callStatusesForStage, callFeedbackScope, summarizeCallFeedback } from "./call-history";
import { deriveCallLifecycle } from "./call-lifecycle";
import type { CallAssessmentSummary } from "./call-assessment";

const assessment: CallAssessmentSummary = { status: "ready", conversation: "confirmed", goal: "achieved", reason: null,
  updatedAt: "2026-09-17T12:00:00.000Z", deadlineAt: null, transcriptRevisionId: null, evaluatorVersion: "test" };
const lifecycle = { ...deriveCallLifecycle("completed", []), consent: "granted" as const, result: "conversation_completed" as const, assessment };
const feedback = { goalResult: "no" as const, revision: 1, createdAt: "2026-09-17T12:01:00.000Z", scope: "current_attempt" as const };

describe("call presentation", () => {
  it("groups all terminal states without changing their outcomes", () => {
    expect(callStatusesForStage("ended")).toEqual(["completed", "stopped", "failed"]);
    expect(callStage("blocked")).toBe("blocked");
    expect(callPresentation({ status: "failed", lifecycle: { ...lifecycle, result: "no_answer", assessment: undefined } }))
      .toMatchObject({ stage: "ended", result: "no_answer", aiState: "not_applicable", aiGoal: null });
  });
  it.each(["pending", "unavailable"] as const)("keeps %s analysis separate from a finished call", status => {
    expect(callPresentation({ status: "completed", lifecycle: { ...lifecycle, result: status === "pending" ? "assessment_pending" : "assessment_unavailable", assessment: { ...assessment, status, goal: null } } }))
      .toMatchObject({ stage: "ended", result: "unknown", aiState: status, aiGoal: null, comparison: "not_comparable" });
  });
  it("does not confuse an uncertain conclusion with failed processing", () => {
    expect(callPresentation({ status: "completed", lifecycle: { ...lifecycle, result: "assessment_unavailable", assessment: { ...assessment, conversation: "uncertain", goal: "uncertain" } } }, feedback))
      .toMatchObject({ aiState: "ready", aiGoal: "uncertain", comparison: "not_comparable" });
  });
  it("compares only explicit, comparable assessments from the same attempt", () => {
    const brief = { status: "completed" as const, lifecycle };
    expect(callPresentation(brief, feedback).comparison).toBe("mismatch");
    expect(callPresentation(brief, { ...feedback, goalResult: "yes" }).comparison).toBe("match");
    expect(callPresentation(brief, { ...feedback, scope: "call" }).comparison).toBe("not_comparable");
    expect(callPresentation(brief, null)).toMatchObject({ userGoal: null, comparison: "not_comparable" });
    expect(callPresentation({ ...brief, status: "in_progress" }, feedback)).toMatchObject({ result: null, comparison: "not_comparable" });
  });
  it("does not infer failure or inapplicability from missing historical evidence", () => {
    expect(callPresentation({ status: "completed" })).toMatchObject({ result: "unknown", aiState: "not_assessed", aiGoal: null });
    expect(callPresentation({ status: "completed", lifecycle: deriveCallLifecycle("completed", []) })).toMatchObject({ aiState: "not_assessed" });
  });
  it("does not assign call-level legacy feedback to one of multiple attempts", () => {
    const before = "2026-09-17T11:00:00.000Z";
    expect(callFeedbackScope(feedback.createdAt, [before])).toBe("current_attempt");
    expect(callFeedbackScope(feedback.createdAt, [before, before])).toBe("call");
    expect(callFeedbackScope(before, [feedback.createdAt])).toBe("call");
    expect(callFeedbackScope(feedback.createdAt, [])).toBe("call");
    expect(summarizeCallFeedback(null, [before])).toBeNull();
  });
});
