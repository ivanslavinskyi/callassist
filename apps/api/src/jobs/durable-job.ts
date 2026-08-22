export const durableJobTypes = [
  "final_transcription",
  "recording_retention"
] as const;

export type DurableJobType = typeof durableJobTypes[number];
export type DurableJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "dead_letter";

export type DurableJob = {
  id: string;
  type: DurableJobType;
  recordingId: string;
  callId: string;
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
  outcome: "succeeded" | "retry_scheduled" | "dead_letter" | "lease_expired";
  errorCode: string | null;
};

export type DurableJobLease = {
  jobId: string;
  workerId: string;
  checkedAt: string;
};

export type EnqueueDurableJobInput = {
  type: DurableJobType;
  recordingId: string;
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
  final_transcription: 3,
  recording_retention: 5
};

export function durableJobRetryDelayMs(attemptNumber: number) {
  const safeAttempt = Math.max(1, Math.floor(attemptNumber));
  return Math.min(15 * 60_000, 5_000 * 2 ** (safeAttempt - 1));
}

export class DurableJobExecutionError extends Error {
  constructor(
    readonly code: string,
    options?: { cause?: unknown }
  ) {
    super(code, options);
    this.name = "DurableJobExecutionError";
  }
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
