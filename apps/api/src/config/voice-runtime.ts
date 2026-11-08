export function voiceRuntimeDriver(environment: NodeJS.ProcessEnv): "realtime" | "live" {
  const driver = environment.VOICE_RUNTIME_DRIVER?.trim() || "live";
  if (driver !== "realtime" && driver !== "live") throw new Error("VOICE_RUNTIME_DRIVER must be realtime or live");
  return driver;
}

export function voiceRuntimeMode(environment: NodeJS.ProcessEnv) {
  const experiment = environment.VOICE_RUNTIME_LIVE_EXPERIMENT?.trim() || "off";
  if (!["off", "native_v1", "native_v2"].includes(experiment)) throw new Error("VOICE_RUNTIME_LIVE_EXPERIMENT must be off, native_v1 or native_v2");
  const driver = voiceRuntimeDriver(environment);
  const fallback = environment.VOICE_RUNTIME_LIVE_FALLBACK?.trim() || "false";
  if (!["true", "false"].includes(fallback)) throw new Error("VOICE_RUNTIME_LIVE_FALLBACK must be true or false");
  if (experiment === "native_v2") {
    if (driver !== "live" || fallback !== "false")
      throw new Error("native_v2 requires live with fallback=false");
    return "live_native_v2";
  }
  if (experiment === "native_v1") {
    if (driver !== "live" || fallback !== "false") throw new Error("native_v1 requires live with fallback=false");
    return "live_native_v1";
  }
  if (driver === "realtime") return "legacy_realtime";
  return fallback === "true" ? "legacy_hybrid" : "unified_live";
}
