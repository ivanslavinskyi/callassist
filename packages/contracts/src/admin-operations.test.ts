import { describe, expect, it } from "vitest";
import {
  adminOperationsOverviewSchema,
  adminOperationsWindowBounds,
  adminOutboundCallControlInputSchema,
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
        retentionLoopEnabled: false
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
      recentTelemetry: {
        since: "2026-08-21T12:00:00.000Z",
        warnings: 0,
        errors: 0
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
  });
});
