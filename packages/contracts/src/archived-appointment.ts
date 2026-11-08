import { z } from "zod";
import { appointmentAuthorizationSchema, appointmentTimeSchema, appointmentDateSchema, appointmentTimeZoneSchema } from "./appointment";

// Historical readers only. These schemas never grant new action authority.
/** Amounts are in the stated currency's major units; no implicit currency conversion. */
export const appointmentPriceSchema = z.strictObject({
  amount: z.number().finite().nonnegative().max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/)
});
export const appointmentLimitsSchema = z.strictObject({
  finishBy: z.strictObject({ time: appointmentTimeSchema, dayOffset: z.number().int().min(0).max(31), inclusive: z.boolean() }).nullable(),
  maxTotalPrice: appointmentPriceSchema.nullable()
});
export const archivedAppointmentV2Schema = appointmentAuthorizationSchema.safeExtend({
  version: z.literal(2), limits: appointmentLimitsSchema
});

/** A calendar predicate, not an expansion truncated to a product horizon. Null endDate explicitly means no upper date. */
export const appointmentDateRuleSchema = z.strictObject({
  startDate: appointmentDateSchema, endDate: appointmentDateSchema.nullable(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  excludedWeekdays: z.array(z.number().int().min(1).max(7)).max(7),
  excludedDates: z.array(appointmentDateSchema).max(366),
  startTime: appointmentTimeSchema, endTime: appointmentTimeSchema
}).refine(rule => (rule.endDate === null || rule.startDate <= rule.endDate) && rule.startTime <= rule.endTime,
  "Calendar bounds must be ordered")
  .refine(rule => (rule.weekdays.length ? rule.weekdays : [1, 2, 3, 4, 5, 6, 7]).some(day => !rule.excludedWeekdays.includes(day)),
    "At least one weekday must remain available");
export const appointmentAlternativeSchema = z.strictObject({
  selection: z.enum(["first_matching", "earliest_day", "earliest_available"]),
  rules: z.array(appointmentDateRuleSchema).min(1).max(31)
});
export const archivedAppointmentV3Schema = z.strictObject({
  version: z.literal(3), operation: z.enum(["book", "confirm_existing"]),
  serviceDescription: z.string().trim().min(2).max(400), providerScope: z.literal("called_recipient"),
  timeZone: appointmentTimeZoneSchema,
  // Ordered alternatives. A later alternative requires observed unavailability of EVERY earlier one.
  alternatives: z.array(appointmentAlternativeSchema).min(1).max(8),
  maxAppointments: z.literal(1), financialPolicy: z.literal("no_new_financial_terms"), limits: appointmentLimitsSchema
}).superRefine((authorization, context) => {
  if (authorization.operation !== "confirm_existing") return;
  const rule = authorization.alternatives[0]?.rules[0];
  if (authorization.alternatives.length !== 1 || authorization.alternatives[0]!.rules.length !== 1 || !rule ||
    rule.startDate !== rule.endDate || rule.startTime !== rule.endTime || !appointmentRuleContains(rule, rule.startDate, rule.startTime))
    context.addIssue({ code: "custom", path: ["alternatives"], message: "Confirming an existing appointment requires one permitted exact date and time" });
});

type AppointmentDateRule = z.infer<typeof appointmentDateRuleSchema>;
export function appointmentRuleContains(rule: AppointmentDateRule, date: string, time?: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return date >= rule.startDate && (rule.endDate === null || date <= rule.endDate) &&
    (!rule.weekdays.length || rule.weekdays.includes(day)) && !rule.excludedWeekdays.includes(day) &&
    !rule.excludedDates.includes(date) && (time === undefined || (time >= rule.startTime && time <= rule.endTime));
}
