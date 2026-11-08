import { createHash } from "node:crypto";
import type { NativeSession } from "./live-native-prompts";
import { NATIVE_COMPLETION_TIMING } from "./live-native-completion";

// Covers worst-case JSON escaping of all bounded appointment quote fields.
export const NATIVE_TOOL_ARGUMENT_LIMIT = 425_984;
// Match the Live transport's bounded session.close grace period. This is only
// post-hangup trace drainage; it must never keep the telephone call open.
export const NATIVE_TRACE_DRAIN_MS = 15_000;
export const NATIVE_CONFIGURATION_VERSION = "live-native-context-2026-11-08";
export function nativeResponsesConfiguration(session: NativeSession, model = "gpt-6-luna") {
  return { model, parallel_tool_calls: false, tool_choice: "auto" as const,
    tools: session.tools ?? [], reasoning: { effort: "low" as const },
    max_output_tokens: session.backendMaxOutputTokens ?? 2048,
    instructions: session.backendInstructions };
}
export function nativeConfigurationIdentity(session: NativeSession, model = "gpt-6-luna") {
  const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return { version: NATIVE_CONFIGURATION_VERSION, profile: session.profile ?? "general",
    backendHash: hash(nativeResponsesConfiguration(session, model)), toolsHash: hash(session.tools),
    startupHash: hash({ instructions: session.instructions, input: session.input, opening: session.opening }),
    maxOutputTokens: session.backendMaxOutputTokens ?? 2048, toolArgumentLimit: NATIVE_TOOL_ARGUMENT_LIMIT,
    closing: "quoted_episode_recovery_v2", completionRecovery: NATIVE_COMPLETION_TIMING,
    trace: "bounded_trace_v1", traceDrainMs: NATIVE_TRACE_DRAIN_MS, recording: "declarative_local" };
}
