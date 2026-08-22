export type OperationalCostPolicy = {
  pricingVersion: string | null;
  telephonyUsdMicrosPerMinute: number | null;
  realtimeUsdMicrosPerMinute: number | null;
  transcriptionUsdMicrosPerMinute: number | null;
};

export const unavailableOperationalCostPolicy: OperationalCostPolicy = {
  pricingVersion: null,
  telephonyUsdMicrosPerMinute: null,
  realtimeUsdMicrosPerMinute: null,
  transcriptionUsdMicrosPerMinute: null
};

export function operationalCostPolicyFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): OperationalCostPolicy {
  const policy = {
    pricingVersion: parsePricingVersion(
      environment.ADMIN_COST_PRICING_VERSION
    ),
    telephonyUsdMicrosPerMinute: parseRate(
      environment.ADMIN_COST_TELEPHONY_USD_MICROS_PER_MINUTE,
      "ADMIN_COST_TELEPHONY_USD_MICROS_PER_MINUTE"
    ),
    realtimeUsdMicrosPerMinute: parseRate(
      environment.ADMIN_COST_REALTIME_USD_MICROS_PER_MINUTE,
      "ADMIN_COST_REALTIME_USD_MICROS_PER_MINUTE"
    ),
    transcriptionUsdMicrosPerMinute: parseRate(
      environment.ADMIN_COST_TRANSCRIPTION_USD_MICROS_PER_MINUTE,
      "ADMIN_COST_TRANSCRIPTION_USD_MICROS_PER_MINUTE"
    )
  };
  const hasRate = [
    policy.telephonyUsdMicrosPerMinute,
    policy.realtimeUsdMicrosPerMinute,
    policy.transcriptionUsdMicrosPerMinute
  ].some((value) => value !== null);
  if (hasRate && !policy.pricingVersion) {
    throw new Error(
      "ADMIN_COST_PRICING_VERSION is required when cost rates are configured"
    );
  }
  return policy;
}

function parsePricingVersion(value: string | undefined) {
  const parsed = value?.trim() || null;
  if (parsed && parsed.length > 80) {
    throw new Error("ADMIN_COST_PRICING_VERSION must be at most 80 characters");
  }
  return parsed;
}

function parseRate(value: string | undefined, name: string) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
