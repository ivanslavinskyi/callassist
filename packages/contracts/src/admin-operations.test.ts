import { describe, expect, it } from "vitest";
import {
  adminOperationsOverviewSchema,
  adminOperationsWindowBounds,
  adminDurableJobRetryInputSchema,
  adminOutboundCallControlInputSchema,
  adminRateLimitStatusSchema,
  adminSystemStatusSchema
} from "./admin-operations";

describe("admin operations contracts", () => {
  it("uses deterministic rolling-window bounds", () => {
    expect(adminOperationsWindowBounds(
      "7d",
      new Date("2026-08-22T12:00:00.000Z")
    )).toEqual({
      from: "2026-08-15T12:00:00.000Z",
      to: "2026-08-22T12:00:00.000Z"
    });
  });

  it("represents missing measurements and pricing explicitly", () => {
    const overview = adminOperationsOverviewSchema.parse({
      generatedAt: "2026-08-22T12:00:00.000Z",
      window: {
        kind: "24h",
        from: "2026-08-21T12:00:00.000Z",
        to: "2026-08-22T12:00:00.000Z",
        cohort: "call_created_at"
      },
      volume: {
        createdCalls: 0,
        attemptedCalls: 0,
        activeCalls: 0,
        terminalCalls: 0,
        connectedCalls: 0,
        consentGrantedCalls: 0,
        consentFailedCalls: 0,
        technicalFailureCalls: 0,
        feedbackResponses: 0
      },
      rates: Object.fromEntries([
        "connection",
        "consent",
        "technicalFailure",
        "feedback",
        "resolved"
      ].map((key) => [key, { numerator: 0, denominator: 0, value: null }])),
      semanticOutcomes: {
        resolved: 0,
        partiallyResolved: 0,
        unresolved: 0,
        wrongRecipient: 0,
        voicemail: 0,
        declined: 0,
        technicalFailure: 0,
        unclassified: 0
      },
      recordedDurationSeconds: {
        status: "no_samples",
        samples: 0,
        total: 0,
        average: null,
        p95: null
      },
      firstAudioLatencyMs: {
        status: "no_samples",
        samples: 0,
        total: 0,
        average: null,
        p95: null
      },
      reliability: {
        transcriptionRetries: 0,
        realtimeDisconnects: 0,
        recoveries: 0,
        realtimeReconnects: { status: "not_supported", count: null }
      },
      cost: {
        status: "unavailable",
        currency: "USD",
        pricingVersion: null,
        estimatedUsdMicros: null,
        components: {
          telephony: {
            usageSeconds: 0,
            rateUsdMicrosPerMinute: null,
            estimatedUsdMicros: null
          },
          realtime: {
            usageSeconds: 0,
            rateUsdMicrosPerMinute: null,
            estimatedUsdMicros: null
          },
          transcription: {
            usageSeconds: 0,
            rateUsdMicrosPerMinute: null,
            estimatedUsdMicros: null
          }
        },
        providerUsage: {
          status: "unavailable",
          cohort: "usage_observed_at",
          from: "2026-08-21T12:00:00.000Z",
          to: "2026-08-22T12:00:00.000Z",
          pricingVersion: "openai-public-2026-09-05",
          operationCount: 0,
          usageRecordCount: 0,
          unpricedBuckets: 0,
          calculatedUsdMicros: null,
          components: Object.fromEntries([
            "briefCompilation",
            "realtimeText",
            "realtimeAudio",
            "realtimeTranscription",
            "postCallTranscription",
            "telephony"
          ].map((key) => [key, {
            usageRecords: 0,
            requests: 0,
            models: [],
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
            calculatedUsdMicros: null
          }]))
        },
        providerReported: {
          status: "unavailable",
          cohort: "cost_observed_at",
          from: "2026-08-21T12:00:00.000Z",
          to: "2026-08-22T12:00:00.000Z",
          recordCount: 0,
          usdMicros: null,
          amounts: []
        }
      }
    });
    expect(overview.rates.connection.value).toBeNull();
    expect(overview.cost.status).toBe("unavailable");
  });

  it("keeps system state bounded and requires reasoned control changes", () => {
    expect(adminSystemStatusSchema.safeParse({
      generatedAt: "2026-08-22T12:00:00.000Z",
      components: {
        api: { state: "healthy" },
        database: { state: "healthy" },
        telephony: {
          state: "development",
          mode: "mock",
          upstreamChecked: false
        },
        realtime: { state: "disabled", upstreamChecked: false },
        transcription: { state: "disabled", upstreamChecked: false }
      },
      outboundCalls: {
        enabled: true,
        reason: "Initial public-beta default",
        updatedAt: null
      },
      runtime: {
        uptimeSeconds: 10,
        backgroundTasks: 0,
        processingRecordings: 0,
        durableWorkerEnabled: false,
        durableWorkerMode: "external",
        externalWorker: {
          state: "offline",
          healthyInstances: 0,
          staleInstances: 0,
          activeJobs: 0,
          lastSeenAt: null,
          lastSeenAgeSeconds: null
        }
      },
      workload: {
        activeCalls: 0,
        recordingsProcessing: 0,
        transcriptionReady: 0,
        transcriptionProcessing: 0,
        transcriptionFailed: 0,
        retentionScheduled: 0,
        retentionOverdue: 0
      },
      callPlanCutover: {
        recoverableLegacyCalls: 0,
        unavailableLegacyCalls: 0,
        historicalAttemptsWithoutCompilation: 0,
        historicalAttemptsWithoutExecutionSnapshot: 0,
        activeLegacyAttempts: 0,
        activeRecompilations: 0,
        mutableCompilationReadRemovalReady: true,
        legacyMediaAdapterRemovalReady: true
      },
      jobs: {
        queued: 0,
        running: 0,
        succeeded: 0,
        deadLetter: 0,
        retryQueued: 0,
        briefCompilationQueued: 0,
        transcriptionQueued: 0,
        retentionQueued: 0,
        providerReconciliationQueued: 0,
        oldestDueAt: null,
        recent: []
      },
      webhooks: {
        since: "2026-08-21T12:00:00.000Z",
        retentionDays: 30,
        voice: {
          accepted: 0,
          rejected: 0,
          unmatched: 0,
          failed: 0,
          lastAcceptedAt: null,
          lastAcceptedAgeSeconds: null,
          lastProblemAt: null,
          lastProblemCode: null
        },
        callStatus: {
          accepted: 0,
          rejected: 0,
          unmatched: 0,
          failed: 0,
          lastAcceptedAt: null,
          lastAcceptedAgeSeconds: null,
          lastProblemAt: null,
          lastProblemCode: null
        },
        recordingStatus: {
          accepted: 0,
          rejected: 0,
          unmatched: 0,
          failed: 0,
          lastAcceptedAt: null,
          lastAcceptedAgeSeconds: null,
          lastProblemAt: null,
          lastProblemCode: null
        }
      },
      recentTelemetry: {
        since: "2026-08-21T12:00:00.000Z",
        warnings: 0,
        errors: 0
      },
      alerts: {
        policyVersion: "2026-08-22",
        active: []
      }
    }).success).toBe(true);
    expect(adminOutboundCallControlInputSchema.safeParse({
      enabled: false,
      reason: "Investigating provider failures"
    }).success).toBe(true);
    expect(adminOutboundCallControlInputSchema.safeParse({
      enabled: true,
      reason: "x"
    }).success).toBe(false);
    expect(adminDurableJobRetryInputSchema.safeParse({
      reason: "Retry after provider recovery"
    }).success).toBe(true);
  });

  it("exposes only bounded aggregate rate-limit telemetry", () => {
    expect(adminRateLimitStatusSchema.parse({
      state: "healthy",
      mode: "postgres",
      shared: true,
      activeBuckets: 42,
      metricsSince: "2026-08-22T12:00:00.000Z",
      allowed: 100,
      denied: 3,
      topDeniedScopes: [{ scope: "auth:login:ip", denied: 3 }]
    })).toEqual(expect.objectContaining({
      shared: true,
      denied: 3
    }));
    expect(adminRateLimitStatusSchema.safeParse({
      state: "healthy",
      mode: "postgres",
      shared: true,
      activeBuckets: 1,
      metricsSince: null,
      allowed: 1,
      denied: 0,
      topDeniedScopes: [],
      identifier: "private@example.com"
    }).success).toBe(false);
  });
});
