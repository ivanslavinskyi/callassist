import type postgres from "postgres";
import { PreparationPolicyError } from "./preparation-policy-store";
import type { DurableJobLease } from "../jobs/durable-job";
import { preparationCapacitySchema } from "@callassist/contracts";

export async function lockPreparationProviderCapacity(tx: postgres.TransactionSql, operationId: string, estimatedTokens = 250_000) {
  if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0 || estimatedTokens > 1_000_000) throw new Error("Invalid provider token reservation");
  const [settings] = await tx`SELECT capacity FROM preparation_settings WHERE id=true FOR UPDATE`;
  const capacity = preparationCapacitySchema.parse(settings!.capacity);
  const existing = await tx`SELECT id FROM provider_operations WHERE id=${operationId}`;
  if (existing.count) return;
  const [cooldown] = await tx`SELECT greatest(0,extract(epoch FROM until_at-clock_timestamp())*1000)::int AS delay
    FROM preparation_provider_cooldown WHERE id=true`;
  await tx`DELETE FROM preparation_provider_permits WHERE expires_at <= clock_timestamp()`;
  const [active] = await tx`SELECT count(*)::int AS count FROM preparation_provider_permits`;
  if ((cooldown?.delay ?? 0)>0 || active!.count >= capacity.providerSlots)
    throw new PreparationPolicyError("PREPARATION_PROVIDER_BUSY", cooldown?.delay || 1000);
  await tx`DELETE FROM preparation_provider_admissions WHERE admitted_at <= clock_timestamp()-interval '1 minute'`;
  const [window] = await tx`SELECT count(*)::int AS requests,coalesce(sum(estimated_tokens),0)::bigint AS tokens,
    greatest(1000,extract(epoch FROM min(admitted_at)+interval '1 minute'-clock_timestamp())*1000)::int AS retry_ms
    FROM preparation_provider_admissions`;
  const fraction = (100-capacity.voiceReservePercent)/100;
  if (window!.requests >= Math.floor(capacity.providerRequestsPerMinute*fraction) ||
      Number(window!.tokens)+estimatedTokens > Math.floor(capacity.providerTokensPerMinute*fraction)) {
    throw new PreparationPolicyError("PREPARATION_PROVIDER_BUSY", window!.retry_ms || 60000);
  }
}
export async function insertPreparationProviderPermit(tx: postgres.TransactionSql, operationId: string, lease: DurableJobLease, timeoutMs: number, estimatedTokens = 250_000) {
  await tx`INSERT INTO preparation_provider_permits(operation_id,job_id,generation,attempt_number,expires_at)
    VALUES(${operationId},${lease.jobId},${lease.generation ?? 1},${lease.attemptNumber ?? 1},
      clock_timestamp()+(${Math.min(120000, timeoutMs)+5000}*interval '1 millisecond'))`;
  // Keep reservations for the whole rolling minute, even on errors or unknown usage.
  await tx`INSERT INTO preparation_provider_admissions(operation_id,estimated_tokens) VALUES(${operationId},${estimatedTokens})`;
}
