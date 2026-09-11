import "../config/load-env";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

/** One-time local development cutover. No payload conversion, history regeneration or source mutation. */
export async function cutoverLocalSummaries(databaseUrl: string, apply = false) {
  const target = new URL(databaseUrl);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      !/^\/callassist(?:_[a-zA-Z0-9_]+)?$/.test(target.pathname)) throw new Error("SUMMARY_CUTOVER_LOCAL_DATABASE_REQUIRED");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    return await sql.begin(async tx => {
      if (apply) {
        await tx`SET LOCAL lock_timeout = '5s'`;
        // Fence concurrent call starts, preparations, artifact jobs and source writes throughout the cutover.
        await tx`LOCK TABLE call_briefs, call_attempts, call_preparation_requests, durable_jobs, call_text_artifacts, call_text_artifact_chunks IN SHARE ROW EXCLUSIVE MODE`;
        const [active] = await tx`SELECT
          (SELECT count(*)::int FROM call_attempts WHERE status IN ('dialing','in_progress','awaiting_approval')) AS calls,
          (SELECT count(*)::int FROM call_briefs WHERE status IN ('dialing','in_progress','awaiting_approval')) AS briefs,
          (SELECT count(*)::int FROM call_preparation_requests WHERE status NOT IN ('succeeded','failed','cancelled')) AS preparations,
          (SELECT count(*)::int FROM durable_jobs WHERE status='running' AND lease_expires_at>now()) AS jobs,
          (SELECT count(*)::int FROM durable_worker_heartbeats WHERE stopped_at IS NULL AND last_seen_at>now()-interval '30 seconds') AS workers`;
        if (Object.values(active!).some(value => value !== 0)) throw new Error("SUMMARY_CUTOVER_REQUIRES_QUIESCENT_RUNTIME");
      }
      const [before] = await tx`SELECT
        count(*)::int AS artifacts,
        count(*) FILTER (WHERE payload_ciphertext IS NOT NULL)::int AS payloads,
        (SELECT count(*)::int FROM call_text_artifact_chunks WHERE payload_ciphertext IS NOT NULL AND artifact_id IN
          (SELECT id FROM call_text_artifacts WHERE kind='call_summary' AND generator_version NOT LIKE 'summary-v2:%')) AS chunks
        FROM call_text_artifacts WHERE kind='call_summary' AND generator_version NOT LIKE 'summary-v2:%'`;
      if (!apply) return { applied: false, ...before };
      await tx`INSERT INTO durable_job_attempts(id,job_id,generation,attempt_number,worker_id,started_at,completed_at,outcome,error_code)
        SELECT gen_random_uuid(),id,generation,attempt_count,lease_owner,leased_at,now(),'cancelled','summary_v2_cutover'
        FROM durable_jobs WHERE status='running' AND text_artifact_id IN
          (SELECT id FROM call_text_artifacts WHERE kind='call_summary' AND generator_version NOT LIKE 'summary-v2:%')
        ON CONFLICT (job_id,generation,attempt_number) DO NOTHING`;
      await tx`UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,
        completed_at=now(),updated_at=now(),last_error_code='summary_v2_cutover'
        WHERE status IN ('queued','running','dead_letter') AND text_artifact_id IN
          (SELECT id FROM call_text_artifacts WHERE kind='call_summary' AND generator_version NOT LIKE 'summary-v2:%')`;
      await tx`UPDATE call_text_artifact_chunks SET payload_ciphertext=NULL WHERE payload_ciphertext IS NOT NULL AND artifact_id IN
        (SELECT id FROM call_text_artifacts WHERE kind='call_summary' AND generator_version NOT LIKE 'summary-v2:%')`;
      await tx`UPDATE call_text_artifacts SET payload_ciphertext=NULL,status='cancelled',failure_code='summary_v2_cutover',updated_at=now()
        WHERE kind='call_summary' AND generator_version NOT LIKE 'summary-v2:%' AND (status<>'cancelled' OR payload_ciphertext IS NOT NULL)`;
      return { applied: true, ...before };
    });
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  console.log(JSON.stringify(await cutoverLocalSummaries(process.env.DATABASE_URL, process.argv.includes("--apply"))));
}
