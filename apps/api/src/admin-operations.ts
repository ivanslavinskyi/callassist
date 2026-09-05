import {
  adminOperationsOverviewSchema,
  type AdminMetricRatio,
  type AdminOperationsOverview,
  type AdminOperationsWindow
} from "@callassist/contracts";
import type { OperationalCostPolicy } from "./config/operational-cost-policy";
import {
  calculateProviderUsageCost,
  openAIPublicPricingVersion
} from "./config/provider-pricing-policy";
import type {
  AdminOperationsFacts,
  AdminProviderUsageBucket
} from "./storage/call-repository";

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
    cost: buildAdminCostOverview(facts, input.costPolicy)
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

export function buildAdminCostOverview(
  facts: Pick<
    AdminOperationsFacts,
    "usageSeconds" | "providerUsage" | "providerCosts"
  >,
  policy: OperationalCostPolicy
) {
  const usage = facts.usageSeconds;
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
    components,
    providerUsage: buildProviderUsageCost(facts.providerUsage),
    providerReported: buildProviderReportedCost(facts.providerCosts)
  };
}

function buildProviderReportedCost(
  costs: AdminOperationsFacts["providerCosts"]
) {
  const amounts = costs.buckets.slice(0, 100);
  const usd = costs.buckets.filter(({ currency }) => currency === "USD");
  return {
    status: costs.recordCount === 0
      ? "unavailable" as const
      : "reported" as const,
    cohort: "cost_observed_at" as const,
    from: costs.incurredFrom,
    to: costs.incurredTo,
    recordCount: costs.recordCount,
    usdMicros: usd.length === 0
      ? null
      : usd.reduce((total, bucket) => total + bucket.amountMicros, 0),
    amounts
  };
}

type ProviderUsageCostComponent = {
  usageRecords: number;
  requests: number;
  models: string[];
  inputTextTokens: number;
  inputTextTokenSamples: number;
  cachedInputTextTokens: number;
  cachedInputTextTokenSamples: number;
  cacheWriteInputTextTokens: number;
  cacheWriteInputTextTokenSamples: number;
  outputTextTokens: number;
  outputTextTokenSamples: number;
  reasoningOutputTokens: number;
  reasoningOutputTokenSamples: number;
  inputAudioTokens: number;
  inputAudioTokenSamples: number;
  cachedInputAudioTokens: number;
  cachedInputAudioTokenSamples: number;
  outputAudioTokens: number;
  outputAudioTokenSamples: number;
  totalTokens: number;
  totalTokenSamples: number;
  durationSeconds: number;
  durationSamples: number;
  billableSeconds: number;
  billableSamples: number;
  calculatedUsdMicros: number | null;
};

function buildProviderUsageCost(
  usage: AdminOperationsFacts["providerUsage"]
) {
  const components = {
    briefCompilation: emptyProviderUsageCostComponent(),
    realtimeText: emptyProviderUsageCostComponent(),
    realtimeAudio: emptyProviderUsageCostComponent(),
    realtimeTranscription: emptyProviderUsageCostComponent(),
    postCallTranscription: emptyProviderUsageCostComponent(),
    telephony: emptyProviderUsageCostComponent()
  };
  let relevantBuckets = 0;
  let unpricedBuckets = 0;
  for (const bucket of usage.buckets) {
    const destinations = providerUsageDestinations(bucket);
    if (destinations.length === 0) continue;
    relevantBuckets += 1;
    const cost = calculateProviderUsageCost(bucket);
    if (
      !cost.matched ||
      cost.calculatedUsdMicros === null ||
      cost.unpricedMetrics.length > 0
    ) {
      unpricedBuckets += 1;
    }
    for (const destination of destinations) {
      const component = components[destination.name];
      addProviderUsage(component, bucket);
      const amount = destination.cost(cost);
      if (amount !== null) {
        component.calculatedUsdMicros =
          (component.calculatedUsdMicros ?? 0) + amount;
      }
    }
  }
  for (const component of Object.values(components)) {
    component.models.sort();
    component.models = component.models.slice(0, 50);
  }
  const amounts = Object.values(components)
    .map(({ calculatedUsdMicros }) => calculatedUsdMicros)
    .filter((value): value is number => value !== null);
  return {
    status: relevantBuckets === 0
      ? "unavailable" as const
      : unpricedBuckets > 0
        ? "partial" as const
        : "calculated" as const,
    cohort: "usage_observed_at" as const,
    from: usage.incurredFrom,
    to: usage.incurredTo,
    pricingVersion: openAIPublicPricingVersion,
    operationCount: usage.operationCount,
    usageRecordCount: usage.usageRecordCount,
    unpricedBuckets,
    calculatedUsdMicros: amounts.length === 0
      ? null
      : amounts.reduce((total, amount) => total + amount, 0),
    components
  };
}

function providerUsageDestinations(bucket: AdminProviderUsageBucket) {
  if (bucket.operationType === "telephony_leg") {
    return [{
      name: "telephony" as const,
      cost: (_value: ReturnType<typeof calculateProviderUsageCost>) => null
    }];
  }
  if (bucket.operationType === "brief_compilation") {
    return [{
      name: "briefCompilation" as const,
      cost: (value: ReturnType<typeof calculateProviderUsageCost>) =>
        value.calculatedUsdMicros
    }];
  }
  if (bucket.operationType === "realtime_response") {
    const destinations: Array<{
      name: "realtimeText" | "realtimeAudio";
      cost: (value: ReturnType<typeof calculateProviderUsageCost>) =>
        number | null;
    }> = [];
    if (
      bucket.inputTextTokenSamples > 0 ||
      bucket.cachedInputTextTokenSamples > 0 ||
      bucket.outputTextTokenSamples > 0
    ) {
      destinations.push({
        name: "realtimeText",
        cost: (value) => value.textUsdMicros
      });
    }
    if (
      bucket.inputAudioTokenSamples > 0 ||
      bucket.cachedInputAudioTokenSamples > 0 ||
      bucket.outputAudioTokenSamples > 0
    ) {
      destinations.push({
        name: "realtimeAudio",
        cost: (value) => value.audioUsdMicros
      });
    }
    if (destinations.length === 0) {
      destinations.push({
        name: "realtimeText",
        cost: (value) => value.calculatedUsdMicros
      });
    }
    return destinations;
  }
  if (bucket.operationType !== "transcription") return [];
  const isRealtime = [
    "conversation_input_audio",
    "consent_input_audio"
  ].includes(bucket.stage);
  return [{
    name: isRealtime
      ? "realtimeTranscription" as const
      : "postCallTranscription" as const,
    cost: (value: ReturnType<typeof calculateProviderUsageCost>) =>
      value.calculatedUsdMicros
  }];
}

function emptyProviderUsageCostComponent(): ProviderUsageCostComponent {
  return {
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
  };
}

function addProviderUsage(
  component: ProviderUsageCostComponent,
  bucket: AdminProviderUsageBucket
) {
  component.usageRecords += bucket.usageRecords;
  component.requests += bucket.requestCount;
  if (!component.models.includes(bucket.model)) {
    component.models.push(bucket.model);
  }
  component.inputTextTokens += bucket.inputTextTokens;
  component.inputTextTokenSamples += bucket.inputTextTokenSamples;
  component.cachedInputTextTokens += bucket.cachedInputTextTokens;
  component.cachedInputTextTokenSamples += bucket.cachedInputTextTokenSamples;
  component.cacheWriteInputTextTokens += bucket.cacheWriteInputTextTokens;
  component.cacheWriteInputTextTokenSamples +=
    bucket.cacheWriteInputTextTokenSamples;
  component.outputTextTokens += bucket.outputTextTokens;
  component.outputTextTokenSamples += bucket.outputTextTokenSamples;
  component.reasoningOutputTokens += bucket.reasoningOutputTokens;
  component.reasoningOutputTokenSamples += bucket.reasoningOutputTokenSamples;
  component.inputAudioTokens += bucket.inputAudioTokens;
  component.inputAudioTokenSamples += bucket.inputAudioTokenSamples;
  component.cachedInputAudioTokens += bucket.cachedInputAudioTokens;
  component.cachedInputAudioTokenSamples +=
    bucket.cachedInputAudioTokenSamples;
  component.outputAudioTokens += bucket.outputAudioTokens;
  component.outputAudioTokenSamples += bucket.outputAudioTokenSamples;
  component.totalTokens += bucket.totalTokens;
  component.totalTokenSamples += bucket.totalTokenSamples;
  component.durationSeconds += bucket.durationSeconds;
  component.durationSamples += bucket.durationSamples;
  component.billableSeconds += bucket.billableSeconds;
  component.billableSamples += bucket.billableSamples;
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
