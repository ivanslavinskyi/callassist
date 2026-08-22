import {
  adminOperationsOverviewSchema,
  type AdminMetricRatio,
  type AdminOperationsOverview,
  type AdminOperationsWindow
} from "@callassist/contracts";
import type { OperationalCostPolicy } from "./config/operational-cost-policy";
import type { AdminOperationsFacts } from "./storage/call-repository";

export function buildAdminOperationsOverview(input: {
  facts: AdminOperationsFacts;
  kind: AdminOperationsWindow;
  from: string;
  to: string;
  costPolicy: OperationalCostPolicy;
}): AdminOperationsOverview {
  const { facts } = input;
  const classifiedCalls = Object.entries(facts.semanticOutcomes)
    .filter(([key]) => key !== "unclassified")
    .reduce((total, [, value]) => total + value, 0);
  return adminOperationsOverviewSchema.parse({
    generatedAt: input.to,
    window: {
      kind: input.kind,
      from: input.from,
      to: input.to,
      cohort: "call_created_at"
    },
    volume: {
      createdCalls: facts.createdCalls,
      attemptedCalls: facts.attemptedCalls,
      activeCalls: facts.activeCalls,
      terminalCalls: facts.terminalCalls,
      connectedCalls: facts.connectedCalls,
      consentGrantedCalls: facts.consentGrantedCalls,
      consentFailedCalls: facts.consentFailedCalls,
      technicalFailureCalls: facts.technicalFailureCalls,
      feedbackResponses: facts.feedbackResponses
    },
    rates: {
      connection: ratio(facts.connectedCalls, facts.attemptedCalls),
      consent: ratio(facts.consentGrantedCalls, facts.connectedCalls),
      technicalFailure: ratio(
        facts.technicalFailureCalls,
        facts.terminalCalls
      ),
      feedback: ratio(facts.feedbackResponses, facts.terminalCalls),
      resolved: ratio(facts.semanticOutcomes.resolved, classifiedCalls)
    },
    semanticOutcomes: facts.semanticOutcomes,
    recordedDurationSeconds: withAvailability(
      facts.recordedDurationSeconds
    ),
    firstAudioLatencyMs: withAvailability(facts.firstAudioLatencyMs),
    reliability: {
      transcriptionRetries: facts.transcriptionRetries,
      realtimeDisconnects: facts.realtimeDisconnects,
      recoveries: facts.recoveries,
      realtimeReconnects: { status: "not_supported", count: null }
    },
    cost: buildCost(facts.usageSeconds, input.costPolicy)
  });
}

function ratio(numerator: number, denominator: number): AdminMetricRatio {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator
  };
}

function withAvailability(
  facts: AdminOperationsFacts["recordedDurationSeconds"]
) {
  return {
    status: facts.samples === 0 ? "no_samples" as const : "measured" as const,
    ...facts
  };
}

function buildCost(
  usage: AdminOperationsFacts["usageSeconds"],
  policy: OperationalCostPolicy
) {
  const components = {
    telephony: costComponent(
      usage.telephony,
      policy.telephonyUsdMicrosPerMinute
    ),
    realtime: costComponent(
      usage.realtime,
      policy.realtimeUsdMicrosPerMinute
    ),
    transcription: costComponent(
      usage.transcription,
      policy.transcriptionUsdMicrosPerMinute
    )
  };
  const estimates = Object.values(components)
    .map(({ estimatedUsdMicros }) => estimatedUsdMicros)
    .filter((value): value is number => value !== null);
  const configuredRates = Object.values(components)
    .filter(({ rateUsdMicrosPerMinute }) =>
      rateUsdMicrosPerMinute !== null
    ).length;
  return {
    status: configuredRates === 0
      ? "unavailable" as const
      : configuredRates === Object.keys(components).length
        ? "estimated" as const
        : "partial" as const,
    currency: "USD" as const,
    pricingVersion: policy.pricingVersion,
    estimatedUsdMicros: estimates.length === 0
      ? null
      : estimates.reduce((total, value) => total + value, 0),
    components
  };
}

function costComponent(usageSeconds: number, rate: number | null) {
  return {
    usageSeconds,
    rateUsdMicrosPerMinute: rate,
    estimatedUsdMicros: rate === null
      ? null
      : Math.ceil((usageSeconds * rate) / 60)
  };
}
