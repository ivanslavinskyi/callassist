import { pathToFileURL } from "node:url";
import { runRealCallDrill } from "./run-real-call-drill.mjs";

/** Actual Twilio call through the existing authenticated approval/start routes. */
export async function runVoiceRuntimeSmoke(environment = process.env, dependencies = {}) {
  const driver = environment.VOICE_SMOKE_DRIVER;
  if (!["realtime", "live"].includes(driver)) throw new Error("VOICE_SMOKE_DRIVER must be realtime or live");
  const url = new URL(environment.REAL_CALL_DRILL_API_URL || "http://127.0.0.1:4000");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Voice smoke requires a local API");
  const mode = environment.VOICE_SMOKE_MODE || "prepare";
  if (mode !== "verify") {
    if (!["prepare", "start"].includes(mode)) throw new Error("VOICE_SMOKE_MODE must be prepare, start or verify");
    const result = await runRealCallDrill({ ...environment, REAL_CALL_DRILL_MODE: mode }, dependencies);
    return { driver, ...result };
  }
  const callId = environment.REAL_CALL_DRILL_CALL_ID;
  if (!/^[a-f0-9-]{36}$/i.test(callId ?? "")) throw new Error("A prepared call UUID is required");
  const facts = await (dependencies.readFacts ?? readFacts)(environment.DATABASE_URL, callId);
  const failures = assessVoiceSmoke(facts, driver);
  const report = { driver, callId, passed: failures.length === 0, failures, facts };
  (dependencies.write ?? (value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)))(report);
  if (failures.length) throw new Error(`VOICE_SMOKE_FAILED: ${failures.join(",")}`);
  return report;
}

export function assessVoiceSmoke(facts, driver) {
  const failures = [];
  if (!facts.completed) failures.push("call_not_completed");
  if (!facts.consent) failures.push("consent_missing");
  if (!facts.hangup) failures.push("application_hangup_missing");
  if (!facts.finalTranscript) failures.push("post_call_transcript_missing");
  if (!facts.retentionComplete) failures.push("recording_retention_pending");
  if (!facts.realtimeUsage) failures.push("realtime_usage_missing");
  if (driver === "live") {
    if (!facts.liveFinalUsage) failures.push("live_final_usage_missing_or_fallback_used");
    if (!facts.backendUsage) failures.push("responses_usage_missing");
    if (!facts.nativeInput || !facts.nativeOutput) failures.push("native_transcripts_missing");
  } else if (facts.liveSessions > 0) failures.push("unexpected_live_session");
  if (facts.unfinishedOperations > 0) failures.push("provider_operations_unfinished");
  return failures;
}

async function readFacts(databaseUrl, callId) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for verification");
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
    throw new Error("Voice smoke requires a dedicated local *_test database");
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [facts] = await sql`
      SELECT
        EXISTS(SELECT 1 FROM call_attempts WHERE call_brief_id=${callId}::uuid AND provider_status='completed') AS completed,
        EXISTS(SELECT 1 FROM call_recordings WHERE call_brief_id=${callId}::uuid AND consent_granted_at IS NOT NULL) AS consent,
        (EXISTS(SELECT 1 FROM call_events WHERE call_brief_id=${callId}::uuid AND event_name='conversation.hangup'
          AND metadata->>'phase'='playback_complete') AND
         EXISTS(SELECT 1 FROM call_events WHERE call_brief_id=${callId}::uuid AND event_name='conversation.ended'
          AND metadata->>'reason'='agent_hangup')) AS hangup,
        EXISTS(SELECT 1 FROM final_transcripts f JOIN call_recordings r ON r.id=f.call_recording_id
          WHERE r.call_brief_id=${callId}::uuid AND f.status='completed') AS "finalTranscript",
        EXISTS(SELECT 1 FROM call_recordings WHERE call_brief_id=${callId}::uuid AND deleted_at IS NOT NULL) AS "retentionComplete",
        EXISTS(SELECT 1 FROM provider_operations o JOIN provider_usage_records u ON u.operation_id=o.id
          WHERE o.call_brief_id=${callId}::uuid AND o.requested_model='gpt-realtime-2.1' AND u.total_tokens IS NOT NULL) AS "realtimeUsage",
        EXISTS(SELECT 1 FROM provider_operations o JOIN provider_usage_records u ON u.operation_id=o.id
          JOIN provider_operation_results r ON r.operation_id=o.id WHERE o.call_brief_id=${callId}::uuid
          AND o.stage='live_conversation' AND r.outcome='succeeded' AND u.duration_seconds > 0 AND u.raw_usage->>'finalized'='true') AS "liveFinalUsage",
        EXISTS(SELECT 1 FROM provider_operations o JOIN provider_usage_records u ON u.operation_id=o.id
          WHERE o.call_brief_id=${callId}::uuid AND o.stage='live_delegation' AND u.total_tokens > 0) AS "backendUsage",
        EXISTS(SELECT 1 FROM transcript_segments WHERE call_brief_id=${callId}::uuid AND role='recipient' AND native_timing IS NOT NULL) AS "nativeInput",
        EXISTS(SELECT 1 FROM transcript_segments WHERE call_brief_id=${callId}::uuid AND role='assistant' AND native_timing IS NOT NULL) AS "nativeOutput",
        (SELECT count(*)::integer FROM provider_operations WHERE call_brief_id=${callId}::uuid AND stage='live_conversation') AS "liveSessions",
        (SELECT count(*)::integer FROM provider_operations o WHERE o.call_brief_id=${callId}::uuid
          AND NOT EXISTS(SELECT 1 FROM provider_operation_results r WHERE r.operation_id=o.id)) AS "unfinishedOperations"
    `;
    return facts;
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import("../src/config/load-env.ts");
  await runVoiceRuntimeSmoke();
}
