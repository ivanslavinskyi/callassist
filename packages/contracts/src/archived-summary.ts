import { z } from "zod";
import { callAssessmentDecisionSchema, goalAssessmentStatusSchema } from "./call-assessment";
import { appointmentExtractionSchema, summaryCalendarSchema } from "./summary-source";
import { appointmentPriceSchema } from "./archived-appointment";

// Historical summary v4 payloads. Keep their evidence intact without changing
// the current assessment writer or granting archived appointment permissions.
const ids = z.array(z.string().min(1).max(160)).max(30);
export const archivedSummaryAssessmentSchema = callAssessmentDecisionSchema.extend({
  schemaVersion: z.literal(2),
  goal: z.strictObject({ status: goalAssessmentStatusSchema, sourceSegmentIds: ids, actionClaim: z.enum(["confirmed","not_claimed"]) }),
  criteria: z.array(z.strictObject({ id: z.string().min(1).max(160),
    status: z.enum([...goalAssessmentStatusSchema.options,"not_applicable"]), sourceSegmentIds: ids,
    evidence: z.strictObject({ kind: z.enum(["recipient_statement","assistant_delivery","condition_not_triggered","insufficient"]), reason: z.string().trim().min(1).max(1200) }),
    actionClaim: z.enum(["confirmed","not_claimed"])
  })).max(30)
});
export const archivedSummaryExtractionSchema = appointmentExtractionSchema.extend({
  candidates: z.array(appointmentExtractionSchema.shape.candidates.element.extend({
    durationMinutes: z.number().int().positive().max(44_640).nullable().optional(), totalPrice: appointmentPriceSchema.nullable().optional()
  })).max(10)
});
export const archivedSummaryCalendarSchema = summaryCalendarSchema.extend({
  actionState: z.enum([...summaryCalendarSchema.shape.actionState.options,"not_requested"])
});
