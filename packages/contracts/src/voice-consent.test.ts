import { describe, expect, it } from "vitest";
import { defaultVoiceConsentRuntimePolicy, voiceConsentRuntimePolicy, voiceConsentRuntimePolicySchema, voiceConsentSettingsUpdateSchema } from "./voice-consent";

describe("voice consent runtime policy", () => {
  it("defaults to native consent with fixed, versioned settlement policy", () => {
    expect(defaultVoiceConsentRuntimePolicy).toEqual({ mode: "semantic_native", revision: 1,
      classifierVersion: "consent-phrases-v1", fastSettleMs: 200, semanticSettleMs: 900 });
    expect(voiceConsentRuntimePolicy("hybrid_deterministic_v1", 2)).toMatchObject({ mode: "hybrid_deterministic_v1", revision: 2 });
  });
  it.each([{ mode: "legacy_hybrid" }, { fastSettleMs: 0 }, { semanticSettleMs: 200 }, { classifierVersion: "unknown" }, { revision: 0 }])
    ("rejects an unsupported runtime policy %j", change => {
      expect(voiceConsentRuntimePolicySchema.safeParse({ ...defaultVoiceConsentRuntimePolicy, ...change }).success).toBe(false);
    });
  it("requires a known mode, current revision and a nonempty change reason", () => {
    const input = { mode: "hybrid_deterministic_v1", expectedRevision: 1, reason: "  Approved pilot  " };
    expect(voiceConsentSettingsUpdateSchema.parse(input).reason).toBe("Approved pilot");
    for (const change of [{ mode: "live" }, { expectedRevision: 0 }, { reason: "  " }, { fastSettleMs: 0 }]) {
      expect(voiceConsentSettingsUpdateSchema.safeParse({ ...input, ...change }).success).toBe(false);
    }
  });
});
