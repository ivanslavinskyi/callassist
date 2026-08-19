import { z } from "zod";

export const promoCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(8)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores");

const idempotencyKeySchema = z.uuid();
const grantReasonSchema = z.string().trim().min(3).max(500);
const optionalInstantSchema = z.iso.datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .nullable();

export const promoRedemptionInputSchema = z.object({
  code: promoCodeSchema,
  idempotencyKey: idempotencyKeySchema
});
export type PromoRedemptionInput = z.infer<typeof promoRedemptionInputSchema>;

export const adminCreditGrantInputSchema = z.object({
  targetEmail: z.string().trim().toLowerCase().email().max(320),
  credits: z.number().int().min(1).max(100),
  reason: grantReasonSchema,
  idempotencyKey: idempotencyKeySchema
});
export type AdminCreditGrantInput = z.infer<
  typeof adminCreditGrantInputSchema
>;

export const promoCodeCreateInputSchema = z.object({
  code: promoCodeSchema,
  credits: z.number().int().min(1).max(100),
  globalRedemptionLimit: z.number().int().min(1).max(100_000).nullable(),
  perUserLimit: z.number().int().min(1).max(10),
  startsAt: optionalInstantSchema,
  expiresAt: optionalInstantSchema,
  active: z.boolean(),
  campaign: z.string().trim().min(1).max(120),
  reason: grantReasonSchema,
  idempotencyKey: idempotencyKeySchema
}).superRefine((value, context) => {
  if (
    value.startsAt &&
    value.expiresAt &&
    Date.parse(value.expiresAt) <= Date.parse(value.startsAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "Expiry must be after the start time"
    });
  }
});
export type PromoCodeCreateInput = z.infer<
  typeof promoCodeCreateInputSchema
>;

export const promoCodeSummarySchema = z.object({
  id: z.uuid(),
  credits: z.number().int().positive(),
  globalRedemptionLimit: z.number().int().positive().nullable(),
  perUserLimit: z.number().int().positive(),
  startsAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  active: z.boolean(),
  campaign: z.string(),
  createdAt: z.iso.datetime()
});
export type PromoCodeSummary = z.infer<typeof promoCodeSummarySchema>;
