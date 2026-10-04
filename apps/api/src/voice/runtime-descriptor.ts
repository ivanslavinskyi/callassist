import { createHash } from "node:crypto";
import type { CallCompilation, VoiceConsentRuntimePolicy } from "@callassist/contracts";
import type { VoiceConversationContext } from "./voice-runtime";

export type RuntimeDescriptor = {
  version: 1; runtime: "unified_live"; runtimeVersion: string; releaseSha: string | null;
  compilerVersion: string; policyVersion: string; promptHash: string; compilationHash: string;
  models: { live: string; delegation: string; speech: string };
  voice: string; callLocale: string; disclosureVersion: string | null;
  consentPolicy?: ConsentRuntimePolicy;
};

export type ConsentRuntimePolicy = VoiceConsentRuntimePolicy;

export function liveRuntimeDescriptor(context: VoiceConversationContext, compilation: CallCompilation,
  instructions: string, models: RuntimeDescriptor["models"],
  environment: NodeJS.ProcessEnv = process.env, consentPolicy?: ConsentRuntimePolicy): RuntimeDescriptor {
  const sha = environment.SHPROHLI_RELEASE_SHA?.trim();
  return { version: 1, runtime: "unified_live", runtimeVersion: "live-managed-v9",
    releaseSha: sha && /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null,
    compilerVersion: compilation.compilerVersion, policyVersion: compilation.policyDecision.policyVersion,
    promptHash: createHash("sha256").update(instructions).digest("hex"), compilationHash: compilation.snapshotHash,
    models, voice: context.snapshot.runtime.liveVoice ?? context.snapshot.runtime.voiceGender,
    callLocale: context.snapshot.plan.callLocale,
    disclosureVersion: context.snapshot.runtime.initialDisclosure?.version ?? null,
    ...(consentPolicy ? { consentPolicy: { ...consentPolicy } } : {}) };
}
