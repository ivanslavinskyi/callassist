import { z } from "zod";
import {
  callBriefStatusSchema,
  callLocaleSchema,
  finalTranscriptSchema,
  transcriptSegmentSchema
} from "./call-brief";
import {
  callFailureStageSchema,
  callGoalResultSchema,
  callOutcomeProvenanceSchema,
  callOutcomeRevisionSchema,
  semanticCallOutcomeSchema,
  technicalCallOutcomeSchema,
  transcriptQualityRatingSchema
} from "./call-outcome";
import {
  CALL_TELEMETRY_SCHEMA_VERSION,
  callTelemetryPayloadSchema,
  callTelemetrySeveritySchema,
  callTelemetrySourceSchema,
  callTelemetryStageSchema
} from "./call-telemetry";

export const ADMIN_CALL_LIST_LIMIT_MAX = 100;

export const adminCallListFiltersSchema = z.strictObject({
  status: callBriefStatusSchema.optional(),
  outcome: semanticCallOutcomeSchema.optional(),
  consent: z.enum(["not_recorded", "granted", "failed"]).optional(),
  failureStage: callFailureStageSchema.optional(),
  locale: callLocaleSchema.optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional()
}).superRefine((filters, context) => {
  if (
    filters.dateFrom &&
    filters.dateTo &&
    filters.dateFrom > filters.dateTo
  ) {
    context.addIssue({
      code: "custom",
      path: ["dateTo"],
      message: "dateTo must not be earlier than dateFrom"
    });
  }
});
export type AdminCallListFilters = z.infer<
  typeof adminCallListFiltersSchema
>;

export const adminCallFeedbackSummarySchema = z.strictObject({
  revision: z.number().int().positive(),
  goalResult: callGoalResultSchema,
  transcriptQuality: transcriptQualityRatingSchema.nullable(),
  createdAt: z.iso.datetime()
});
export type AdminCallFeedbackSummary = z.infer<
  typeof adminCallFeedbackSummarySchema
>;

export const adminCallSummarySchema = z.strictObject({
  id: z.uuid(),
  ownerUserId: z.uuid().nullable(),
  status: callBriefStatusSchema,
  locale: callLocaleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  technical: technicalCallOutcomeSchema,
  semanticOutcome: semanticCallOutcomeSchema.nullable(),
  outcomeProvenance: callOutcomeProvenanceSchema.nullable(),
  feedback: adminCallFeedbackSummarySchema.nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  eventCount: z.number().int().nonnegative()
});
export type AdminCallSummary = z.infer<typeof adminCallSummarySchema>;

export const adminCallListSchema = z.strictObject({
  items: z.array(adminCallSummarySchema),
  nextCursor: z.string().nullable()
});
export type AdminCallList = z.infer<typeof adminCallListSchema>;

export const adminCallTimelineEventSchema = z.strictObject({
  id: z.uuid(),
  callAttemptId: z.uuid().nullable(),
  sequence: z.number().int().positive(),
  schemaVersion: z.literal(CALL_TELEMETRY_SCHEMA_VERSION),
  source: callTelemetrySourceSchema,
  stage: callTelemetryStageSchema,
  severity: callTelemetrySeveritySchema,
  occurredAt: z.iso.datetime(),
  payload: callTelemetryPayloadSchema
});
export type AdminCallTimelineEvent = z.infer<
  typeof adminCallTimelineEventSchema
>;

export const adminCallInspectorSchema = z.strictObject({
  summary: adminCallSummarySchema,
  timeline: z.array(adminCallTimelineEventSchema),
  outcomeHistory: z.array(callOutcomeRevisionSchema)
});
export type AdminCallInspector = z.infer<typeof adminCallInspectorSchema>;

export const sensitiveCallAccessInputSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500)
});
export type SensitiveCallAccessInput = z.infer<
  typeof sensitiveCallAccessInputSchema
>;

export const adminCallSensitiveContentSchema = z.strictObject({
  callBriefId: z.uuid(),
  recipientName: z.string(),
  phoneNumber: z.string(),
  representedPerson: z.string(),
  objective: z.string(),
  context: z.string(),
  allowedFacts: z.array(z.string()),
  transcript: z.array(transcriptSegmentSchema),
  finalTranscript: finalTranscriptSchema.nullable(),
  feedbackComment: z.string().nullable()
});
export type AdminCallSensitiveContent = z.infer<
  typeof adminCallSensitiveContentSchema
>;
