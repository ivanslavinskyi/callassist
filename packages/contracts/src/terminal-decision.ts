import { z } from "zod";

export const terminalDecisionSchema = z.strictObject({
  callBriefId: z.uuid(), callAttemptId: z.uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive(), reason: z.enum(["objective_resolved", "recipient_requested_end", "cannot_proceed", "voicemail"]),
  summary: z.string().min(2).max(600), evidence: z.array(z.string().min(1).max(160)).max(8),
  observations: z.array(z.strictObject({ id: z.string().min(1).max(160), text: z.string().max(8000) })).max(8),
  actionState: z.enum(["sending", "delivered", "uncertain", "confirmed"]).nullable(), locale: z.string().max(20)
});
export type TerminalDecision = z.infer<typeof terminalDecisionSchema>;
