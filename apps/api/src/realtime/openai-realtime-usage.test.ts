import { describe, expect, it } from "vitest";
import {
  createProviderEventOperationId,
  parseRealtimeResponseUsage,
  parseRealtimeTranscriptionUsage
} from "./openai-realtime-usage";

describe("OpenAI Realtime usage parsing", () => {
  it("preserves text, audio, and cached token details from response.done", () => {
    expect(parseRealtimeResponseUsage({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
      input_token_details: {
        text_tokens: 70,
        audio_tokens: 50,
        cached_tokens: 25,
        cached_tokens_details: { text_tokens: 20, audio_tokens: 5 }
      },
      output_token_details: { text_tokens: 10, audio_tokens: 20 }
    })).toMatchObject({
      inputTextTokens: 70,
      cachedInputTextTokens: 20,
      inputAudioTokens: 50,
      cachedInputAudioTokens: 5,
      outputTextTokens: 10,
      outputAudioTokens: 20,
      totalTokens: 150
    });
  });

  it("supports both transcription usage variants", () => {
    expect(parseRealtimeTranscriptionUsage({
      type: "tokens",
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
      input_token_details: { text_tokens: 2, audio_tokens: 10 }
    })).toMatchObject({
      inputTextTokens: 2,
      inputAudioTokens: 10,
      outputTextTokens: 4,
      totalTokens: 16
    });
    expect(parseRealtimeTranscriptionUsage({
      type: "duration",
      seconds: 1.25
    })).toMatchObject({ durationSeconds: 1.25, totalTokens: null });
  });

  it("rejects malformed or negative counters", () => {
    expect(parseRealtimeResponseUsage({ input_tokens: -1 })).toBeNull();
    expect(parseRealtimeTranscriptionUsage({
      type: "duration",
      seconds: Number.NaN
    })).toBeNull();
  });

  it("derives a stable UUID from a provider event identifier", () => {
    const first = createProviderEventOperationId("realtime_response", "resp_1");
    const second = createProviderEventOperationId("realtime_response", "resp_1");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(createProviderEventOperationId("transcription", "resp_1"))
      .not.toBe(first);
  });
});
