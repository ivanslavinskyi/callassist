import { z } from "zod";
import { callBriefSchema, callBriefStatusSchema, type CallBrief, type CallBriefStatus } from "./call-brief";
import { callGoalResultSchema, type CallFeedbackRevision } from "./call-outcome";
import type { GoalAssessmentStatus } from "./call-assessment";

export const callStageSchema = z.enum([
  "review_required", "needs_clarification", "blocked", "ready", "dialing", "in_progress", "awaiting_approval", "ended"
]);
export type CallStage = z.infer<typeof callStageSchema>;
export const callHistoryStageSchema = callStageSchema.exclude(["awaiting_approval"]);
export type CallHistoryStage = z.infer<typeof callHistoryStageSchema>;

export function callStage(status: CallBriefStatus): CallStage {
  return status === "completed" || status === "stopped" || status === "failed" ? "ended" : status;
}
export function callStatusesForStage(stage: CallStage): CallBriefStatus[] {
  return callBriefStatusSchema.options.filter(status => callStage(status) === stage);
}
export function emptyCallStageCounts(): Record<CallStage, number> {
  return { review_required: 0, needs_clarification: 0, blocked: 0, ready: 0, dialing: 0, in_progress: 0, awaiting_approval: 0, ended: 0 };
}

export const callFeedbackSummarySchema = z.strictObject({
  goalResult: callGoalResultSchema,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  scope: z.enum(["current_attempt", "call"])
});
export type CallFeedbackSummary = z.infer<typeof callFeedbackSummarySchema>;
/** Legacy feedback has no attempt ID. Only a single, preceding attempt is unambiguous. */
export function callFeedbackScope(feedbackAt: string, attemptStarts: readonly string[]): CallFeedbackSummary["scope"] {
  return attemptStarts.length === 1 && feedbackAt >= attemptStarts[0]! ? "current_attempt" : "call";
}
export function summarizeCallFeedback(
  feedback: Pick<CallFeedbackRevision, "goalResult" | "revision" | "createdAt"> | null,
  attemptStarts: readonly string[]
): CallFeedbackSummary | null {
  return feedback ? { goalResult: feedback.goalResult, revision: feedback.revision, createdAt: feedback.createdAt,
    scope: callFeedbackScope(feedback.createdAt, attemptStarts) } : null;
}

export const callHistoryItemSchema = callBriefSchema.and(z.object({ feedback: callFeedbackSummarySchema.nullable() }));
export type CallHistoryItem = z.infer<typeof callHistoryItemSchema>;
export const callHistoryListSchema = z.strictObject({
  items: z.array(callHistoryItemSchema), nextCursor: z.string().nullable(),
  stageCounts: z.record(callStageSchema, z.number().int().nonnegative()),
  legacyStatusCount: z.number().int().nonnegative().nullable()
});
export type CallHistoryList = z.infer<typeof callHistoryListSchema>;

const userGoals = { yes: "achieved", partly: "partial", no: "not_achieved" } as const;
export type CallAiAssessmentState = "pending" | "ready" | "unavailable" | "not_assessed" | "not_applicable";
export function callPresentation(brief: Pick<CallBrief, "status" | "lifecycle">, feedback?: CallFeedbackSummary | null) {
  const stage = callStage(brief.status);
  const lifecycle = brief.lifecycle;
  const assessment = lifecycle?.assessment;
  const result = stage !== "ended" ? null : !lifecycle?.result ||
    ["ended", "assessment_pending", "assessment_unavailable"].includes(lifecycle.result) ? "unknown" : lifecycle.result;
  const aiState: CallAiAssessmentState = assessment?.status ??
    (stage === "ended" && lifecycle && (lifecycle.result === "no_answer" || lifecycle.result === "busy" ||
      lifecycle.result === "canceled" || lifecycle.consent === "declined" || lifecycle.consent === "not_received")
      ? "not_applicable" : "not_assessed");
  const aiGoal: GoalAssessmentStatus | null = aiState === "ready" ? assessment?.goal ?? "uncertain" : null;
  const userGoal = feedback ? userGoals[feedback.goalResult] : null;
  const comparison = stage === "ended" && feedback?.scope === "current_attempt" && aiGoal && aiGoal !== "uncertain" && userGoal
    ? aiGoal === userGoal ? "match" : "mismatch" : "not_comparable";
  return { stage, result, aiState, aiGoal, userGoal, comparison } as const;
}
