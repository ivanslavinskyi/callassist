import { z } from "zod";

export const conversationCreditEvidenceSchema = z.strictObject({
  version: z.literal(1), questionSegmentId: z.uuid(), answerSegmentId: z.uuid(),
  category: z.enum(["task_answer", "cannot_answer", "referral", "message_acknowledged"])
});
export type ConversationCreditEvidence = z.infer<typeof conversationCreditEvidenceSchema>;

export const conversationCreditDecisionSchema = z.strictObject({
  category: z.enum(["task_answer", "cannot_answer", "referral", "message_acknowledged", "not_substantive", "uncertain"]),
  answerQuote: z.string().max(600)
});
