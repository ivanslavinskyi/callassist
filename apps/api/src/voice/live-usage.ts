import type { ProviderTextTokenUsage } from "../storage/call-repository";

export function liveDurationUsage(seconds: number | null, finalized: boolean): ProviderTextTokenUsage | null {
  if (seconds === null) return null;
  return {
    requestCount: 1, inputTextTokens: null, cachedInputTextTokens: null,
    cacheWriteInputTextTokens: null, outputTextTokens: null, reasoningOutputTokens: null,
    totalTokens: null, durationSeconds: seconds, billableSeconds: null,
    rawUsage: { seconds, finalized, source: "live_session" }
  };
}

/** Allowlist numeric counters; provider envelopes must never persist conversation text. */
export function liveResponsesUsage(raw: unknown): ProviderTextTokenUsage | null {
  const value = object(raw);
  const input = counter(value.input_tokens);
  const output = counter(value.output_tokens);
  const total = counter(value.total_tokens);
  const details = object(value.input_tokens_details);
  const cached = counter(details.cached_tokens);
  const written = counter(details.cache_write_tokens);
  const reasoning = counter(object(value.output_tokens_details).reasoning_tokens);
  if ([details.cached_tokens, details.cache_write_tokens, object(value.output_tokens_details).reasoning_tokens]
    .some(value => value !== undefined && value !== null && counter(value) === null)) return null;
  if (input === null || output === null || total !== input + output ||
      (cached ?? 0) + (written ?? 0) > input || (reasoning ?? 0) > output) return null;
  return {
    requestCount: 1, inputTextTokens: input, cachedInputTextTokens: cached,
    cacheWriteInputTextTokens: written, outputTextTokens: output,
    reasoningOutputTokens: reasoning, totalTokens: total,
    rawUsage: { input_tokens: input, output_tokens: output, total_tokens: total,
      input_tokens_details: { cached_tokens: cached, cache_write_tokens: written },
      output_tokens_details: { reasoning_tokens: reasoning } }
  };
}

function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
