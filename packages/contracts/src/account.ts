import { z } from "zod";
import { callSnapshotSchema, personNamePartSchema } from "./call-brief";
import { callOutcomeViewSchema } from "./call-outcome";
import { contentLocaleSchema } from "./content";

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

export const administrableUserStatusSchema = z.enum(["active", "suspended"]);
export type AdministrableUserStatus = z.infer<
  typeof administrableUserStatusSchema
>;

const adminActionReasonSchema = z.string().trim().min(3).max(500);

export const accountStatusActionSchema = z.object({
  status: administrableUserStatusSchema,
  reason: adminActionReasonSchema
});
export type AccountStatusAction = z.infer<typeof accountStatusActionSchema>;

export const sessionRevocationActionSchema = z.object({
  reason: adminActionReasonSchema
});
export type SessionRevocationAction = z.infer<
  typeof sessionRevocationActionSchema
>;

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

export const accountSessionBrowserSchema = z.enum([
  "edge",
  "chrome",
  "firefox",
  "safari",
  "other"
]);
export type AccountSessionBrowser = z.infer<
  typeof accountSessionBrowserSchema
>;

export const accountSessionPlatformSchema = z.enum([
  "windows",
  "macos",
  "ios",
  "android",
  "linux",
  "other"
]);
export type AccountSessionPlatform = z.infer<
  typeof accountSessionPlatformSchema
>;

export const accountSessionSummarySchema = z.object({
  id: z.uuid(),
  browser: accountSessionBrowserSchema,
  platform: accountSessionPlatformSchema,
  current: z.boolean(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime()
});
export type AccountSessionSummary = z.infer<
  typeof accountSessionSummarySchema
>;

export const accountSessionListSchema = z.object({
  sessions: z.array(accountSessionSummarySchema).max(50),
  totalActive: z.number().int().nonnegative(),
  truncated: z.boolean()
});
export type AccountSessionList = z.infer<typeof accountSessionListSchema>;

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

export const ACCOUNT_DATA_EXPORT_SCHEMA_VERSION = "1" as const;

export const onboardingAcceptanceRecordSchema = z.strictObject({
  id: z.uuid(),
  termsRevisionId: z.uuid(),
  acceptableUseRevisionId: z.uuid(),
  acceptedLocale: contentLocaleSchema,
  acceptedTerms: z.boolean(),
  acceptedAcceptableUse: z.boolean(),
  acknowledgedConsent: z.boolean(),
  acknowledgedRetention: z.boolean(),
  acknowledgedUseLimits: z.boolean(),
  acknowledgedCredits: z.boolean(),
  acceptedAt: z.iso.datetime()
});
export type OnboardingAcceptanceRecord = z.infer<
  typeof onboardingAcceptanceRecordSchema
>;

export const accountDataExportCallSchema = z.strictObject({
  snapshot: callSnapshotSchema,
  outcome: callOutcomeViewSchema
});
export type AccountDataExportCall = z.infer<
  typeof accountDataExportCallSchema
>;

export const accountDataExportSchema = z.strictObject({
  schemaVersion: z.literal(ACCOUNT_DATA_EXPORT_SCHEMA_VERSION),
  exportId: z.uuid(),
  generatedAt: z.iso.datetime(),
  account: userSchema,
  activeSessions: accountSessionListSchema,
  credits: creditUsageSchema,
  onboardingAcceptances: z.array(onboardingAcceptanceRecordSchema),
  calls: z.array(accountDataExportCallSchema)
});
export type AccountDataExport = z.infer<typeof accountDataExportSchema>;

export const CALL_DATA_DELETION_CONFIRMATION = "DELETE" as const;

export const callDataDeletionInputSchema = z.strictObject({
  requestId: z.uuid(),
  password: z.string().min(1).max(128),
  confirmation: z.literal(CALL_DATA_DELETION_CONFIRMATION)
});
export type CallDataDeletionInput = z.infer<
  typeof callDataDeletionInputSchema
>;

export const callDataDeletionResultSchema = z.strictObject({
  requestId: z.uuid(),
  deletedAt: z.iso.datetime()
});
export type CallDataDeletionResult = z.infer<
  typeof callDataDeletionResultSchema
>;
