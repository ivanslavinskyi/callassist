import { z } from "zod";

const legacyTerminalDecisionSchema = z.strictObject({
  callBriefId: z.uuid(), callAttemptId: z.uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive(), reason: z.enum(["objective_resolved", "recipient_requested_end", "cannot_proceed", "voicemail"]),
  summary: z.string().min(2).max(600), evidence: z.array(z.string().min(1).max(160)).max(8),
  observations: z.array(z.strictObject({ id: z.string().min(1).max(160), text: z.string().max(8000) })).max(8),
  actionState: z.enum(["sending", "delivered", "uncertain", "confirmed"]).nullable(), locale: z.string().max(20)
});
export const terminalDecisionSchema = z.union([legacyTerminalDecisionSchema,
  legacyTerminalDecisionSchema.extend({ version: z.literal(2), summary: z.string().max(600).optional(),
    noActionRequired:z.strictObject({conditionSourceQuote:z.string().min(8).max(2000),recipientQuote:z.string().min(1).max(2000)}).optional() }),
  legacyTerminalDecisionSchema.extend({version:z.literal(3),summary:z.string().max(600).optional(),
    noActionRequired:z.strictObject({conditionPlanPath:z.string().regex(/^(localizedObjective|successCriteria\.\d+|conditionalFollowUps\.\d+\.condition)$/),
      conditionPlanQuote:z.string().min(2).max(2000),recipientQuote:z.string().min(1).max(2000)}).optional()})]);
export type TerminalDecision = z.infer<typeof terminalDecisionSchema>;
