import { callAssessmentDecisionSchema, type CallAssessmentDecision, type SourceSegment } from "@callassist/contracts";

export const assessmentVersion = "final-assessment-v1";
export const assessmentDeadlineMs = 5 * 60_000;
export const uncertainAssessment = (): CallAssessmentDecision => ({
  conversation: { status: "uncertain", category: "uncertain", questionSegmentId: null, answerSegmentId: null, answerQuote: "" },
  goal: { status: "uncertain", sourceSegmentIds: [] }, criteria: []
});

/** Only original, speaker-attributed evidence can support an assessment. */
export function validateFinalAssessment(value: unknown, segments: SourceSegment[], criteriaIds: string[]): CallAssessmentDecision {
  const result = callAssessmentDecisionSchema.parse(value);
  const fail = () => { throw new Error("CALL_ASSESSMENT_EVIDENCE_INVALID"); };
  const byId = new Map(segments.map((s, index) => [s.id, { ...s, index }]));
  const { conversation, goal, criteria } = result;
  if (criteria.length !== criteriaIds.length || criteria.some((c,i) => c.id !== criteriaIds[i])) fail();
  for (const part of [goal, ...criteria]) {
    if (new Set(part.sourceSegmentIds).size !== part.sourceSegmentIds.length || part.sourceSegmentIds.some(id => !byId.has(id))) fail();
    if (part.status !== "uncertain" && !part.sourceSegmentIds.some(id => byId.get(id)?.role === "recipient")) fail();
  }
  if (conversation.status === "confirmed") {
    const question = byId.get(conversation.questionSegmentId ?? "");
    const answer = byId.get(conversation.answerSegmentId ?? "");
    if (!question || !answer || question.role !== "assistant" || answer.role !== "recipient" || question.index >= answer.index ||
      !conversation.answerQuote.trim() || !answer.text.includes(conversation.answerQuote) ||
      ["none", "uncertain"].includes(conversation.category)) fail();
    if (question?.startSeconds != null && answer?.endSeconds != null && question.startSeconds > answer.endSeconds) fail();
  } else if (conversation.questionSegmentId !== null || conversation.answerSegmentId !== null || conversation.answerQuote !== "" ||
    conversation.category !== (conversation.status === "absent" ? "none" : "uncertain")) fail();
  if (goal.status === "achieved" && (conversation.status !== "confirmed" || criteria.some(c => c.status !== "achieved"))) fail();
  if (goal.status === "partial" && conversation.status !== "confirmed") fail();
  return result;
}
