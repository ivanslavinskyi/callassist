import { z } from "zod";

export const voiceConsentModeSchema = z.enum(["semantic_native", "hybrid_deterministic_v1"]);
export type VoiceConsentMode = z.infer<typeof voiceConsentModeSchema>;

/** Operational policy pinned to a call attempt, separate from its approved disclosure. */
export const voiceConsentRuntimePolicySchema = z.strictObject({
  mode: voiceConsentModeSchema,
  revision: z.number().int().positive(),
  classifierVersion: z.literal("consent-phrases-v1"),
  fastSettleMs: z.literal(200),
  semanticSettleMs: z.literal(900)
});
export type VoiceConsentRuntimePolicy = z.infer<typeof voiceConsentRuntimePolicySchema>;

export function voiceConsentRuntimePolicy(mode: VoiceConsentMode, revision: number): VoiceConsentRuntimePolicy {
  return voiceConsentRuntimePolicySchema.parse({ mode, revision, classifierVersion: "consent-phrases-v1", fastSettleMs: 200, semanticSettleMs: 900 });
}
export const defaultVoiceConsentRuntimePolicy: VoiceConsentRuntimePolicy = voiceConsentRuntimePolicy("semantic_native", 1);

export const voiceConsentSettingsViewSchema = z.strictObject({
  policy: voiceConsentRuntimePolicySchema,
  updatedAt: z.string().datetime().nullable(),
  updatedByUserId: z.uuid().nullable(),
  reason: z.string().nullable()
});
export type VoiceConsentSettingsView = z.infer<typeof voiceConsentSettingsViewSchema>;

export const voiceConsentSettingsUpdateSchema = z.strictObject({
  mode: voiceConsentModeSchema,
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500)
});
export type VoiceConsentSettingsUpdate = z.infer<typeof voiceConsentSettingsUpdateSchema>;
