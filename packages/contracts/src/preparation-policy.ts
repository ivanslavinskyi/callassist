import { z } from "zod";

export const preparationModelSchema = z.enum(["gpt-5.6", "gpt-5.6-terra", "gpt-6-luna"]);
export const preparationProfileSchema = z.strictObject({
  model: preparationModelSchema,
  serviceTier: z.enum(["default", "fast"])
});
export type PreparationProfile = z.infer<typeof preparationProfileSchema>;
export const preparationCapacitySchema = z.strictObject({
  generationSlots: z.number().int().min(1).max(64),
  reviewSlots: z.number().int().min(1).max(32),
  providerSlots: z.number().int().min(1).max(64),
  queueLimit: z.number().int().min(1).max(1000),
  perUserWaiting: z.number().int().min(1).max(10),
  providerRequestsPerMinute: z.number().int().min(1).max(100_000).default(100),
  providerTokensPerMinute: z.number().int().min(250_000).max(1_000_000_000).default(2_000_000),
  voiceReservePercent: z.number().int().min(1).max(90).default(25)
});
export const preparationRuntimePolicySchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().positive(),
  generation: preparationProfileSchema,
  audit: preparationProfileSchema,
  review: preparationProfileSchema,
  promptVersion: z.literal("preparation-2026-10-05"),
  pricingVersion: z.literal("openai-preparation-2026-10-05"),
  timeoutMs: z.number().int().min(1000).max(300_000),
  requestTimeoutMs: z.number().int().min(1000).max(120_000),
  maxProviderRequests: z.number().int().min(1).max(24),
  maxOutputTokens: z.number().int().min(2048).max(20_000)
});
export type PreparationRuntimePolicy = z.infer<typeof preparationRuntimePolicySchema>;
export const defaultPreparationRuntimePolicy: PreparationRuntimePolicy = {
  version: 1, revision: 1,
  generation: { model: "gpt-5.6", serviceTier: "default" },
  audit: { model: "gpt-5.6", serviceTier: "default" },
  review: { model: "gpt-5.6", serviceTier: "default" },
  promptVersion: "preparation-2026-10-05", pricingVersion: "openai-preparation-2026-10-05",
  timeoutMs: 120_000, requestTimeoutMs: 35_000, maxProviderRequests: 12, maxOutputTokens: 20_000
};
export const defaultPreparationCapacity = {
  generationSlots: 4, reviewSlots: 2, providerSlots: 4, queueLimit: 40, perUserWaiting: 2,
  providerRequestsPerMinute: 100, providerTokensPerMinute: 2_000_000, voiceReservePercent: 25
};
export const preparationProfileKey = (profile: PreparationProfile) => `${profile.model}:${profile.serviceTier}`;
export const preparationSettingsUpdateSchema = z.strictObject({
  generation: preparationProfileSchema,
  capacity: preparationCapacitySchema,
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500)
});
export type PreparationSettingsUpdate = z.infer<typeof preparationSettingsUpdateSchema>;
export const preparationProfileAdmissionSchema = z.strictObject({
  profile: preparationProfileSchema,
  expectedRevision: z.number().int().positive(),
  // SHA-256 of the reviewed evaluation report. Never a path or arbitrary payload.
  reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.number().int().min(200).max(100_000),
  repetitions: z.number().int().min(2).max(100),
  criticalFailures: z.literal(0),
  humanReviewed: z.literal(true),
  reason: z.string().trim().min(3).max(500)
});
export type PreparationProfileAdmission = z.infer<typeof preparationProfileAdmissionSchema>;
export const preparationSettingsViewSchema = z.strictObject({
  policy: preparationRuntimePolicySchema,
  capacity: preparationCapacitySchema,
  approvedProfiles: z.array(z.string().max(64)).max(6),
  // Runtime capability, not a quality attestation or a client-writable setting.
  localTesting: z.boolean().optional(),
  updatedAt: z.string().datetime().nullable(), updatedByUserId: z.uuid().nullable(), reason: z.string().nullable(),
  history: z.array(z.strictObject({ revision: z.number().int().positive(), createdAt: z.string().datetime(),
    actorUserId: z.uuid().nullable(), reason: z.string(), generation: preparationProfileSchema,
    capacity: preparationCapacitySchema, reportSha256: z.string().nullable(), localTest: z.boolean().optional() })).max(50)
});
export type PreparationSettingsView = z.infer<typeof preparationSettingsViewSchema>;

export const preparationCheckpointSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(["dispatched", "headers", "response_created", "first_event", "first_output", "terminal"]),
  elapsedMs: z.number().int().min(0).max(300_000),
  providerRequestId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).nullable(),
  providerResponseId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).nullable(),
  actualServiceTier: z.enum(["default", "fast", "priority", "flex", "auto", "unknown"]).nullable()
});
export type PreparationCheckpoint = z.infer<typeof preparationCheckpointSchema>;
