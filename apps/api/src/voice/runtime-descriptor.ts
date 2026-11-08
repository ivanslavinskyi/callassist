import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CallCompilation, VoiceConsentRuntimePolicy } from "@callassist/contracts";
import type { VoiceConversationContext } from "./voice-runtime";

export type RuntimeDescriptor = {
  version: 1; runtime: "unified_live" | "live_native_v1" | "live_native_v2"; runtimeVersion: string; releaseSha: string | null;
  compilerVersion: string; policyVersion: string; promptHash: string; compilationHash: string;
  models: { live: string; delegation: string; speech: string };
  voice: string; callLocale: string; disclosureVersion: string | null;
  consentPolicy?: ConsentRuntimePolicy;
  implementationVersion?: string;
  sourceDigest?: string;
  nativeConfiguration?: ReturnType<typeof import("./live-native-configuration").nativeConfigurationIdentity>;
  experiment?: { requested: "native_v1" | "native_v2"; selection: string; briefHash?: string; briefUtf8Bytes?: number;
    closing: "native_quiet_tail_v1" | "native_quiet_tail_v2" | "application_tts"; interruption: "native" | "application_clear" };
};

export type ConsentRuntimePolicy = VoiceConsentRuntimePolicy;

/** A restart/expired prewarm must not silently select another implementation for
 * an already-described attempt. Historical managed first-write behavior stays. */
export function assertPinnedLiveRuntime(prior: RuntimeDescriptor | null | undefined, requested: RuntimeDescriptor) {
  if (!prior || (!prior.runtime.startsWith("live_native_") && !requested.runtime.startsWith("live_native_"))) return;
  const identity = (d: RuntimeDescriptor) => ({ runtime: d.runtime, runtimeVersion: d.runtimeVersion,
    implementationVersion: d.implementationVersion, sourceDigest: d.sourceDigest, promptHash: d.promptHash, compilationHash: d.compilationHash,
    models: d.models, voice: d.voice, callLocale: d.callLocale, consentPolicy: d.consentPolicy, experiment: d.experiment,
    nativeConfiguration: d.nativeConfiguration });
  if (!isDeepStrictEqual(identity(prior), identity(requested))) throw new Error("LIVE_RUNTIME_SELECTION_CHANGED");
}

export function liveRuntimeDescriptor(context: VoiceConversationContext, compilation: CallCompilation,
  instructions: string, models: RuntimeDescriptor["models"],
  environment: NodeJS.ProcessEnv = process.env, consentPolicy?: ConsentRuntimePolicy): RuntimeDescriptor {
  const sha = environment.SHPROHLI_RELEASE_SHA?.trim();
  const sourceDigest = environment.SHPROHLI_RUNTIME_SOURCE_DIGEST?.trim();
  return { version: 1, runtime: "unified_live", runtimeVersion: "live-managed-v9",
    implementationVersion: "live-audit-a-2026-11-05",
    ...(sourceDigest && /^[a-f0-9]{64}$/i.test(sourceDigest) ? { sourceDigest: sourceDigest.toLowerCase() } : {}),
    releaseSha: sha && /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null,
    compilerVersion: compilation.compilerVersion, policyVersion: compilation.policyDecision.policyVersion,
    promptHash: createHash("sha256").update(instructions).digest("hex"), compilationHash: compilation.snapshotHash,
    models, voice: context.snapshot.runtime.liveVoice ?? context.snapshot.runtime.voiceGender,
    callLocale: context.snapshot.plan.callLocale,
    disclosureVersion: context.snapshot.runtime.initialDisclosure?.version ?? null,
    ...(consentPolicy ? { consentPolicy: { ...consentPolicy } } : {}) };
}
