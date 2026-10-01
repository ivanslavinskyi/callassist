import { expect, it } from "vitest";
import { voiceRuntimeMode } from "./voice-runtime";

it.each([
  [{}, "unified_live"],
  [{ VOICE_RUNTIME_DRIVER: "live", VOICE_RUNTIME_LIVE_FALLBACK: "false" }, "unified_live"],
  [{ VOICE_RUNTIME_DRIVER: "realtime" }, "legacy_realtime"],
  [{ VOICE_RUNTIME_DRIVER: "live", VOICE_RUNTIME_LIVE_FALLBACK: "true" }, "legacy_hybrid"]
] as const)("resolves the runtime and AMD mode from the same explicit configuration %j", (env, mode) => {
  expect(voiceRuntimeMode(env)).toBe(mode);
});
