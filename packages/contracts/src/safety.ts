import { z } from "zod";
import { swissDestinationPhoneSchema } from "./phone";

const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,10}$/, "Enter the SMS verification code");

const safetyReasonSchema = z.string().trim().min(3).max(500);

export const recipientOptOutRequestSchema = z.object({
  phoneE164: swissDestinationPhoneSchema
});
export type RecipientOptOutRequest = z.infer<
  typeof recipientOptOutRequestSchema
>;

export const recipientOptOutConfirmationSchema = z.object({
  phoneE164: swissDestinationPhoneSchema,
  code: verificationCodeSchema
});
export type RecipientOptOutConfirmation = z.infer<
  typeof recipientOptOutConfirmationSchema
>;

export const staffRecipientSuppressionSchema = z.object({
  phoneE164: swissDestinationPhoneSchema,
  source: z.enum(["staff", "complaint"]),
  reason: safetyReasonSchema
});
export type StaffRecipientSuppression = z.infer<
  typeof staffRecipientSuppressionSchema
>;

export const staffRecipientSuppressionLiftSchema = z.object({
  phoneE164: swissDestinationPhoneSchema,
  reason: safetyReasonSchema
});
export type StaffRecipientSuppressionLift = z.infer<
  typeof staffRecipientSuppressionLiftSchema
>;
