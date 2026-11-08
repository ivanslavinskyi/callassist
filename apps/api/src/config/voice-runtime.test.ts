import { expect, it } from "vitest";
import { voiceRuntimeMode } from "./voice-runtime";

it.each([
  [{}, "unified_live"],
  [{ NODE_ENV: "production" }, "unified_live"],
  [{ VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2" }, "live_native_v2"],
  [{ NODE_ENV: "production", VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2" }, "live_native_v2"],
  [{ NODE_ENV: "production", VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2", VOICE_RUNTIME_NATIVE_V2_LOCAL: "false" }, "live_native_v2"],
  [{ VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2", VOICE_RUNTIME_NATIVE_V2_LOCAL: "true" }, "live_native_v2"],
  [{ VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v1" }, "live_native_v1"],
  [{ VOICE_RUNTIME_DRIVER: "live", VOICE_RUNTIME_LIVE_FALLBACK: "false" }, "unified_live"],
  [{ VOICE_RUNTIME_DRIVER: "realtime" }, "legacy_realtime"],
  [{ VOICE_RUNTIME_DRIVER: "live", VOICE_RUNTIME_LIVE_FALLBACK: "true" }, "legacy_hybrid"]
] as const)("resolves the runtime and AMD mode from the same explicit configuration %j", (env, mode) => {
  expect(voiceRuntimeMode(env)).toBe(mode);
});

it.each([
  { NODE_ENV: "production", VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2", VOICE_RUNTIME_DRIVER: "realtime" },
  { NODE_ENV: "production", VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2", VOICE_RUNTIME_LIVE_FALLBACK: "true" },
  { VOICE_RUNTIME_LIVE_EXPERIMENT: "unknown" },
  { VOICE_RUNTIME_DRIVER: "unknown" },
  { VOICE_RUNTIME_LIVE_FALLBACK: "unknown" },
  { VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v1", VOICE_RUNTIME_DRIVER: "realtime" },
  { VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v1", VOICE_RUNTIME_LIVE_FALLBACK: "true" }
])("rejects an ambiguous experimental configuration %j", env => {
  expect(() => voiceRuntimeMode(env)).toThrow();
});
