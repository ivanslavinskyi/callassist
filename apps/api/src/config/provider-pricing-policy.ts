import type { AdminProviderUsageBucket } from "../storage/call-repository";

export const openAIPublicPricingVersion = "openai-public-2026-09-05";

type TokenRates = {
  inputTextUsdMicrosPerMillion?: number;
  cachedInputTextUsdMicrosPerMillion?: number;
  cacheWriteInputTextUsdMicrosPerMillion?: number;
  outputTextUsdMicrosPerMillion?: number;
  inputAudioUsdMicrosPerMillion?: number;
  cachedInputAudioUsdMicrosPerMillion?: number;
  outputAudioUsdMicrosPerMillion?: number;
};

type ProviderRateCard = {
  provider: "openai";
  model: RegExp;
  billing: "tokens" | "duration";
  rates: TokenRates & { durationUsdMicrosPerMinute?: number };
};

export type ProviderUsageCost = {
  pricingVersion: string;
  matched: boolean;
  calculatedUsdMicros: number | null;
  textUsdMicros: number | null;
  audioUsdMicros: number | null;
  durationUsdMicros: number | null;
  unpricedMetrics: string[];
};

// Centralized public list-price assumptions. Updating a price requires a new
// version; business logic never embeds model rates.
const openAIPublicRateCards: ProviderRateCard[] = [
  {
    provider: "openai",
    model: /^gpt-5\.6(?:-sol)?(?:-\d{4}-\d{2}-\d{2})?$/,
    billing: "tokens",
    rates: {
      inputTextUsdMicrosPerMillion: 4_000_000,
      cachedInputTextUsdMicrosPerMillion: 400_000,
      cacheWriteInputTextUsdMicrosPerMillion: 5_000_000,
      outputTextUsdMicrosPerMillion: 20_000_000
    }
  },
  {
    provider: "openai",
    model: /^gpt-realtime-2\.1(?:-\d{4}-\d{2}-\d{2})?$/,
    billing: "tokens",
    rates: {
      inputTextUsdMicrosPerMillion: 4_000_000,
      cachedInputTextUsdMicrosPerMillion: 400_000,
      outputTextUsdMicrosPerMillion: 24_000_000,
      inputAudioUsdMicrosPerMillion: 32_000_000,
      cachedInputAudioUsdMicrosPerMillion: 400_000,
      outputAudioUsdMicrosPerMillion: 64_000_000
    }
  },
  {
    provider: "openai",
    model: /^gpt-realtime-whisper(?:-\d{4}-\d{2}-\d{2})?$/,
    billing: "duration",
    rates: { durationUsdMicrosPerMinute: 17_000 }
  },
  {
    provider: "openai",
    model: /^gpt-transcribe(?:-\d{4}-\d{2}-\d{2})?$/,
    billing: "duration",
    rates: { durationUsdMicrosPerMinute: 4_500 }
  },
  {
    provider: "openai",
    model: /^gpt-4o-transcribe(?:-\d{4}-\d{2}-\d{2})?$/,
    billing: "tokens",
    rates: {
      inputAudioUsdMicrosPerMillion: 2_500_000,
      outputTextUsdMicrosPerMillion: 10_000_000
    }
  }
];

export function calculateProviderUsageCost(
  usage: AdminProviderUsageBucket
): ProviderUsageCost {
  const card = openAIPublicRateCards.find((candidate) =>
    candidate.provider === usage.provider && candidate.model.test(usage.model)
  );
  if (!card) return unmatchedCost();
  if (card.billing === "duration") {
    if (usage.durationSamples === 0) {
      return {
        ...unmatchedCost(),
        matched: true,
        unpricedMetrics: ["duration_seconds"]
      };
    }
    const durationUsdMicros = perMinuteCost(
      usage.durationSeconds,
      card.rates.durationUsdMicrosPerMinute!
    );
    return {
      pricingVersion: openAIPublicPricingVersion,
      matched: true,
      calculatedUsdMicros: durationUsdMicros,
      textUsdMicros: null,
      audioUsdMicros: null,
      durationUsdMicros,
      unpricedMetrics: []
    };
  }

  const unpricedMetrics: string[] = [];
  const textCosts = [
    inputCost({
      total: usage.inputTextTokens,
      totalSamples: usage.inputTextTokenSamples,
      cached: usage.cachedInputTextTokens,
      cachedSamples: usage.cachedInputTextTokenSamples,
      cacheWrite: usage.cacheWriteInputTextTokens,
      cacheWriteSamples: usage.cacheWriteInputTextTokenSamples,
      regularRate: card.rates.inputTextUsdMicrosPerMillion,
      cachedRate: card.rates.cachedInputTextUsdMicrosPerMillion,
      cacheWriteRate: card.rates.cacheWriteInputTextUsdMicrosPerMillion,
      metric: "input_text_tokens",
      unpricedMetrics
    }),
    tokenCost(
      usage.outputTextTokens,
      usage.outputTextTokenSamples,
      card.rates.outputTextUsdMicrosPerMillion,
      "output_text_tokens",
      unpricedMetrics
    )
  ];
  const audioCosts = [
    inputCost({
      total: usage.inputAudioTokens,
      totalSamples: usage.inputAudioTokenSamples,
      cached: usage.cachedInputAudioTokens,
      cachedSamples: usage.cachedInputAudioTokenSamples,
      cacheWrite: 0,
      cacheWriteSamples: 0,
      regularRate: card.rates.inputAudioUsdMicrosPerMillion,
      cachedRate: card.rates.cachedInputAudioUsdMicrosPerMillion,
      metric: "input_audio_tokens",
      unpricedMetrics
    }),
    tokenCost(
      usage.outputAudioTokens,
      usage.outputAudioTokenSamples,
      card.rates.outputAudioUsdMicrosPerMillion,
      "output_audio_tokens",
      unpricedMetrics
    )
  ];
  const textUsdMicros = sumPresent(textCosts);
  const audioUsdMicros = sumPresent(audioCosts);
  if (textUsdMicros === null && audioUsdMicros === null) {
    unpricedMetrics.push("token_breakdown");
  }
  return {
    pricingVersion: openAIPublicPricingVersion,
    matched: true,
    calculatedUsdMicros: sumPresent([textUsdMicros, audioUsdMicros]),
    textUsdMicros,
    audioUsdMicros,
    durationUsdMicros: null,
    unpricedMetrics
  };
}

function inputCost(input: {
  total: number;
  totalSamples: number;
  cached: number;
  cachedSamples: number;
  cacheWrite: number;
  cacheWriteSamples: number;
  regularRate?: number;
  cachedRate?: number;
  cacheWriteRate?: number;
  metric: string;
  unpricedMetrics: string[];
}) {
  if (input.totalSamples === 0) return null;
  if (input.regularRate === undefined) {
    input.unpricedMetrics.push(input.metric);
    return null;
  }
  const cached = input.cachedSamples > 0 ? input.cached : 0;
  const cacheWrite = input.cacheWriteSamples > 0 ? input.cacheWrite : 0;
  const uncached = Math.max(0, input.total - cached - cacheWrite);
  let total = perMillionCost(uncached, input.regularRate);
  if (cached > 0) {
    if (input.cachedRate === undefined) {
      input.unpricedMetrics.push(`cached_${input.metric}`);
    } else {
      total += perMillionCost(cached, input.cachedRate);
    }
  }
  if (cacheWrite > 0) {
    if (input.cacheWriteRate === undefined) {
      input.unpricedMetrics.push(`cache_write_${input.metric}`);
    } else {
      total += perMillionCost(cacheWrite, input.cacheWriteRate);
    }
  }
  return total;
}

function tokenCost(
  tokens: number,
  samples: number,
  rate: number | undefined,
  metric: string,
  unpricedMetrics: string[]
) {
  if (samples === 0) return null;
  if (rate === undefined) {
    unpricedMetrics.push(metric);
    return null;
  }
  return perMillionCost(tokens, rate);
}

function perMillionCost(units: number, rate: number) {
  return Math.ceil((units * rate) / 1_000_000);
}

function perMinuteCost(seconds: number, rate: number) {
  return Math.ceil((seconds * rate) / 60);
}

function sumPresent(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((total, value) => total + value, 0);
}

function unmatchedCost(): ProviderUsageCost {
  return {
    pricingVersion: openAIPublicPricingVersion,
    matched: false,
    calculatedUsdMicros: null,
    textUsdMicros: null,
    audioUsdMicros: null,
    durationUsdMicros: null,
    unpricedMetrics: []
  };
}
