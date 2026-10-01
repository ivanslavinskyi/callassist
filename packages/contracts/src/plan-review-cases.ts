import { z } from "zod";
import { callCompilationSchema, policyReasonCodeSchema } from "./call-brief";

export const planReviewCategorySchema = z.enum(["policy_signal", "clarification", "unsupported_task", "technical_failure"]);
export const planReviewStatusSchema = z.enum(["new", "in_review", "resolved"]);
export const planReviewResolutionSchema = z.enum(["benign", "policy_violation", "false_positive", "technical_issue"]);
export const planReviewFiltersSchema = z.strictObject({
  status: planReviewStatusSchema.optional(), category: planReviewCategorySchema.optional(),
  decision: z.enum(["blocked", "needs_clarification"]).optional(), reason: policyReasonCodeSchema.optional(),
  userId: z.uuid().optional(), callId: z.uuid().optional(),
  from: z.iso.datetime().optional(), to: z.iso.datetime().optional(),
  cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(25)
}).refine(value => !value.from || !value.to || value.from <= value.to, "Invalid time range");
export type PlanReviewFilters = z.infer<typeof planReviewFiltersSchema>;

export const planReviewCaseSchema = z.strictObject({
  id: z.uuid(), compilationId: z.uuid(), callId: z.uuid(), preparationId: z.uuid().nullable(), userId: z.uuid().nullable(),
  planRevision: z.number().int().positive(), snapshotHash: z.string(), previousCaseId: z.uuid().nullable(),
  decision: z.enum(["blocked", "needs_clarification"]), category: planReviewCategorySchema,
  reasons: z.array(policyReasonCodeSchema), riskLevel: z.enum(["low", "high"]), callLocale: z.string(),
  compilerVersion: z.string(), policyVersion: z.string(), model: z.string(),
  status: planReviewStatusSchema, resolution: planReviewResolutionSchema.nullable(),
  assigneeId: z.uuid().nullable(), revision: z.number().int().positive(), historical: z.boolean(),
  occurredAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  repeats: z.number().int().nonnegative(), emailFailed: z.number().int().nonnegative(),
  emailPending: z.number().int().nonnegative(), emailAccepted: z.number().int().nonnegative()
});
export type PlanReviewCase = z.infer<typeof planReviewCaseSchema>;
export const planReviewSummarySchema = z.strictObject({
  new: z.number().int().nonnegative(), inReview: z.number().int().nonnegative(),
  policySignals: z.number().int().nonnegative(), emailFailed: z.number().int().nonnegative(),
  emailPending: z.number().int().nonnegative(), oldestPendingAt: z.iso.datetime().nullable()
});
export const planReviewListSchema = z.strictObject({
  available: z.boolean(), items: z.array(planReviewCaseSchema), nextCursor: z.string().nullable(), summary: planReviewSummarySchema
});
export type PlanReviewList = z.infer<typeof planReviewListSchema>;
export const planReviewDetailSchema = z.strictObject({
  item: planReviewCaseSchema,
  history: z.array(planReviewCaseSchema),
  audit: z.array(z.strictObject({ id: z.uuid(), actorId: z.uuid().nullable(), action: z.string(), createdAt: z.iso.datetime() })),
  deliveries: z.array(z.strictObject({ id: z.uuid(), status: z.string(), attempts: z.number().int(),
    updatedAt: z.iso.datetime(), errorCode: z.string().nullable() }))
});
export type PlanReviewDetail = z.infer<typeof planReviewDetailSchema>;
export const planReviewEvidenceSchema = z.strictObject({
  compilation: callCompilationSchema, note: z.string().nullable(),
  audit: z.array(z.strictObject({ id: z.uuid(), reason: z.string().nullable() }))
});
export type PlanReviewEvidence = z.infer<typeof planReviewEvidenceSchema>;
export const planReviewUpdateSchema = z.strictObject({
  expectedRevision: z.number().int().positive(), status: planReviewStatusSchema,
  resolution: planReviewResolutionSchema.nullable(), assigneeId: z.uuid().nullable(),
  note: z.string().trim().max(3000), reason: z.string().trim().min(3).max(500)
}).refine(value => (value.status === "resolved") === (value.resolution !== null), "Resolved cases require a resolution");
export type PlanReviewUpdate = z.infer<typeof planReviewUpdateSchema>;
