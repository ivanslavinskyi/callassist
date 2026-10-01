import { OpenAIRealtimeBridge } from "../realtime/openai-realtime-bridge";
import { OpenAILiveBridge, type OpenAILiveBridgeOptions } from "./openai-live-bridge";
import type { VoiceRuntime } from "./voice-runtime";
import { LIVE_VOICES } from "@callassist/contracts";
import { voiceRuntimeMode } from "../config/voice-runtime";
export { voiceRuntimeDriver } from "../config/voice-runtime";

export function createVoiceRuntime(options: OpenAILiveBridgeOptions, environment: NodeJS.ProcessEnv = process.env): VoiceRuntime {
  const mode = voiceRuntimeMode(environment);
  if (mode === "legacy_realtime") return new OpenAIRealtimeBridge(options);
  for (const [gender, voice] of Object.entries(LIVE_VOICES)) {
    const key = `OPENAI_LIVE_${gender.toUpperCase()}_VOICE`;
    if (environment[key]?.trim() && environment[key]!.trim() !== voice) {
      throw new Error(`${key} must be ${voice}; Live uses the approved product voice`);
    }
  }
  return new OpenAILiveBridge({ ...options,
    liveModel: environment.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1",
    delegationModel: environment.OPENAI_LIVE_DELEGATION_MODEL?.trim() || "gpt-6-luna",
    speechModel: environment.OPENAI_SPEECH_MODEL?.trim() || "gpt-4o-mini-tts",
    conversationFallback: mode === "legacy_hybrid"
  });
}
