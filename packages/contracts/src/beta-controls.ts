import { analyticsSettingsSchema, defaultAnalyticsSettings } from "./analytics";
import { z } from "zod";

const micros = z.number().int().min(1).max(1_000_000_000);
export const betaSettingsSchema = z.strictObject({
  analytics: analyticsSettingsSchema.default(defaultAnalyticsSettings).catch(defaultAnalyticsSettings),
  publicAccountLimit: z.number().int().min(0).max(10000),
  maxDurationSeconds: z.number().int().min(60).max(900),
  maxConcurrentCalls: z.number().int().min(1).max(20),
  maxStartsPerHour: z.number().int().min(1).max(100),
  maxStartsPerDay: z.number().int().min(1).max(500),
  maxStartsPerRecipientPerDay: z.number().int().min(1).max(10),
  spendingEnabled: z.boolean(),
  currency: z.literal("USD"),
  rollingDayBudgetMicros: micros.nullable(),
  callMinuteReserveMicros: micros,
  textRequestReserveMicros: micros,
  transcriptionRequestReserveMicros: micros,
  smsReserveMicros: micros,
  emailReserveMicros: micros
});
export type BetaSettings = z.infer<typeof betaSettingsSchema>;
export const defaultBetaSettings: BetaSettings = {
  analytics: defaultAnalyticsSettings,
  publicAccountLimit: 30, maxDurationSeconds: 420, maxConcurrentCalls: 2,
  maxStartsPerHour: 3, maxStartsPerDay: 10, maxStartsPerRecipientPerDay: 2,
  spendingEnabled: true, currency: "USD", rollingDayBudgetMicros: null,
  callMinuteReserveMicros: 2_000_000, textRequestReserveMicros: 500_000,
  transcriptionRequestReserveMicros: 1_000_000, smsReserveMicros: 500_000, emailReserveMicros: 10_000
};
export const betaSettingsUpdateSchema = z.strictObject({
  settings: betaSettingsSchema, expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500)
});
export const betaInvitationCreateSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export const betaControlsViewSchema = z.strictObject({
  settings: betaSettingsSchema, revision: z.number().int().positive(),
  publicAccounts: z.number().int().nonnegative(), invitedAccounts: z.number().int().nonnegative(),
  activeCalls: z.number().int().nonnegative(), reservedMicros: z.number().int().nonnegative(),
  reportedCostMicros: z.number().int().nonnegative(),
  usageCostMicros: z.number().int().nonnegative(),
  pendingReserveMicros: z.number().int().nonnegative(),
  unresolvedReservations: z.number().int().nonnegative(),
  accountingVersion: z.string().min(1),
  budgetState: z.enum(["unconfigured", "paused", "available", "warning", "exhausted"]),
  invitations: z.array(z.strictObject({
    id: z.string().uuid(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
    status: z.enum(["available", "used", "revoked", "expired"])
  })),
  updatedAt: z.string().datetime(), reason: z.string()
});
export type BetaControlsView = z.infer<typeof betaControlsViewSchema>;
