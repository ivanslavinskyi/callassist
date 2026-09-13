import type { AdminSystemStatus } from "@callassist/contracts";
import type { DurableJob } from "./durable-job";

// Explicitly project the public fields: new internal job targets or lease data
// must never leak into the strict admin response or break the system dashboard.
export function toAdminDurableJob(
  job: DurableJob
): AdminSystemStatus["jobs"]["recent"][number] {
  return {
    id: job.id,
    callId: job.callId,
    callPreparationId: job.callPreparationId,
    type: job.type,
    status: job.status,
    generation: job.generation,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    leaseExpiresAt: job.leaseExpiresAt,
    lastErrorCode: job.lastErrorCode,
    updatedAt: job.updatedAt
  };
}
