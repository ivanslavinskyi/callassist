import {
  defaultCallAdmissionPolicy,
  type CallAdmissionPolicy
} from "../storage/call-repository";

export function callAdmissionPolicyFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): CallAdmissionPolicy {
  return {
    maxStartsPerHour: positiveInteger(
      environment.CALL_MAX_STARTS_PER_HOUR,
      "CALL_MAX_STARTS_PER_HOUR",
      defaultCallAdmissionPolicy.maxStartsPerHour
    ),
    maxStartsPerDay: positiveInteger(
      environment.CALL_MAX_STARTS_PER_DAY,
      "CALL_MAX_STARTS_PER_DAY",
      defaultCallAdmissionPolicy.maxStartsPerDay
    ),
    maxStartsPerRecipientPerDay: positiveInteger(
      environment.CALL_MAX_STARTS_PER_RECIPIENT_PER_DAY,
      "CALL_MAX_STARTS_PER_RECIPIENT_PER_DAY",
      defaultCallAdmissionPolicy.maxStartsPerRecipientPerDay
    ),
    maxDurationSeconds: positiveInteger(
      environment.CALL_MAX_DURATION_SECONDS,
      "CALL_MAX_DURATION_SECONDS",
      defaultCallAdmissionPolicy.maxDurationSeconds
    )
  };
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
