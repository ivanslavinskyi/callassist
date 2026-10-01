import { z } from "zod";

export const betaCreditPolicySchema = z.strictObject({
  amount: z.number().int().min(0).max(100),
  period: z.enum(["lifetime", "day", "week", "month"])
});
export type BetaCreditPolicy = z.infer<typeof betaCreditPolicySchema>;
export const betaCreditPolicyUpdateSchema = z.strictObject({
  policy: betaCreditPolicySchema, expectedRevision: z.number().int().positive(), reason: z.string().trim().min(3).max(500)
});
export const defaultBetaCreditPolicy: BetaCreditPolicy = { amount: 3, period: "lifetime" };
export const publicBetaAccessSchema = z.strictObject({
  state: z.enum(["open", "full"]),
  remaining: z.number().int().nonnegative().nullable(),
  allowance: betaCreditPolicySchema,
  timeZone: z.literal("UTC")
});
export type PublicBetaAccess = z.infer<typeof publicBetaAccessSchema>;
export const betaCreditTransitionPreviewSchema = z.object({
  policyId: z.uuid(), revision: z.number().int().positive(), policy: betaCreditPolicySchema,
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
  accounts: z.number().int().nonnegative(), immediate: z.number().int().nonnegative(),
  atNextBoundary: z.number().int().nonnegative(),
  persistentCredits: z.number().int().nonnegative(), activeReservations: z.number().int().nonnegative()
});
export type BetaCreditTransitionPreview = z.infer<typeof betaCreditTransitionPreviewSchema>;
export const betaCreditTransitionInputSchema = z.strictObject({
  expectedRevision: z.number().int().positive(), policyId: z.uuid(),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(3).max(500)
});
export type BetaCreditTransitionInput = z.infer<typeof betaCreditTransitionInputSchema>;
export const creditFundingSchema = z.object({
  persistent: z.number().int().nonnegative(),
  allowance: z.object({
    policyId: z.uuid(), period: betaCreditPolicySchema.shape.period, limit: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), used: z.number().int().nonnegative(),
    startsAt: z.iso.datetime().nullable(), endsAt: z.iso.datetime().nullable(),
    lifetimeGrantAllowed: z.boolean().optional(),
    pending: z.object({ policy: betaCreditPolicySchema, effectiveAt: z.iso.datetime() }).nullable()
  }).nullable()
});
export type CreditFunding = z.infer<typeof creditFundingSchema>;
