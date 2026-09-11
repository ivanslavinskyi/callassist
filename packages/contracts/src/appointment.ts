import { z } from "zod";

export const appointmentDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date");
export const appointmentTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const appointmentTimeZoneSchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "Use a valid IANA time zone");
export const appointmentWindowSchema = z.strictObject({
  date: appointmentDateSchema, startTime: appointmentTimeSchema, endTime: appointmentTimeSchema
}).refine((window) => window.startTime <= window.endTime, "The end of a start-time window must not precede its start");

/** Windows constrain the appointment START, inclusively; equal bounds specify one exact slot. */
export const appointmentAuthorizationSchema = z.strictObject({
  operation: z.enum(["book", "confirm_existing"]),
  serviceDescription: z.string().trim().min(2).max(400),
  providerScope: z.literal("called_recipient"),
  timeZone: appointmentTimeZoneSchema,
  windows: z.array(appointmentWindowSchema).min(1).max(31),
  selection: z.literal("first_matching"),
  maxAppointments: z.literal(1),
  financialPolicy: z.literal("no_new_financial_terms")
}).superRefine((authorization, context) => {
  if (authorization.operation === "confirm_existing" && (authorization.windows.length !== 1 ||
    authorization.windows[0]!.startTime !== authorization.windows[0]!.endTime)) {
    context.addIssue({ code: "custom", path: ["windows"], message: "Confirming an existing appointment requires exactly one known date and exact start time" });
  }
});
export type AppointmentAuthorization = z.infer<typeof appointmentAuthorizationSchema>;

/** Historical plans have no booking authority. Never infer it from taskType or prose. */
export function getAppointmentAuthorization(plan: object): AppointmentAuthorization | null {
  if ("schemaVersion" in plan && plan.schemaVersion !== "4") return null;
  if (!("appointmentAuthorization" in plan)) return null;
  const parsed = appointmentAuthorizationSchema.safeParse(plan.appointmentAuthorization);
  return parsed.success ? parsed.data : null;
}
