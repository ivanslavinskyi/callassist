import { describe, expect, it } from "vitest";
import type { AdminProviderUsageBucket } from "../storage/call-repository";
import {
  calculateProviderUsageCost,
  openAIPublicPricingVersion
} from "./provider-pricing-policy";

describe("provider pricing policy", () => {
  it("prices compiler text tokens without charging cached input twice", () => {
    expect(calculateProviderUsageCost(bucket({
      model: "gpt-5.6-2026-08-01",
      operationType: "brief_compilation",
      stage: "compilation",
      inputTextTokens: 1_000_000,
      inputTextTokenSamples: 1,
      cachedInputTextTokens: 250_000,
      cachedInputTextTokenSamples: 1,
      outputTextTokens: 100_000,
      outputTextTokenSamples: 1
    }))).toMatchObject({
      pricingVersion: openAIPublicPricingVersion,
      matched: true,
      textUsdMicros: 5_100_000,
      calculatedUsdMicros: 5_100_000,
      unpricedMetrics: []
    });
  });

  it("splits Realtime text and audio token cost", () => {
    expect(calculateProviderUsageCost(bucket({
      model: "gpt-realtime-2.1",
      operationType: "realtime_response",
      stage: "conversation",
      inputTextTokens: 100,
      inputTextTokenSamples: 1,
      outputTextTokens: 50,
      outputTextTokenSamples: 1,
      inputAudioTokens: 200,
      inputAudioTokenSamples: 1,
      outputAudioTokens: 75,
      outputAudioTokenSamples: 1
    }))).toMatchObject({
      matched: true,
      textUsdMicros: 1_600,
      audioUsdMicros: 11_200,
      calculatedUsdMicros: 12_800
    });
  });

  it("prices duration models and refuses unknown SKUs", () => {
    expect(calculateProviderUsageCost(bucket({
      model: "gpt-transcribe",
      operationType: "transcription",
      stage: "full_recording",
      durationSeconds: 90,
      durationSamples: 1
    }))).toMatchObject({
      matched: true,
      durationUsdMicros: 6_750,
      calculatedUsdMicros: 6_750
    });
    expect(calculateProviderUsageCost(bucket({
      model: "gpt-realtime-future",
      operationType: "realtime_response",
      stage: "conversation",
      inputTextTokens: 100,
      inputTextTokenSamples: 1
    }))).toMatchObject({
      matched: false,
      calculatedUsdMicros: null
    });
  });

  it("marks a known token model partial when a returned metric has no rate", () => {
    expect(calculateProviderUsageCost(bucket({
      model: "gpt-4o-transcribe",
      operationType: "transcription",
      stage: "assistant_utterance",
      inputTextTokens: 10,
      inputTextTokenSamples: 1,
      inputAudioTokens: 100,
      inputAudioTokenSamples: 1,
      outputTextTokens: 20,
      outputTextTokenSamples: 1
    }))).toMatchObject({
      matched: true,
      calculatedUsdMicros: 450,
      unpricedMetrics: ["input_text_tokens"]
    });
  });
});

function bucket(
  overrides: Partial<AdminProviderUsageBucket>
): AdminProviderUsageBucket {
  return {
    provider: "openai",
    operationType: "brief_compilation",
    stage: "compilation",
    model: "gpt-5.6",
    usageRecords: 1,
    requestCount: 1,
    inputTextTokens: 0,
    inputTextTokenSamples: 0,
    cachedInputTextTokens: 0,
    cachedInputTextTokenSamples: 0,
    cacheWriteInputTextTokens: 0,
    cacheWriteInputTextTokenSamples: 0,
    outputTextTokens: 0,
    outputTextTokenSamples: 0,
    reasoningOutputTokens: 0,
    reasoningOutputTokenSamples: 0,
    inputAudioTokens: 0,
    inputAudioTokenSamples: 0,
    cachedInputAudioTokens: 0,
    cachedInputAudioTokenSamples: 0,
    outputAudioTokens: 0,
    outputAudioTokenSamples: 0,
    totalTokens: 0,
    totalTokenSamples: 0,
    durationSeconds: 0,
    durationSamples: 0,
    billableSeconds: 0,
    billableSamples: 0,
    ...overrides
  };
}
