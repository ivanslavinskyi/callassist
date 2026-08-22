import { z } from "zod";

export const adminOperationsWindowSchema = z.enum(["24h", "7d", "30d"]);
export type AdminOperationsWindow = z.infer<
  typeof adminOperationsWindowSchema
>;

const countSchema = z.number().int().nonnegative();
const secondsSchema = z.number().int().nonnegative();
const metricAvailabilitySchema = z.enum([
  "measured",
  "no_samples",
  "not_supported"
]);

export const adminMetricRatioSchema = z.strictObject({
  numerator: countSchema,
  denominator: countSchema,
  value: z.number().min(0).max(1).nullable()
});
export type AdminMetricRatio = z.infer<typeof adminMetricRatioSchema>;

const aggregateSchema = z.strictObject({
  status: metricAvailabilitySchema.exclude(["not_supported"]),
  samples: countSchema,
  total: z.number().nonnegative(),
  average: z.number().nonnegative().nullable(),
  p95: z.number().nonnegative().nullable()
});

const costComponentSchema = z.strictObject({
  usageSeconds: secondsSchema,
  rateUsdMicrosPerMinute: countSchema.nullable(),
  estimatedUsdMicros: countSchema.nullable()
});

export const adminOperationsOverviewSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  window: z.strictObject({
    kind: adminOperationsWindowSchema,
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    cohort: z.literal("call_created_at")
  }),
  volume: z.strictObject({
    createdCalls: countSchema,
    attemptedCalls: countSchema,
    activeCalls: countSchema,
    terminalCalls: countSchema,
    connectedCalls: countSchema,
    consentGrantedCalls: countSchema,
    consentFailedCalls: countSchema,
    technicalFailureCalls: countSchema,
    feedbackResponses: countSchema
  }),
  rates: z.strictObject({
    connection: adminMetricRatioSchema,
    consent: adminMetricRatioSchema,
    technicalFailure: adminMetricRatioSchema,
    feedback: adminMetricRatioSchema,
    resolved: adminMetricRatioSchema
  }),
  semanticOutcomes: z.strictObject({
    resolved: countSchema,
    partiallyResolved: countSchema,
    unresolved: countSchema,
    wrongRecipient: countSchema,
    voicemail: countSchema,
    declined: countSchema,
    technicalFailure: countSchema,
    unclassified: countSchema
  }),
  recordedDurationSeconds: aggregateSchema,
  firstAudioLatencyMs: aggregateSchema,
  reliability: z.strictObject({
    transcriptionRetries: countSchema,
    realtimeDisconnects: countSchema,
    recoveries: countSchema,
    realtimeReconnects: z.strictObject({
      status: z.literal("not_supported"),
      count: z.null()
    })
  }),
  cost: z.strictObject({
    status: z.enum(["unavailable", "partial", "estimated"]),
    currency: z.literal("USD"),
    pricingVersion: z.string().trim().min(1).max(80).nullable(),
    estimatedUsdMicros: countSchema.nullable(),
    components: z.strictObject({
      telephony: costComponentSchema,
      realtime: costComponentSchema,
      transcription: costComponentSchema
    })
  })
});
export type AdminOperationsOverview = z.infer<
  typeof adminOperationsOverviewSchema
>;

const systemComponentStateSchema = z.enum([
  "healthy",
  "configured",
  "development",
  "disabled"
]);

export const adminSystemStatusSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  components: z.strictObject({
    api: z.strictObject({ state: z.literal("healthy") }),
    database: z.strictObject({ state: z.literal("healthy") }),
    telephony: z.strictObject({
      state: systemComponentStateSchema,
      mode: z.enum(["mock", "twilio"]),
      upstreamChecked: z.literal(false)
    }),
    realtime: z.strictObject({
      state: z.enum(["configured", "disabled"]),
      upstreamChecked: z.literal(false)
    }),
    transcription: z.strictObject({
      state: z.enum(["configured", "disabled"]),
      upstreamChecked: z.literal(false)
    })
  }),
  outboundCalls: z.strictObject({
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(500),
    updatedAt: z.iso.datetime().nullable()
  }),
  runtime: z.strictObject({
    uptimeSeconds: secondsSchema,
    backgroundTasks: countSchema,
    processingRecordings: countSchema,
    retentionLoopEnabled: z.boolean()
  }),
  workload: z.strictObject({
    activeCalls: countSchema,
    recordingsProcessing: countSchema,
    transcriptionReady: countSchema,
    transcriptionProcessing: countSchema,
    transcriptionFailed: countSchema,
    retentionScheduled: countSchema,
    retentionOverdue: countSchema
  }),
  recentTelemetry: z.strictObject({
    since: z.iso.datetime(),
    warnings: countSchema,
    errors: countSchema
  })
});
export type AdminSystemStatus = z.infer<typeof adminSystemStatusSchema>;

export const adminOutboundCallControlInputSchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500)
});
export type AdminOutboundCallControlInput = z.infer<
  typeof adminOutboundCallControlInputSchema
>;

export function adminOperationsWindowBounds(
  kind: AdminOperationsWindow,
  now: Date
) {
  const durationMs = kind === "24h"
    ? 24 * 60 * 60 * 1_000
    : kind === "7d"
      ? 7 * 24 * 60 * 60 * 1_000
      : 30 * 24 * 60 * 60 * 1_000;
  return {
    from: new Date(now.getTime() - durationMs).toISOString(),
    to: now.toISOString()
  };
}
