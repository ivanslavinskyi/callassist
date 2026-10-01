export function voiceRuntimeDriver(environment: NodeJS.ProcessEnv): "realtime" | "live" {
  const driver = environment.VOICE_RUNTIME_DRIVER?.trim() || "live";
  if (driver !== "realtime" && driver !== "live") throw new Error("VOICE_RUNTIME_DRIVER must be realtime or live");
  return driver;
}

export function voiceRuntimeMode(environment: NodeJS.ProcessEnv) {
  if (voiceRuntimeDriver(environment) === "realtime") return "legacy_realtime";
  const fallback = environment.VOICE_RUNTIME_LIVE_FALLBACK?.trim() || "false";
  if (!["true", "false"].includes(fallback)) throw new Error("VOICE_RUNTIME_LIVE_FALLBACK must be true or false");
  return fallback === "true" ? "legacy_hybrid" : "unified_live";
}
