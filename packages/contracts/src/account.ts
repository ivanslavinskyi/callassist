import { z } from "zod";
import { personNamePartSchema } from "./call-brief";

export const userRoleSchema = z.enum([
  "user",
  "admin",
  "superadmin",
  "content_editor",
  "support"
]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(["active", "suspended", "deleted"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const registrationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(128),
  phoneE164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Use international phone format"),
  firstName: personNamePartSchema,
  lastName: personNamePartSchema,
  uiLocale: z.enum(["en", "de"])
});
export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export const phoneVerificationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  code: z.string().trim().regex(/^\d{4,10}$/, "Enter the SMS verification code")
});
export type PhoneVerificationInput = z.infer<typeof phoneVerificationInputSchema>;

export const verificationResendInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320)
});
export type VerificationResendInput = z.infer<
  typeof verificationResendInputSchema
>;

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(128)
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  phoneE164: z.string(),
  phoneVerifiedAt: z.iso.datetime().nullable(),
  firstName: personNamePartSchema,
  lastName: personNamePartSchema,
  role: userRoleSchema,
  status: userStatusSchema,
  uiLocale: z.enum(["en", "de"]),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable()
});
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime()
});
export type Session = z.infer<typeof sessionSchema>;

export const creditTransactionTypeSchema = z.enum([
  "signup_grant",
  "promo_grant",
  "admin_grant",
  "call_reservation",
  "call_charge",
  "call_refund",
  "adjustment"
]);
export type CreditTransactionType = z.infer<
  typeof creditTransactionTypeSchema
>;

export const creditTransactionSchema = z.object({
  id: z.uuid(),
  amount: z.number().int(),
  type: creditTransactionTypeSchema,
  callAttemptId: z.uuid().nullable(),
  promoRedemptionId: z.uuid().nullable(),
  adminId: z.uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime()
});
export type CreditTransaction = z.infer<typeof creditTransactionSchema>;

export const creditUsageSchema = z.object({
  balance: z.number().int().nonnegative(),
  activeCallBriefId: z.uuid().nullable(),
  transactions: z.array(creditTransactionSchema)
});
export type CreditUsage = z.infer<typeof creditUsageSchema>;
