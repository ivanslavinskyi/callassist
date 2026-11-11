import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import { preparationDiagnosticEventSchema, preparationDiagnosticAccessSchema,
  type PreparationDiagnosticInput, type PreparationDiagnosticEvent } from "@callassist/contracts";
import { encryptJson, decryptJson, type DataEncryptionMaterial } from "../security/encryption";
import type { DurableJobLease } from "../jobs/durable-job";
import { CallRepositoryError } from "./call-repository";

export const DIAGNOSTIC_EVENT_BYTES = 256 * 1024;
export const DIAGNOSTIC_PREPARATION_BYTES = 1024 * 1024;
export const DIAGNOSTIC_EVENT_LIMIT = 100;

/** Truncated evidence remains valid JSON; byte counts refer to retained plaintext. */
export function boundedDiagnostic(input: PreparationDiagnosticInput, remaining: number) {
  const serialized = JSON.stringify(input.detail ?? null);
  const originalBytes = Buffer.byteLength(serialized);
  const limit = Math.max(0, Math.min(DIAGNOSTIC_EVENT_BYTES, remaining));
  let detail: unknown = input.detail ?? null;
  if (originalBytes > limit) {
    let prefix = Buffer.from(serialized).subarray(0, Math.max(0, Math.floor((limit - 64) / 6))).toString("utf8");
    detail = limit >= 64 ? { truncated: true, jsonPrefix: prefix } : null;
  }
  const retainedBytes = detail === null ? 0 : Buffer.byteLength(JSON.stringify(detail));
  return { detail, metadata: { ...input.metadata, originalBytes, retainedBytes, truncated: originalBytes > limit } };
}

export class PostgresPreparationValidationStore {
  constructor(private sql: postgres.Sql, private key: DataEncryptionMaterial) {}
  async record(id: string, input: PreparationDiagnosticInput, lease: DurableJobLease) {
    await this.sql.begin(async tx => {
      const [owner] = await tx`SELECT user_id,coalesce(call_brief_id,target_call_brief_id) AS call_id FROM call_preparation_requests WHERE id=${id}`;
      if (!owner) return;
      // Same lock order as publication/deletion: user, call, preparation, job.
      if (owner.user_id && !(await tx`SELECT id FROM users WHERE id=${owner.user_id} AND status='active' FOR SHARE`).length) return;
      if (owner.call_id && !(await tx`SELECT id FROM call_briefs WHERE id=${owner.call_id} AND data_deleted_at IS NULL FOR SHARE`).length) return;
      const [current]=await tx`SELECT coalesce(call_brief_id,target_call_brief_id) AS call_id FROM call_preparation_requests
        WHERE id=${id} AND status<>'cancelled' AND created_at>clock_timestamp()-interval '30 days' FOR UPDATE`;
      if(!current || current.call_id!==owner.call_id)return;
      const [job] = await tx`SELECT generation,attempt_count FROM durable_jobs WHERE id=${lease.jobId} AND call_preparation_id=${id}
        AND status='running' AND lease_owner=${lease.workerId} AND lease_expires_at>clock_timestamp()
        AND (${lease.generation ?? null}::int IS NULL OR generation=${lease.generation ?? null})
        AND (${lease.attemptNumber ?? null}::int IS NULL OR attempt_count=${lease.attemptNumber ?? null}) FOR SHARE`;
      if (!job) return;
      const [usage] = await tx`SELECT count(*)::int AS count,coalesce(sum((metadata->>'retainedBytes')::int),0)::int AS bytes FROM preparation_validation_events WHERE preparation_id=${id}`;
      if (usage!.count >= DIAGNOSTIC_EVENT_LIMIT) return;
      const bounded = boundedDiagnostic(input, DIAGNOSTIC_PREPARATION_BYTES - usage!.bytes);
      const event = preparationDiagnosticEventSchema.parse({ id: input.id, preparationId:id, operationId:input.operationId ?? null,
        jobGeneration:job.generation,workerAttempt:job.attempt_count,createdAt:new Date().toISOString(),metadata:bounded.metadata });
      await tx`INSERT INTO preparation_validation_events(id,preparation_id,operation_id,job_generation,worker_attempt,metadata,detail_ciphertext,created_at)
        VALUES(${event.id},${id},${event.operationId},${event.jobGeneration},${event.workerAttempt},${tx.json(event.metadata)},
          ${bounded.detail === null ? null : encryptJson(bounded.detail,this.key)},${event.createdAt}::timestamptz) ON CONFLICT DO NOTHING`;
    });
  }
  async list(id: string): Promise<PreparationDiagnosticEvent[]> {
    const rows = await this.sql`SELECT e.* FROM preparation_validation_events e
      JOIN call_preparation_requests p ON p.id=e.preparation_id
      LEFT JOIN call_briefs b ON b.id=coalesce(p.call_brief_id,p.target_call_brief_id) LEFT JOIN users u ON u.id=p.user_id
      WHERE e.preparation_id=${id} AND e.created_at>clock_timestamp()-interval '30 days'
        AND b.data_deleted_at IS NULL AND (u.id IS NULL OR u.status='active') ORDER BY e.created_at,e.id LIMIT 100`;
    return rows.map(mapEvent);
  }
  async evidence(id: string, actor: string, reason: string) {
    const parsed = preparationDiagnosticAccessSchema.parse({reason});
    return this.sql.begin(async tx => {
      const [owner] = await tx`SELECT user_id,coalesce(call_brief_id,target_call_brief_id) AS call_id FROM call_preparation_requests WHERE id=${id}`;
      if (!owner) throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
      if (owner.user_id && !(await tx`SELECT id FROM users WHERE id=${owner.user_id} AND status='active' FOR SHARE`).length) throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
      if (owner.call_id && !(await tx`SELECT id FROM call_briefs WHERE id=${owner.call_id} AND data_deleted_at IS NULL FOR SHARE`).length) throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
      const [current]=await tx`SELECT coalesce(call_brief_id,target_call_brief_id) AS call_id FROM call_preparation_requests WHERE id=${id} FOR SHARE`;
      if(!current || current.call_id!==owner.call_id)throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
      await tx`INSERT INTO preparation_diagnostic_access_events(id,preparation_id,actor_user_id,reason_ciphertext)
        VALUES(${randomUUID()},${id},${actor},${encryptJson(parsed.reason,this.key)})`;
      const rows = await tx`SELECT * FROM preparation_validation_events WHERE preparation_id=${id} AND created_at>clock_timestamp()-interval '30 days' ORDER BY created_at,id LIMIT 100`;
      return rows.map(row => ({event:mapEvent(row),detail:row.detail_ciphertext ? decryptJson(row.detail_ciphertext,this.key) : null}));
    });
  }
}
function mapEvent(row: postgres.Row) {
  return preparationDiagnosticEventSchema.parse({id:row.id,preparationId:row.preparation_id,operationId:row.operation_id,
    jobGeneration:row.job_generation,workerAttempt:row.worker_attempt,metadata:row.metadata,createdAt:new Date(row.created_at).toISOString()});
}
