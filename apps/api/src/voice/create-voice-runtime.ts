import { OpenAIRealtimeBridge } from "../realtime/openai-realtime-bridge";
import { OpenAILiveBridge, type OpenAILiveBridgeOptions } from "./openai-live-bridge";
import type { VoiceRuntime } from "./voice-runtime";

export function voiceRuntimeDriver(environment: NodeJS.ProcessEnv): "realtime" | "live" {
  const driver = environment.VOICE_RUNTIME_DRIVER?.trim() || "realtime";
  if (driver !== "realtime" && driver !== "live") throw new Error("VOICE_RUNTIME_DRIVER must be realtime or live");
  return driver;
}

export function createVoiceRuntime(options: OpenAILiveBridgeOptions, environment: NodeJS.ProcessEnv = process.env): VoiceRuntime {
  if (voiceRuntimeDriver(environment) === "realtime") return new OpenAIRealtimeBridge(options);
  const fallback = environment.VOICE_RUNTIME_LIVE_FALLBACK?.trim() || "true";
  if (!["true", "false"].includes(fallback)) throw new Error("VOICE_RUNTIME_LIVE_FALLBACK must be true or false");
  return new OpenAILiveBridge({ ...options,
    liveModel: environment.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1",
    delegationModel: environment.OPENAI_LIVE_DELEGATION_MODEL?.trim() || "gpt-6-luna",
    liveMaleVoice: environment.OPENAI_LIVE_MALE_VOICE?.trim() || "cedar",
    liveFemaleVoice: environment.OPENAI_LIVE_FEMALE_VOICE?.trim() || "marin",
    conversationFallback: fallback === "true"
  });
}
