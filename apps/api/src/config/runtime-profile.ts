/** Reviewed runtime/preparation pairs. Profile selection never changes model or capacity settings. */
export const runtimeProfiles = {
  native_v2: {
    name: "native_v2", release: "native-v2-holistic-2026-11-11", mode: "live_native_v2",
    experiment: "native_v2", promptVersion: "preparation-live-holistic-2026-11-11",
    compilerVersion: "brief-compiler-17", planSchemaVersion: "11",
    runtimeVersion: "live-plan-only-2026-11-11.2", minimumMigration: "0116_preparation_validation_events.sql"
  },
  managed: {
    name: "managed", release: "managed-v9", mode: "unified_live",
    experiment: "off", promptVersion: "preparation-2026-10-05",
    compilerVersion: "brief-compiler-6", planSchemaVersion: "4",
    runtimeVersion: "live-managed-v9", minimumMigration: "0115_default_audio_retention_copy.sql"
  }
} as const;
export type RuntimeProfile = typeof runtimeProfiles[keyof typeof runtimeProfiles];

export function selectedRuntimeProfile(environment: NodeJS.ProcessEnv = process.env): RuntimeProfile | null {
  const name = environment.CALL_RUNTIME_PROFILE?.trim();
  if (!name) return null; // Existing installations retain explicit low-level configuration.
  if (name !== "native_v2" && name !== "managed") throw new Error("CALL_RUNTIME_PROFILE must be native_v2 or managed");
  const profile = runtimeProfiles[name];
  for (const [key, expected] of Object.entries({ VOICE_RUNTIME_DRIVER: "live", VOICE_RUNTIME_LIVE_FALLBACK: "false",
    VOICE_RUNTIME_LIVE_EXPERIMENT: profile.experiment, REALTIME_AGENT_HANGUP_ENABLED: "true" })) {
    const actual = environment[key]?.trim();
    if (actual && actual !== expected) throw new Error(`CALL_RUNTIME_PROFILE=${name} conflicts with ${key}; remove the override or set it to ${expected}`);
  }
  return profile;
}

export function voiceAgentHangupEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return selectedRuntimeProfile(environment) !== null || environment.REALTIME_AGENT_HANGUP_ENABLED === "true";
}
