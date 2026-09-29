import { OpenAIRealtimeBridge } from "../realtime/openai-realtime-bridge";
import { OpenAILiveBridge, type OpenAILiveBridgeOptions } from "./openai-live-bridge";
import type { VoiceRuntime } from "./voice-runtime";
import { LIVE_VOICES } from "@callassist/contracts";

export function voiceRuntimeDriver(environment: NodeJS.ProcessEnv): "realtime" | "live" {
  const driver = environment.VOICE_RUNTIME_DRIVER?.trim() || "live";
  if (driver !== "realtime" && driver !== "live") throw new Error("VOICE_RUNTIME_DRIVER must be realtime or live");
  return driver;
}

export function createVoiceRuntime(options: OpenAILiveBridgeOptions, environment: NodeJS.ProcessEnv = process.env): VoiceRuntime {
  if (voiceRuntimeDriver(environment) === "realtime") return new OpenAIRealtimeBridge(options);
  for (const [gender, voice] of Object.entries(LIVE_VOICES)) {
    const key = `OPENAI_LIVE_${gender.toUpperCase()}_VOICE`;
    if (environment[key]?.trim() && environment[key]!.trim() !== voice) {
      throw new Error(`${key} must be ${voice}; Live uses the approved product voice`);
    }
  }
  const fallback = environment.VOICE_RUNTIME_LIVE_FALLBACK?.trim() || "false";
  if (!["true", "false"].includes(fallback)) throw new Error("VOICE_RUNTIME_LIVE_FALLBACK must be true or false");
  return new OpenAILiveBridge({ ...options,
    liveModel: environment.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1",
    delegationModel: environment.OPENAI_LIVE_DELEGATION_MODEL?.trim() || "gpt-6-luna",
    speechModel: environment.OPENAI_SPEECH_MODEL?.trim() || "gpt-4o-mini-tts",
    conversationFallback: fallback === "true"
  });
}
