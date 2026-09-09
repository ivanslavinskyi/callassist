export const durableJobTypes = [
  "text_artifact_generation",
  "brief_compilation",
  "final_transcription",
  "recording_retention",
  "provider_call_reconciliation",
  "provider_call_cost_reconciliation",
  "provider_recording_reconciliation"
] as const;

export type DurableJobType = typeof durableJobTypes[number];
export type DurableJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "dead_letter"
  | "cancelled";

export type DurableJob = {
  id: string;
  type: DurableJobType;
  recordingId: string | null;
  callAttemptId: string | null;
  callPreparationId: string | null;
  textArtifactId?: string | null;
  callId: string | null;
  status: DurableJobStatus;
  generation: number;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  forceRequested: boolean;
  leaseOwner: string | null;
  leasedAt: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type DurableJobAttempt = {
  id: string;
  jobId: string;
  generation: number;
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  completedAt: string;
  outcome:
    | "succeeded"
    | "retry_scheduled"
    | "dead_letter"
    | "lease_expired"
    | "cancelled";
  errorCode: string | null;
};

export type DurableJobLease = {
  jobId: string;
  workerId: string;
  checkedAt: string;
  generation?: number;
  attemptNumber?: number;
};

export type EnqueueDurableJobInput = {
  type: DurableJobType;
  recordingId?: string;
  callAttemptId?: string;
  callPreparationId?: string;
  textArtifactId?: string;
  runAfter: string;
  maxAttempts: number;
  force?: boolean;
  restartTerminal?: boolean;
};

export type ClaimDurableJobInput = {
  types: DurableJobType[];
  workerId: string;
  now: string;
  leaseExpiresAt: string;
};

export const durableJobMaxAttempts: Record<DurableJobType, number> = {
  text_artifact_generation: 3,
  brief_compilation: 3,
  final_transcription: 3,
  recording_retention: 5,
  provider_call_reconciliation: 5,
  provider_call_cost_reconciliation: 10,
  provider_recording_reconciliation: 5
};

export function durableJobRetryDelayMs(attemptNumber: number) {
  const safeAttempt = Math.max(1, Math.floor(attemptNumber));
  return Math.min(15 * 60_000, 5_000 * 2 ** (safeAttempt - 1));
}

export class DurableJobExecutionError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    options?: { cause?: unknown; retryable?: boolean }
  ) {
    super(code, options);
    this.name = "DurableJobExecutionError";
    this.retryable =
      options?.retryable ?? code !== "DURABLE_JOB_TARGET_INVALID";
  }
}

export function durableJobErrorIsRetryable(error: unknown) {
  return !(error instanceof DurableJobExecutionError) || error.retryable;
}

export function durableJobErrorCode(error: unknown) {
  if (error instanceof DurableJobExecutionError) return boundedCode(error.code);
  return "DURABLE_JOB_EXECUTION_FAILED";
}

function boundedCode(value: string) {
  return /^[a-z0-9_.:/-]{1,160}$/i.test(value)
    ? value
    : "DURABLE_JOB_EXECUTION_FAILED";
}
