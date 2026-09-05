import { createHash } from "node:crypto";
import type { ProviderTextTokenUsage } from "../storage/call-repository";

type TokenDetails = {
  text_tokens?: unknown;
  audio_tokens?: unknown;
  cached_tokens?: unknown;
  cached_tokens_details?: {
    text_tokens?: unknown;
    audio_tokens?: unknown;
  };
};

export type RealtimeResponseUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  input_token_details?: TokenDetails;
  output_token_details?: TokenDetails;
};

export type RealtimeTranscriptionUsage =
  | {
      type?: "tokens";
      input_tokens?: unknown;
      output_tokens?: unknown;
      total_tokens?: unknown;
      input_token_details?: TokenDetails;
    }
  | {
      type?: "duration";
      seconds?: unknown;
    };

export function parseRealtimeResponseUsage(
  raw: RealtimeResponseUsage | null | undefined
): ProviderTextTokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const inputTokens = counter(raw.input_tokens);
  const outputTokens = counter(raw.output_tokens);
  const totalTokens = counter(raw.total_tokens);
  const inputTextTokens = counter(raw.input_token_details?.text_tokens);
  const inputAudioTokens = counter(raw.input_token_details?.audio_tokens);
  const cachedInputTextTokens = counter(
    raw.input_token_details?.cached_tokens_details?.text_tokens
  );
  const cachedInputAudioTokens = counter(
    raw.input_token_details?.cached_tokens_details?.audio_tokens
  );
  const outputTextTokens = counter(raw.output_token_details?.text_tokens);
  const outputAudioTokens = counter(raw.output_token_details?.audio_tokens);
  const counters = [
    inputTokens,
    outputTokens,
    totalTokens,
    inputTextTokens,
    inputAudioTokens,
    cachedInputTextTokens,
    cachedInputAudioTokens,
    outputTextTokens,
    outputAudioTokens
  ];
  if (counters.some(({ valid }) => !valid)) return null;
  if (counters.every(({ value }) => value === null)) return null;
  return {
    requestCount: 1,
    inputTextTokens: inputTextTokens.value,
    cachedInputTextTokens: cachedInputTextTokens.value,
    cacheWriteInputTextTokens: null,
    outputTextTokens: outputTextTokens.value,
    reasoningOutputTokens: null,
    inputAudioTokens: inputAudioTokens.value,
    cachedInputAudioTokens: cachedInputAudioTokens.value,
    outputAudioTokens: outputAudioTokens.value,
    totalTokens: totalTokens.value,
    durationSeconds: null,
    billableSeconds: null,
    rawUsage: knownRealtimeResponseUsage(raw)
  };
}

export function parseRealtimeTranscriptionUsage(
  raw: RealtimeTranscriptionUsage | null | undefined
): ProviderTextTokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "duration" || "seconds" in raw) {
    const seconds = duration(raw.seconds);
    if (!seconds.valid || seconds.value === null) return null;
    return {
      requestCount: 1,
      inputTextTokens: null,
      cachedInputTextTokens: null,
      cacheWriteInputTextTokens: null,
      outputTextTokens: null,
      reasoningOutputTokens: null,
      inputAudioTokens: null,
      cachedInputAudioTokens: null,
      outputAudioTokens: null,
      totalTokens: null,
      durationSeconds: seconds.value,
      billableSeconds: null,
      rawUsage: { type: "duration", seconds: seconds.value }
    };
  }
  const tokenUsage = raw as Extract<
    RealtimeTranscriptionUsage,
    { type?: "tokens" }
  >;
  const inputTokens = counter(tokenUsage.input_tokens);
  const outputTokens = counter(tokenUsage.output_tokens);
  const totalTokens = counter(tokenUsage.total_tokens);
  const inputTextTokens = counter(tokenUsage.input_token_details?.text_tokens);
  const inputAudioTokens = counter(tokenUsage.input_token_details?.audio_tokens);
  const counters = [
    inputTokens,
    outputTokens,
    totalTokens,
    inputTextTokens,
    inputAudioTokens
  ];
  if (counters.some(({ valid }) => !valid)) return null;
  if (counters.every(({ value }) => value === null)) return null;
  return {
    requestCount: 1,
    inputTextTokens: inputTextTokens.value ?? inputTokens.value,
    cachedInputTextTokens: null,
    cacheWriteInputTextTokens: null,
    outputTextTokens: outputTokens.value,
    reasoningOutputTokens: null,
    inputAudioTokens: inputAudioTokens.value,
    cachedInputAudioTokens: null,
    outputAudioTokens: null,
    totalTokens: totalTokens.value,
    durationSeconds: null,
    billableSeconds: null,
    rawUsage: {
      type: "tokens",
      input_tokens: inputTokens.value,
      output_tokens: outputTokens.value,
      total_tokens: totalTokens.value,
      input_token_details: {
        text_tokens: inputTextTokens.value,
        audio_tokens: inputAudioTokens.value
      }
    }
  };
}

export function createProviderEventOperationId(
  operationType: "realtime_response" | "transcription",
  providerEventId: string
) {
  const bytes = createHash("sha256")
    .update(`callassist:openai:${operationType}:${providerEventId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function counter(value: unknown) {
  if (value === undefined || value === null) {
    return { valid: true, value: null } as const;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { valid: false, value: null } as const;
  }
  return { valid: true, value } as const;
}

function duration(value: unknown) {
  if (value === undefined || value === null) {
    return { valid: true, value: null } as const;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return { valid: false, value: null } as const;
  }
  return { valid: true, value } as const;
}

function knownRealtimeResponseUsage(raw: RealtimeResponseUsage) {
  return {
    input_tokens: nullableNumber(raw.input_tokens),
    output_tokens: nullableNumber(raw.output_tokens),
    total_tokens: nullableNumber(raw.total_tokens),
    input_token_details: {
      text_tokens: nullableNumber(raw.input_token_details?.text_tokens),
      audio_tokens: nullableNumber(raw.input_token_details?.audio_tokens),
      cached_tokens: nullableNumber(raw.input_token_details?.cached_tokens),
      cached_tokens_details: {
        text_tokens: nullableNumber(
          raw.input_token_details?.cached_tokens_details?.text_tokens
        ),
        audio_tokens: nullableNumber(
          raw.input_token_details?.cached_tokens_details?.audio_tokens
        )
      }
    },
    output_token_details: {
      text_tokens: nullableNumber(raw.output_token_details?.text_tokens),
      audio_tokens: nullableNumber(raw.output_token_details?.audio_tokens)
    }
  };
}

function nullableNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}
