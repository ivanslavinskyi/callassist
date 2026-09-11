import { z } from "zod";
import { languageTagSchema, textLanguageSchema } from "./languages";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const textArtifactKindSchema = z.enum(["plan_review", "clarification_review", "transcript_translation", "call_summary"]);
export type TextArtifactKind = z.infer<typeof textArtifactKindSchema>;
export const textArtifactStatusSchema = z.enum(["queued", "processing", "ready", "failed", "stale", "cancelled"]);
export const planSourceSchema = z.object({
  compilationId: z.string().uuid(), revision: z.number().int().positive(), snapshotHash: hashSchema,
  reviewPolicyVersion: z.union([z.literal(1), z.literal(2)])
});
export type PlanSource = z.infer<typeof planSourceSchema>;
export const translatedFieldSchema = z.object({ id: z.string().min(1).max(200), text: z.string().min(1).max(24000) });
export const planReviewPayloadSchema = z.object({ fields: z.array(translatedFieldSchema).max(250) });
export const sourceSegmentSchema = z.object({
  id: z.string().min(1).max(160), role: z.enum(["assistant", "recipient", "unknown"]),
  text: z.string().min(1), startSeconds: z.number().nonnegative().nullable(), endSeconds: z.number().nonnegative().nullable()
});
export const transcriptTranslationPayloadSchema = z.object({ segments: z.array(sourceSegmentSchema), text: z.string() });
export const summaryItemSchema = z.strictObject({
  id: z.string().min(1).max(160), label: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(4000),
  certainty: z.enum(["reported", "conditional", "unknown"]),
  sourceSegmentIds: z.array(z.string().min(1)).max(30)
});
export const callSummaryPayloadSchema = z.strictObject({
  schemaVersion: z.literal(2),
  overview: z.array(z.strictObject({
    label: z.string().trim().min(1).max(160).nullable(), text: z.string().trim().min(1).max(1200),
    findingIds: z.array(z.string().min(1)).min(1).max(30)
  })).max(4),
  findings: z.array(summaryItemSchema).max(30),
  nextSteps: z.array(z.strictObject({ text: z.string().trim().min(1).max(2000), sourceSegmentIds: z.array(z.string().min(1)).min(1).max(30) })).max(30),
  unresolved: z.array(z.string().trim().min(1).max(4000)).max(30)
}).superRefine((value, context) => {
  const ids = new Set(value.findings.map(item => item.id));
  if (ids.size !== value.findings.length) context.addIssue({ code: "custom", message: "Duplicate finding id", path: ["findings"] });
  for (const [index, item] of value.overview.entries()) {
    if (new Set(item.findingIds).size !== item.findingIds.length || item.findingIds.some(id => !ids.has(id)))
      context.addIssue({ code: "custom", message: "Invalid overview references", path: ["overview", index, "findingIds"] });
  }
  for (const [index, item] of [...value.findings, ...value.nextSteps].entries()) {
    if (new Set(item.sourceSegmentIds).size !== item.sourceSegmentIds.length ||
      ("certainty" in item && item.certainty !== "unknown" && !item.sourceSegmentIds.length))
      context.addIssue({ code: "custom", message: "Missing or duplicate evidence", path: ["evidence", index] });
  }
});
export const textArtifactPayloadSchema = z.union([planReviewPayloadSchema, transcriptTranslationPayloadSchema, callSummaryPayloadSchema]);
export type PlanReviewPayload = z.infer<typeof planReviewPayloadSchema>;
export type TranscriptTranslationPayload = z.infer<typeof transcriptTranslationPayloadSchema>;
export type CallSummaryPayload = z.infer<typeof callSummaryPayloadSchema>;
export type SourceSegment = z.infer<typeof sourceSegmentSchema>;
export const callTextArtifactSchema = z.object({
  id: z.string().uuid(), callId: z.string().uuid(), kind: textArtifactKindSchema,
  compilationId: z.string().uuid().nullable(), transcriptRevisionId: z.string().uuid().nullable(),
  sourceHash: hashSchema, targetLanguage: textLanguageSchema, generatorVersion: z.string(),
  status: textArtifactStatusSchema, payload: textArtifactPayloadSchema.nullable(), payloadHash: hashSchema.nullable(),
  failureCode: z.string().nullable(), retryable: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime()
});
export type CallTextArtifact = z.infer<typeof callTextArtifactSchema>;
export const finalTranscriptRevisionSchema = z.object({
  id: z.string().uuid(), transcriptId: z.string().uuid(), callAttemptId: z.string().uuid().nullable(),
  revision: z.number().int().positive(), sourceHash: hashSchema, text: z.string(),
  segments: z.array(sourceSegmentSchema), createdAt: z.string().datetime()
});
export type FinalTranscriptRevision = z.infer<typeof finalTranscriptRevisionSchema>;
export const planReviewRequestSchema = z.strictObject({
  compilationId: z.string().uuid(), revision: z.number().int().positive(), snapshotHash: hashSchema,
  targetLanguage: textLanguageSchema
});
export const transcriptArtifactRequestSchema = z.strictObject({ sourceRevisionId: z.string().uuid(), targetLanguage: textLanguageSchema });
export const reviewEvidenceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("original"), language: languageTagSchema, selectionRevision: z.number().int().positive() }),
  z.strictObject({ mode: z.literal("translated"), language: textLanguageSchema, artifactId: z.string().uuid(), artifactHash: hashSchema, selectionRevision: z.number().int().positive() })
]);
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
export const compilationReviewApprovalInputSchema = z.strictObject({
  revision: z.number().int().positive(), snapshotHash: hashSchema, review: reviewEvidenceSchema.optional()
});
export type CompilationReviewApprovalInput = z.infer<typeof compilationReviewApprovalInputSchema>;
