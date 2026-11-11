import { z } from "zod";

export const preparationValidationCodeSchema = z.enum([
  "SOURCE_CAPTURED","RESPONSE_RECEIVED","CANDIDATE_VALID","AUDIT_ACCEPT","AUDIT_REVISE","AUDIT_CLARIFY",
  "OUTPUT_MISSING","OUTPUT_TYPE_INVALID","OUTPUT_JSON_INVALID","OUTPUT_SCHEMA_INVALID",
  "OUTPUT_INCOMPLETE","OUTPUT_SIZE_LIMIT","MODEL_REFUSAL","STREAM_INVALID","STREAM_PADDING","PROVIDER_RESPONSE_INVALID",
  "NATIVE_AUTHORITY_INVALID","TASK_EVIDENCE_INVALID","AUDIT_OUTPUT_INVALID","AUDIT_PATH_INVALID",
  "REQUEST_SIZE_LIMIT","PROVIDER_TIMEOUT","PROVIDER_UNAVAILABLE","REQUEST_BUDGET_EXHAUSTED","DEADLINE_EXCEEDED",
  "RECOVERY_EXHAUSTED","POLICY_BLOCKED","PREPARATION_READY","PREPARATION_CLARIFICATION",
  "PREPARATION_BLOCKED","PREPARATION_FAILED","PREPARATION_CANCELLED","PUBLICATION_SUCCEEDED",
  "PUBLICATION_FAILED","INTEGRITY_FAILED"
]);
export type PreparationValidationCode = z.infer<typeof preparationValidationCodeSchema>;
export const preparationValidationStageSchema = z.enum([
  "source","input_moderation","compilation","compilation_repair","candidate_validation",
  "language_audit","output_moderation","publication","outcome"
]);
export type PreparationValidationStage = z.infer<typeof preparationValidationStageSchema>;
export const preparationDiagnosticMetadataSchema = z.strictObject({
  version:z.literal(1),stage:preparationValidationStageSchema,code:preparationValidationCodeSchema,
  candidateAttempt:z.number().int().min(0).max(6),auditAttempt:z.number().int().min(0).max(6),recoveryUsed:z.boolean(),
  policy:z.string().regex(/^preparation-[a-z0-9-]{1,80}$/).optional(),
  policyRevision:z.number().int().positive().optional(),
  model:z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/).optional(),
  compiler:z.string().regex(/^brief-compiler-\d+$/).optional(),
  build:z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/).optional(),
  promptHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  schemaHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  requestHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  candidateHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  remainingMs:z.number().int().min(0).max(300000).optional(),
  originalBytes:z.number().int().nonnegative(),retainedBytes:z.number().int().nonnegative(),truncated:z.boolean()
});
export type PreparationDiagnosticMetadata = z.infer<typeof preparationDiagnosticMetadataSchema>;
export const preparationDiagnosticEventSchema = z.strictObject({
  id:z.uuid(),preparationId:z.uuid(),operationId:z.uuid().nullable(),
  jobGeneration:z.number().int().positive(),workerAttempt:z.number().int().positive(),
  createdAt:z.iso.datetime(),metadata:preparationDiagnosticMetadataSchema
});
export type PreparationDiagnosticEvent = z.infer<typeof preparationDiagnosticEventSchema>;
export type PreparationDiagnosticInput = {
  id:string; operationId?:string|null;
  metadata:Omit<PreparationDiagnosticMetadata,"originalBytes"|"retainedBytes"|"truncated">;
  detail?:unknown;
};
export const preparationDiagnosticAccessSchema=z.strictObject({reason:z.string().trim().min(3).max(500)});
export const preparationDiagnosticEvidenceSchema=z.strictObject({
  event:preparationDiagnosticEventSchema,detail:z.unknown().nullable()
});
