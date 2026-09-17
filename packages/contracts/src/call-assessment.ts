import { z } from "zod";

const ids = z.array(z.string().min(1).max(160)).max(30);
export const goalAssessmentStatusSchema = z.enum(["achieved", "partial", "not_achieved", "uncertain"]);
export type GoalAssessmentStatus = z.infer<typeof goalAssessmentStatusSchema>;
export const callAssessmentDecisionSchema = z.strictObject({
  conversation: z.strictObject({
    status: z.enum(["confirmed", "absent", "uncertain"]),
    category: z.enum(["task_answer", "cannot_answer", "referral", "message_acknowledged", "none", "uncertain"]),
    questionSegmentId: z.string().max(160).nullable(),
    answerSegmentId: z.string().max(160).nullable(),
    answerQuote: z.string().max(600)
  }),
  goal: z.strictObject({ status: goalAssessmentStatusSchema, sourceSegmentIds: ids }),
  criteria: z.array(z.strictObject({ id: z.string().min(1).max(160), status: goalAssessmentStatusSchema, sourceSegmentIds: ids })).max(30)
});
export type CallAssessmentDecision = z.infer<typeof callAssessmentDecisionSchema>;
export const callAssessmentSummarySchema = z.strictObject({
  status: z.enum(["pending", "ready", "unavailable"]),
  conversation: z.enum(["confirmed", "absent", "uncertain"]).nullable(),
  goal: goalAssessmentStatusSchema.nullable(),
  reason: z.enum(["deadline", "generation_failed", "evidence_uncertain"]).nullable(),
  updatedAt: z.iso.datetime(), deadlineAt: z.iso.datetime().nullable(),
  transcriptRevisionId: z.uuid().nullable(), evaluatorVersion: z.string().max(200).nullable()
});
export type CallAssessmentSummary = z.infer<typeof callAssessmentSummarySchema>;
export const callAssessmentRecordSchema = z.strictObject({
  callAttemptId: z.uuid(), compilationId: z.uuid(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  summary: callAssessmentSummarySchema, decision: callAssessmentDecisionSchema.nullable()
});
export type CallAssessmentRecord = z.infer<typeof callAssessmentRecordSchema>;
export const goalAssessmentCountsSchema = z.strictObject({
  achieved: z.number().int().nonnegative(), partial: z.number().int().nonnegative(),
  notAchieved: z.number().int().nonnegative(), uncertain: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(), unavailable: z.number().int().nonnegative(),
  notAssessed: z.number().int().nonnegative()
});
export type GoalAssessmentCounts = z.infer<typeof goalAssessmentCountsSchema>;
export function emptyGoalAssessmentCounts(): GoalAssessmentCounts {
  return { achieved: 0, partial: 0, notAchieved: 0, uncertain: 0, pending: 0, unavailable: 0, notAssessed: 0 };
}
export function countGoalAssessment(counts: GoalAssessmentCounts, assessment?: CallAssessmentSummary | null) {
  if (!assessment) counts.notAssessed++;
  else if (assessment.status !== "ready") counts[assessment.status]++;
  else if (assessment.goal === "not_achieved") counts.notAchieved++;
  else counts[assessment.goal ?? "uncertain"]++;
}
