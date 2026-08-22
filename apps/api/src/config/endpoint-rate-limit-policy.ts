const hour = 60 * 60 * 1_000;
const day = 24 * hour;

export type EndpointRateLimitRule = {
  userLimit: number;
  ipLimit: number;
  windowMs: number;
};

export type EndpointRateLimitPolicy = {
  briefPreparation: EndpointRateLimitRule;
  callStart: EndpointRateLimitRule;
  promoRedemption: EndpointRateLimitRule;
  recordingDownload: EndpointRateLimitRule;
  transcriptionRetry: EndpointRateLimitRule;
  dataExport: EndpointRateLimitRule;
  callDataDeletion: EndpointRateLimitRule;
};

const ipMultiplier = 5;

export const defaultEndpointRateLimitPolicy: EndpointRateLimitPolicy = {
  briefPreparation: rule(15, hour),
  callStart: rule(10, 15 * 60 * 1_000),
  promoRedemption: rule(10, hour),
  recordingDownload: rule(30, hour),
  transcriptionRetry: rule(5, day),
  dataExport: rule(2, day),
  callDataDeletion: rule(5, day)
};

export function endpointRateLimitPolicyFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): EndpointRateLimitPolicy {
  return {
    briefPreparation: rule(positiveInteger(
      environment.API_RATE_LIMIT_BRIEF_PREPARATION_PER_HOUR,
      "API_RATE_LIMIT_BRIEF_PREPARATION_PER_HOUR",
      defaultEndpointRateLimitPolicy.briefPreparation.userLimit
    ), hour),
    callStart: rule(positiveInteger(
      environment.API_RATE_LIMIT_CALL_START_PER_15_MINUTES,
      "API_RATE_LIMIT_CALL_START_PER_15_MINUTES",
      defaultEndpointRateLimitPolicy.callStart.userLimit
    ), 15 * 60 * 1_000),
    promoRedemption: rule(positiveInteger(
      environment.API_RATE_LIMIT_PROMO_REDEMPTION_PER_HOUR,
      "API_RATE_LIMIT_PROMO_REDEMPTION_PER_HOUR",
      defaultEndpointRateLimitPolicy.promoRedemption.userLimit
    ), hour),
    recordingDownload: rule(positiveInteger(
      environment.API_RATE_LIMIT_RECORDING_DOWNLOAD_PER_HOUR,
      "API_RATE_LIMIT_RECORDING_DOWNLOAD_PER_HOUR",
      defaultEndpointRateLimitPolicy.recordingDownload.userLimit
    ), hour),
    transcriptionRetry: rule(positiveInteger(
      environment.API_RATE_LIMIT_TRANSCRIPTION_RETRY_PER_DAY,
      "API_RATE_LIMIT_TRANSCRIPTION_RETRY_PER_DAY",
      defaultEndpointRateLimitPolicy.transcriptionRetry.userLimit
    ), day),
    dataExport: rule(positiveInteger(
      environment.API_RATE_LIMIT_DATA_EXPORT_PER_DAY,
      "API_RATE_LIMIT_DATA_EXPORT_PER_DAY",
      defaultEndpointRateLimitPolicy.dataExport.userLimit
    ), day),
    callDataDeletion: rule(positiveInteger(
      environment.API_RATE_LIMIT_CALL_DATA_DELETION_PER_DAY,
      "API_RATE_LIMIT_CALL_DATA_DELETION_PER_DAY",
      defaultEndpointRateLimitPolicy.callDataDeletion.userLimit
    ), day)
  };
}

function rule(userLimit: number, windowMs: number): EndpointRateLimitRule {
  return { userLimit, ipLimit: userLimit * ipMultiplier, windowMs };
}

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number
) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
