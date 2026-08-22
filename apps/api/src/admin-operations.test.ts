import { describe, expect, it } from "vitest";
import { buildAdminOperationsOverview } from "./admin-operations";
import { unavailableOperationalCostPolicy } from "./config/operational-cost-policy";
import type { AdminOperationsFacts } from "./storage/call-repository";

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
});
