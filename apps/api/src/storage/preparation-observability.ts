import type postgres from "postgres";
export async function maintainPreparationTelemetry(sql: postgres.Sql) {
  await sql.begin(async tx => {
    // One housekeeping transaction, even with several background processes.
    const [lock] = await tx`SELECT pg_try_advisory_xact_lock(20261005,103) AS acquired`;
    if (!lock?.acquired) return;
    await tx`INSERT INTO preparation_daily_metrics(day,model,tier,stage,requests,successes,unknown_usage,duration_total_ms,duration_p95_ms)
      SELECT (o.started_at AT TIME ZONE 'UTC')::date,o.requested_model,coalesce(r.actual_service_tier,'unknown'),o.stage,
        count(*)::int,count(*) FILTER(WHERE r.outcome='succeeded')::int,count(*) FILTER(WHERE u.id IS NULL)::int,
        coalesce(sum(r.duration_ms),0)::bigint,percentile_disc(.95) WITHIN GROUP(ORDER BY r.duration_ms)::int
      FROM provider_operations o LEFT JOIN provider_operation_results r ON r.operation_id=o.id
      LEFT JOIN provider_usage_records u ON u.operation_id=o.id
      LEFT JOIN call_text_artifacts a ON a.id=o.text_artifact_id
      WHERE (o.call_preparation_id IS NOT NULL OR a.kind IN ('plan_review','clarification_review'))
        AND o.started_at >= now()-interval '90 days' AND o.started_at < date_trunc('day',now())
      GROUP BY 1,2,3,4 ON CONFLICT(day,model,tier,stage) DO UPDATE SET requests=excluded.requests,successes=excluded.successes,
        unknown_usage=excluded.unknown_usage,duration_total_ms=excluded.duration_total_ms,duration_p95_ms=excluded.duration_p95_ms,updated_at=now()`;
    await tx`DELETE FROM preparation_daily_metrics WHERE day < (now() AT TIME ZONE 'UTC')::date-90`;
    await tx`SELECT set_config('callassist.preparation_retention','enabled',true)`;
    // Deleted calls/accounts take precedence over the diagnostic retention period.
    await tx`CREATE TEMP TABLE preparation_detail_purge ON COMMIT DROP AS SELECT o.id FROM provider_operations o
      LEFT JOIN call_preparation_requests p ON p.id=o.call_preparation_id
      LEFT JOIN call_briefs b ON b.id=coalesce(o.call_brief_id,p.call_brief_id,p.target_call_brief_id)
      LEFT JOIN users u ON u.id=coalesce(p.user_id,b.user_id)
      WHERE o.started_at<now()-interval '30 days' OR b.data_deleted_at IS NOT NULL OR (u.id IS NOT NULL AND u.status<>'active')`;
    await tx`DELETE FROM preparation_request_checkpoints WHERE operation_id IN (SELECT id FROM preparation_detail_purge)`;
    await tx`UPDATE provider_operations SET request_metadata=NULL WHERE request_metadata IS NOT NULL AND id IN (SELECT id FROM preparation_detail_purge)`;
    await tx`UPDATE provider_operation_results SET response_metadata=NULL WHERE response_metadata IS NOT NULL AND operation_id IN (SELECT id FROM preparation_detail_purge)`;
    await tx`DELETE FROM preparation_provider_permits WHERE expires_at <= clock_timestamp()`;
    await tx`DELETE FROM preparation_provider_admissions WHERE admitted_at <= clock_timestamp()-interval '1 minute'`;
  });
}
export async function preparationRuntimeStatus(sql: postgres.Sql) {
  const [workers, queue, metrics] = await Promise.all([
    sql`SELECT worker_id AS id,role,active_jobs AS active,metrics,last_seen_at AS "lastSeenAt",stopped_at AS "stoppedAt",
      (stopped_at IS NULL AND last_seen_at>clock_timestamp()-interval '15 seconds') AS ready
      FROM durable_worker_heartbeats WHERE last_seen_at>clock_timestamp()-interval '1 day' ORDER BY last_seen_at DESC LIMIT 100`,
    sql`SELECT work_class AS class,status,count(*)::int AS count,extract(epoch FROM(clock_timestamp()-min(created_at)))*1000 AS "oldestMs"
      FROM durable_jobs WHERE status IN ('running','queued') GROUP BY work_class,status`,
    sql`SELECT * FROM preparation_daily_metrics WHERE day >= current_date-30 ORDER BY day DESC LIMIT 1000`
  ]);
  return { workers, queue, metrics };
}
