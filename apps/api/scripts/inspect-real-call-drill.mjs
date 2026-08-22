import "../src/config/load-env.ts";
import postgres from "postgres";

const callId = process.env.REAL_CALL_DRILL_CALL_ID?.trim();
const expectation = process.env.REAL_CALL_DRILL_EXPECT?.trim();
if (!callId) throw new Error("REAL_CALL_DRILL_CALL_ID is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (expectation && !["worker_backlog", "settled"].includes(expectation)) {
  throw new Error("REAL_CALL_DRILL_EXPECT must be worker_backlog or settled");
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [summary] = await sql`
    SELECT
      call_briefs.status AS "callStatus",
      call_attempts.status AS "attemptStatus",
      call_attempts.provider_status AS "providerStatus",
      call_attempts.failure_reason AS "failureCode",
      call_recordings.status AS "recordingStatus",
      call_recordings.duration_seconds AS "recordingDurationSeconds",
      call_recordings.deleted_at IS NOT NULL AS "recordingDeleted"
    FROM call_briefs
    LEFT JOIN LATERAL (
      SELECT * FROM call_attempts
      WHERE call_attempts.call_brief_id = call_briefs.id
      ORDER BY call_attempts.created_at DESC
      LIMIT 1
    ) AS call_attempts ON true
    LEFT JOIN call_recordings
      ON call_recordings.call_brief_id = call_briefs.id
    WHERE call_briefs.id = ${callId}::uuid
  `;
  const credits = await sql`
    SELECT credit_transactions.type, credit_transactions.amount
    FROM credit_transactions
    JOIN call_attempts
      ON call_attempts.id = credit_transactions.call_attempt_id
    WHERE call_attempts.call_brief_id = ${callId}::uuid
    ORDER BY credit_transactions.created_at ASC
  `;
  const jobs = await sql`
    SELECT
      durable_jobs.job_type AS "type",
      durable_jobs.status,
      durable_jobs.attempt_count AS "attemptCount",
      durable_jobs.last_error_code AS "lastErrorCode"
    FROM durable_jobs
    LEFT JOIN call_attempts
      ON call_attempts.id = durable_jobs.call_attempt_id
    LEFT JOIN call_recordings
      ON call_recordings.id = durable_jobs.recording_id
    WHERE call_attempts.call_brief_id = ${callId}::uuid
      OR call_recordings.call_brief_id = ${callId}::uuid
    ORDER BY durable_jobs.created_at ASC
  `;
  const events = await sql`
    SELECT event_name AS "name", stage, severity
    FROM call_events
    WHERE call_brief_id = ${callId}::uuid
    ORDER BY sequence ASC
  `;
  const webhooks = await sql`
    SELECT
      webhook_kind AS "kind",
      outcome,
      sum(delivery_count)::integer AS "count",
      max(last_received_at) AS "lastReceivedAt",
      (array_agg(last_error_code ORDER BY last_received_at DESC))[1]
        AS "lastErrorCode"
    FROM provider_webhook_delivery_buckets
    WHERE provider = 'twilio'
      AND bucket_started_at >= date_trunc('hour', now() - interval '1 hour')
    GROUP BY webhook_kind, outcome
    ORDER BY webhook_kind, outcome
  `;
  const result = {
    callId,
    summary: summary ?? null,
    credits,
    jobs,
    events,
    webhooks
  };
  assertExpectation(result, expectation);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end();
}

function assertExpectation(result, expected) {
  if (!expected) return;
  if (
    result.summary?.callStatus !== "completed" ||
    result.summary.attemptStatus !== "completed" ||
    result.summary.providerStatus !== "completed"
  ) {
    throw new Error("REAL_CALL_DRILL_NOT_COMPLETED");
  }
  const creditKinds = result.credits.map(({ type, amount }) => `${type}:${amount}`);
  if (
    creditKinds.filter((entry) => entry === "call_reservation:-1").length !== 1 ||
    creditKinds.filter((entry) => entry === "call_charge:0").length !== 1 ||
    creditKinds.some((entry) => entry.startsWith("call_refund:"))
  ) {
    throw new Error("REAL_CALL_DRILL_CREDIT_SETTLEMENT_INVALID");
  }

  const jobsByType = new Map(result.jobs.map((job) => [job.type, job]));
  const initialJobs = [
    "provider_call_reconciliation",
    "provider_recording_reconciliation",
    "final_transcription"
  ];
  if (expected === "worker_backlog") {
    if (
      result.summary.recordingStatus !== "available" ||
      result.summary.recordingDeleted ||
      initialJobs.some((type) => {
        const job = jobsByType.get(type);
        return !job || job.status !== "queued" || job.attemptCount !== 0;
      })
    ) {
      throw new Error("REAL_CALL_DRILL_WORKER_BACKLOG_INVALID");
    }
    return;
  }

  if (
    result.summary.recordingStatus !== "deleted" ||
    !result.summary.recordingDeleted ||
    [...initialJobs, "recording_retention"].some((type) => {
      const job = jobsByType.get(type);
      return !job || job.status !== "succeeded" ||
        job.attemptCount < 1 || job.lastErrorCode !== null;
    })
  ) {
    throw new Error("REAL_CALL_DRILL_SETTLEMENT_INVALID");
  }
}
