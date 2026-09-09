import { describe, expect, it } from "vitest";
import { buildAdminOperationsOverview } from "./admin-operations";
import { unavailableOperationalCostPolicy } from "./config/operational-cost-policy";
import type {
  AdminOperationsFacts,
  AdminProviderUsageBucket
} from "./storage/call-repository";

const facts: AdminOperationsFacts = {
  createdCalls: 4,
  attemptedCalls: 3,
  activeCalls: 0,
  terminalCalls: 3,
  connectedCalls: 2,
  consentGrantedCalls: 1,
  consentFailedCalls: 1,
  technicalFailureCalls: 1,
  feedbackResponses: 2,
  semanticOutcomes: {
    resolved: 1,
    partiallyResolved: 1,
    unresolved: 0,
    wrongRecipient: 0,
    voicemail: 0,
    declined: 0,
    technicalFailure: 1,
    unclassified: 1
  },
  recordedDurationSeconds: {
    samples: 2,
    total: 180,
    average: 90,
    p95: 117
  },
  firstAudioLatencyMs: {
    samples: 1,
    total: 420,
    average: 420,
    p95: 420
  },
  transcriptionRetries: 1,
  realtimeDisconnects: 1,
  recoveries: 0,
  usageSeconds: {
    telephony: 240,
    realtime: 180,
    transcription: 120
  },
  providerUsage: {
    incurredFrom: "2026-08-21T12:00:00.000Z",
    incurredTo: "2026-08-22T12:00:00.000Z",
    operationCount: 0,
    usageRecordCount: 0,
    buckets: []
  },
  providerCosts: {
    incurredFrom: "2026-08-21T12:00:00.000Z",
    incurredTo: "2026-08-22T12:00:00.000Z",
    recordCount: 0,
    buckets: []
  }
};

describe("admin operations overview", () => {
  it("uses explicit denominators and leaves unavailable cost empty", () => {
    const overview = buildAdminOperationsOverview({
      facts,
      kind: "24h",
      from: "2026-08-21T12:00:00.000Z",
      to: "2026-08-22T12:00:00.000Z",
      costPolicy: unavailableOperationalCostPolicy
    });
    expect(overview.rates.connection).toEqual({
      numerator: 2,
      denominator: 3,
      value: 2 / 3
    });
    expect(overview.rates.resolved).toEqual({
      numerator: 1,
      denominator: 3,
      value: 1 / 3
    });
    expect(overview.cost).toMatchObject({
      status: "unavailable",
      estimatedUsdMicros: null
    });
  });

  it("calculates versioned estimates in integer micro-dollars", () => {
    const overview = buildAdminOperationsOverview({
      facts,
      kind: "7d",
      from: "2026-08-15T12:00:00.000Z",
      to: "2026-08-22T12:00:00.000Z",
      costPolicy: {
        pricingVersion: "test-v1",
        telephonyUsdMicrosPerMinute: 10_000,
        realtimeUsdMicrosPerMinute: 20_000,
        transcriptionUsdMicrosPerMinute: 6_000
      }
    });
    expect(overview.cost).toMatchObject({
      status: "estimated",
      pricingVersion: "test-v1",
      estimatedUsdMicros: 112_000,
      components: {
        telephony: { estimatedUsdMicros: 40_000 },
        realtime: { estimatedUsdMicros: 60_000 },
        transcription: { estimatedUsdMicros: 12_000 }
      }
    });
  });

  it("calculates model-priced cost from immutable provider usage", () => {
    const overview = buildAdminOperationsOverview({
      facts: {
        ...facts,
        providerUsage: {
          incurredFrom: "2026-08-15T12:00:00.000Z",
          incurredTo: "2026-08-22T12:00:00.000Z",
          operationCount: 4,
          usageRecordCount: 3,
          buckets: [
            providerBucket({
              model: "gpt-5.6",
              inputTextTokens: 1_000,
              inputTextTokenSamples: 1,
              cachedInputTextTokens: 200,
              cachedInputTextTokenSamples: 1,
              outputTextTokens: 100,
              outputTextTokenSamples: 1
            }),
            providerBucket({
              operationType: "realtime_response",
              stage: "conversation",
              model: "gpt-realtime-2.1",
              inputAudioTokens: 500,
              inputAudioTokenSamples: 1,
              outputAudioTokens: 100,
              outputAudioTokenSamples: 1
            }),
            providerBucket({
              operationType: "transcription",
              stage: "full_recording",
              model: "gpt-transcribe",
              durationSeconds: 120,
              durationSamples: 1
            })
          ]
        }
      },
      kind: "7d",
      from: "2026-08-15T12:00:00.000Z",
      to: "2026-08-22T12:00:00.000Z",
      costPolicy: unavailableOperationalCostPolicy
    });
    expect(overview.cost.providerUsage).toMatchObject({
      status: "calculated",
      operationCount: 4,
      usageRecordCount: 3,
      unpricedBuckets: 0,
      calculatedUsdMicros: 36_680,
      components: {
        briefCompilation: {
          calculatedUsdMicros: 5_280,
          inputTextTokens: 1_000,
          cachedInputTextTokens: 200
        },
        realtimeAudio: {
          calculatedUsdMicros: 22_400,
          inputAudioTokens: 500,
          outputAudioTokens: 100
        },
        postCallTranscription: {
          calculatedUsdMicros: 9_000,
          durationSeconds: 120
        }
      }
    });
  });

  it("counts translation and summary usage in the same priced provider total", () => {
    const overview = buildAdminOperationsOverview({ facts: { ...facts, providerUsage: {
      ...facts.providerUsage, operationCount: 2, usageRecordCount: 2,
      buckets: ["text_translation", "call_summary"].map((operationType) => providerBucket({
        operationType, inputTextTokens: 1000, inputTextTokenSamples: 1, outputTextTokens: 100, outputTextTokenSamples: 1
      }))
    } }, kind: "7d", from: "2026-08-15T12:00:00.000Z", to: "2026-08-22T12:00:00.000Z", costPolicy: unavailableOperationalCostPolicy });
    expect(overview.cost.providerUsage).toMatchObject({ calculatedUsdMicros: 12000, components: {
      textTranslation: { requests: 1, calculatedUsdMicros: 6000 }, callSummary: { requests: 1, calculatedUsdMicros: 6000 }
    } });
  });

  it("keeps provider-reported actual cost separate and currency-safe", () => {
    const overview = buildAdminOperationsOverview({
      facts: {
        ...facts,
        providerCosts: {
          incurredFrom: "2026-08-15T12:00:00.000Z",
          incurredTo: "2026-08-22T12:00:00.000Z",
          recordCount: 2,
          buckets: [
            {
              provider: "twilio",
              costBasis: "provider_reported_actual",
              component: "connectivity",
              currency: "USD",
              records: 1,
              amountMicros: 13_700
            },
            {
              provider: "twilio",
              costBasis: "provider_reported_actual",
              component: "connectivity",
              currency: "CHF",
              records: 1,
              amountMicros: 12_100
            }
          ]
        }
      },
      kind: "7d",
      from: "2026-08-15T12:00:00.000Z",
      to: "2026-08-22T12:00:00.000Z",
      costPolicy: unavailableOperationalCostPolicy
    });
    expect(overview.cost.providerReported).toEqual({
      status: "reported",
      cohort: "cost_observed_at",
      from: "2026-08-15T12:00:00.000Z",
      to: "2026-08-22T12:00:00.000Z",
      recordCount: 2,
      usdMicros: 13_700,
      amounts: factsWithProviderCosts()
    });
  });
});

function factsWithProviderCosts() {
  return [
    {
      provider: "twilio",
      costBasis: "provider_reported_actual" as const,
      component: "connectivity",
      currency: "USD",
      records: 1,
      amountMicros: 13_700
    },
    {
      provider: "twilio",
      costBasis: "provider_reported_actual" as const,
      component: "connectivity",
      currency: "CHF",
      records: 1,
      amountMicros: 12_100
    }
  ];
}

function providerBucket(
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
