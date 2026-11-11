import { z } from "zod";
import { appointmentAuthorizationSchema, appointmentDateSchema, appointmentTimeSchema, appointmentTimeZoneSchema } from "./appointment";

import { nativeAppointmentAuthorizationSchema, nativeAppointmentExecutionAuthorizationSchema, nativeAppointmentActionSchema } from "./native-appointment";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ids = z.array(z.string().min(1).max(160)).max(30);
const legacySummarySourceContextSchema = z.strictObject({
  version: z.literal(1), callAttemptId: z.uuid(), compilationId: z.uuid(), compilationSnapshotHash: hash,
  transcriptRevisionId: z.uuid(), transcriptSourceHash: hash,
  callCreatedAt: z.iso.datetime(), callConnectedAt: z.iso.datetime().nullable(), callEndedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(), appointmentAuthorization: appointmentAuthorizationSchema.nullable(),
  actionEvidence: z.strictObject({ id: z.uuid(), version: z.number().int().positive(),
    state: z.enum(["sending", "delivered", "uncertain", "confirmed"]),
    date: appointmentDateSchema, startTime: appointmentTimeSchema, timeZone: appointmentTimeZoneSchema }).nullable()
});
export const summarySourceContextSchema=z.union([legacySummarySourceContextSchema,legacySummarySourceContextSchema.extend({version:z.literal(2),nativeAppointmentAuthorization:nativeAppointmentAuthorizationSchema.nullable(),nativeAppointmentAction:nativeAppointmentActionSchema.nullable()}), legacySummarySourceContextSchema.extend({version:z.literal(3),nativeAppointmentAuthorization:nativeAppointmentExecutionAuthorizationSchema.nullable(),nativeAppointmentAction:nativeAppointmentActionSchema.nullable()})]);
export type SummarySourceContext = z.infer<typeof summarySourceContextSchema>;

/** Provider extraction contains observations and citations, never a trusted calendar verdict. */
export const appointmentExtractionSchema = z.strictObject({
  candidates: z.array(z.strictObject({
    id: z.string().min(1).max(80), date: appointmentDateSchema.nullable(), startTime: appointmentTimeSchema.nullable(),
    timeZone: appointmentTimeZoneSchema.nullable(), zoneSource: z.enum(["approved_plan", "conversation", "unknown"]),
    status: z.enum(["offered", "reported_confirmed", "conditional", "corrected", "ambiguous"]),
    supersedes: z.array(z.string().min(1).max(80)).max(10), sourceSegmentIds: ids.min(1)
  })).max(10),
  conditions: z.array(z.strictObject({ checkId: z.string().min(1).max(160),
    kind: z.enum(["calendar_only", "combined"]), candidateId: z.string().min(1).max(80).nullable() })).max(30),
  // Present only in native-summary-v1. Older extractions remain readable.
  nativeOutcome: z.strictObject({
    operation: z.enum(["book", "confirm_existing", "reschedule", "cancel"]),
    disposition: z.enum(["confirmed", "unconfirmed", "not_required"]),
    candidateId: z.string().min(1).max(80).nullable(),
    previousAppointmentReleased: z.boolean().nullable(),
    sourceSegmentIds: ids
  }).optional()
});
export type AppointmentExtraction = z.infer<typeof appointmentExtractionSchema>;

export const summaryCalendarSchema = z.strictObject({
  version: z.literal("appointment-calendar-v1"), contextHash: hash, candidateId: z.string().max(80).nullable(),
  eligibility: z.enum(["within", "outside", "unknown", "not_applicable"]),
  reason: z.enum(["exact_window", "outside_window", "missing_date", "missing_time", "zone_conflict", "invalid_date", "invalid_time",
    "nonexistent_local_time", "ambiguous_local_time", "missing_authority", "invalid_authority", "conflicting_candidates"]),
  windowIndex: z.number().int().min(0).max(30).nullable(), startsAt: z.iso.datetime().nullable(), pastAtReference: z.boolean().nullable(),
  sourceSegmentIds: ids, label: z.string().min(1).max(160), text: z.string().min(1).max(2000),
  sourceLabel: z.string().min(1).max(160), sourceText: z.string().max(2000),
  actionState: z.enum(["sending", "delivered", "uncertain", "confirmed", "unconfirmed"]), actionText: z.string().max(1000)
});
export type SummaryCalendar = z.infer<typeof summaryCalendarSchema>;

export function supportsSummaryAssessment(version: string): boolean {
  return version.startsWith("summary-v3:") || /^summary-v[45678]:grounded-v3:/.test(version);
}
