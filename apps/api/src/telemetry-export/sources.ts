import { decryptJson, type DataEncryptionMaterial } from "../security/encryption";
import { calculateProviderUsageCost } from "../config/provider-pricing-policy";
import type { AdminProviderUsageBucket } from "../storage/call-repository";

// Only these columns cross the export boundary. Names are source-database names;
// decrypted *_ciphertext fields lose the suffix. Never export a database row wholesale.
export type ExportSource = { table: string; fields: string[]; where: string; order: string };
const source = (table: string, fields: string, where: string, order = "t.id"): ExportSource => ({ table, fields: fields.split(" "), where, order });
const calls = "t.call_brief_id IN (SELECT id FROM export_calls WHERE available)";
const preparations = "t.id IN (SELECT id FROM export_preparations WHERE available)";
const recordings = "t.recording_id IN (SELECT id FROM call_recordings WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))";
const artifacts = "t.artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))";
const operations = "t.operation_id IN (SELECT id FROM export_operations)";
const jobs = "t.job_id IN (SELECT id FROM export_jobs)";
export const exportSources: ExportSource[] = [
  source("call_briefs", "id user_id recipient_name phone_number objective locale allow_language_switch fallback_locale allowed_facts_ciphertext status created_at updated_at context_ciphertext represented_person represented_person_first_name represented_person_last_name agent_name assistant_profile_id assistance_reason_ciphertext assistance_disclosure_ciphertext voice_gender audio_retention_days current_compilation_id data_deleted_at", "t.id IN (SELECT id FROM export_calls)"),
  source("call_attempts", "id call_brief_id user_id provider provider_call_id provider_status status started_at ended_at failure_reason compilation_id compilation_revision compilation_snapshot_hash execution_snapshot_ciphertext review_receipt_id content_language max_duration_seconds created_at", calls),
  source("call_events", "id call_brief_id call_attempt_id user_id sequence schema_version event_name source stage severity metadata occurred_at created_at", "t.call_brief_id IN (SELECT id FROM export_calls)", "t.call_brief_id,t.sequence"),
  source("call_compilations", "id call_brief_id revision snapshot_hash compilation_ciphertext origin created_at", calls),
  source("call_compilation_approvals", "id call_brief_id compilation_id revision snapshot_hash approved_at execution_snapshot_ciphertext", calls),
  source("call_compilation_review_policies", "compilation_id policy_version", "t.compilation_id IN (SELECT id FROM call_compilations WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))", "t.compilation_id"),
  source("call_plan_review_receipts", "id call_brief_id compilation_id revision snapshot_hash mode language selection_revision artifact_id artifact_hash payload_ciphertext created_at", calls),
  source("call_language_contexts", "call_brief_id context", calls, "t.call_brief_id"),
  source("transcript_segments", "id call_brief_id role text locale final created_at", calls, "t.call_brief_id,t.created_at,t.id"),
  source("call_recordings", "id call_brief_id call_attempt_id provider provider_call_id provider_recording_id status consent_granted_at started_at completed_at duration_seconds channels delete_after deleted_at failure_reason created_at updated_at", calls),
  source("final_transcripts", "id call_recording_id status model text_ciphertext segments_ciphertext failure_reason current_revision_id created_at updated_at completed_at", "t.call_recording_id IN (SELECT id FROM call_recordings WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))"),
  source("final_transcript_revisions", "id call_brief_id transcript_id call_attempt_id revision source_hash payload_ciphertext created_at", calls),
  source("post_call_transcription_chunks", "id recording_id durable_job_generation stage chunk_key input_fingerprint requested_model provider_operation_id text_ciphertext created_at", recordings),
  source("call_text_artifacts", "id call_brief_id kind compilation_id transcript_revision_id source_hash target_language generator_version status payload_ciphertext payload_hash failure_code provider_request_count created_at updated_at", calls),
  source("call_text_artifact_chunks", "id artifact_id chunk_index payload_ciphertext payload_hash created_at", artifacts),
  source("call_assessments", "id call_attempt_id call_brief_id compilation_id transcript_revision_id source_hash plan_hash evaluator_version status conversation goal reason payload_ciphertext deadline_at updated_at", calls),
  source("call_outcome_revisions", "id call_brief_id revision schema_version outcome provenance actor_user_id reason technical created_at", calls),
  source("call_feedback_revisions", "id call_brief_id user_id revision schema_version goal_result transcript_quality comment_ciphertext created_at", calls),
  source("call_preparation_requests", "id user_id status call_brief_id target_call_brief_id operation_kind failure_code created_at updated_at completed_at input_ciphertext expected_compilation_id target_revision provider_request_count", preparations),
  source("call_preparation_language_contexts", "preparation_id preferences account_preference request_version", "t.preparation_id IN (SELECT id FROM export_preparations WHERE available)", "t.preparation_id"),
  source("provider_operations", "id provider operation_type stage requested_model client_request_id call_preparation_id call_brief_id call_attempt_id recording_id durable_job_id durable_job_generation text_artifact_id parent_operation_id started_at", "t.id IN (SELECT id FROM export_operations)"),
  source("provider_operation_results", "operation_id outcome provider_request_id provider_response_id provider_model http_status error_code completed_at duration_ms", operations, "t.operation_id"),
  source("provider_usage_records", "id operation_id schema_version request_count input_text_tokens cached_input_text_tokens cache_write_input_text_tokens output_text_tokens reasoning_output_tokens input_audio_tokens cached_input_audio_tokens output_audio_tokens total_tokens duration_seconds billable_seconds raw_usage observed_at pricing_version", operations),
  source("provider_usage_supplements", "operation_id observation_key duration_seconds billable_seconds observed_at", operations, "t.operation_id,t.observation_key"),
  source("effective_provider_usage", "id operation_id schema_version request_count input_text_tokens cached_input_text_tokens cache_write_input_text_tokens output_text_tokens reasoning_output_tokens input_audio_tokens cached_input_audio_tokens output_audio_tokens total_tokens duration_seconds billable_seconds raw_usage observed_at pricing_version", operations),
  source("provider_cost_records", "id operation_id provider provider_cost_id cost_basis component amount_micros currency raw_cost observed_at", operations),
  source("durable_jobs", "id job_type recording_id call_attempt_id call_preparation_id text_artifact_id status generation attempt_count max_attempts run_after force_requested lease_expires_at last_error_code created_at updated_at completed_at", "t.id IN (SELECT id FROM export_jobs)"),
  source("durable_job_attempts", "id job_id generation attempt_number started_at completed_at outcome error_code", jobs),
  source("durable_job_admin_events", "id job_id actor_user_id action reason created_at", jobs),
  source("credit_transactions", "id user_id amount type call_attempt_id reason qualification created_at", "t.call_attempt_id IN (SELECT id FROM call_attempts WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))"),
  source("beta_spend_reservations", "reservation_key kind amount_micros currency created_at", "t.reservation_key IN (SELECT 'call:'||id::text FROM call_attempts WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available)) OR t.reservation_key IN (SELECT 'provider:'||id::text FROM export_operations)", "t.reservation_key"),
  source("approval_requests", "id call_brief_id category title reason proposed_speech status created_at decided_at", calls),
  source("audit_events", "id call_brief_id event_type metadata created_at", calls),
  source("call_sensitive_access_events", "id call_brief_id actor_user_id reason created_at", calls),
  source("call_data_deletion_events", "id call_brief_id actor_user_id provider_recording_disposition created_at", "t.call_brief_id IN (SELECT id FROM export_calls)"),
  source("provider_billing_snapshots", "id provider scope_key day currency total_micros components source observed_at", "t.day >= ($1::timestamptz AT TIME ZONE 'UTC')::date AND t.day <= (($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC')::date", "t.provider,t.day,t.observed_at,t.id")
];

// Repeated CTEs are evaluated within one REPEATABLE READ transaction. Including
// preparations selects failures before a brief exists and old plans dialled today.
export const exportScopeSql = `WITH export_calls AS MATERIALIZED (
  SELECT b.id, b.user_id, (b.data_deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=b.user_id AND u.status='deleted')
    AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=b.user_id AND d.status<>'completed')) AS available
  FROM call_briefs b WHERE EXISTS(SELECT 1 FROM call_attempts a WHERE a.call_brief_id=b.id AND a.started_at >= $1::timestamptz AND a.started_at < $2::timestamptz)
    OR EXISTS(SELECT 1 FROM call_preparation_requests p WHERE (p.call_brief_id=b.id OR p.target_call_brief_id=b.id)
      AND p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz)
), export_preparations AS MATERIALIZED (
  SELECT p.id, (NOT EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.status='deleted')
    AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=p.user_id AND d.status<>'completed')
    AND NOT EXISTS(SELECT 1 FROM call_briefs b WHERE (b.id=p.call_brief_id OR b.id=p.target_call_brief_id) AND b.data_deleted_at IS NOT NULL)) AS available
  FROM call_preparation_requests p WHERE (p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz)
    OR p.call_brief_id IN (SELECT id FROM export_calls) OR p.target_call_brief_id IN (SELECT id FROM export_calls)
), export_operations AS MATERIALIZED (
  SELECT o.id FROM provider_operations o WHERE o.call_brief_id IN (SELECT id FROM export_calls WHERE available)
    OR o.call_preparation_id IN (SELECT id FROM export_preparations WHERE available)
    OR o.call_attempt_id IN (SELECT id FROM call_attempts WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))
    OR o.recording_id IN (SELECT id FROM call_recordings WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))
    OR o.text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))
), export_jobs AS MATERIALIZED (
  SELECT j.id FROM durable_jobs j WHERE j.call_preparation_id IN (SELECT id FROM export_preparations WHERE available)
    OR j.call_attempt_id IN (SELECT id FROM call_attempts WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))
    OR j.recording_id IN (SELECT id FROM call_recordings WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))
    OR j.text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id IN (SELECT id FROM export_calls WHERE available))
)`;

export function sourceQuery(s: ExportSource) {
  // Direct field references make schema drift fail closed instead of returning nulls.
  let fields = s.fields.map(k => `'${k}',${k.endsWith("_micros") ? `t.${k}::text` : `t.${k}`}`).join(",");
  let join = "";
  if (s.table === "effective_provider_usage") {
    join = " LEFT JOIN provider_operations o ON o.id=t.operation_id LEFT JOIN provider_operation_results r ON r.operation_id=t.operation_id";
    fields += ",'provider',o.provider,'operation_type',o.operation_type,'stage',o.stage,'model',COALESCE(r.provider_model,o.requested_model)";
  }
  const available = s.table === "call_briefs" ? ", (SELECT available FROM export_calls c WHERE c.id=t.id) AS available" : "";
  return `${exportScopeSql} SELECT jsonb_build_object(${fields}) AS data${available} FROM ${s.table} t${join} WHERE ${s.where} ORDER BY ${s.order}`;
}

const safeMetadataKeys = new Set(["status", "decision", "provider", "providerStatus", "method", "revision", "compilationRevision", "recordingId", "approvalId", "reasonCode", "failureCode", "attemptId", "callAttemptId", "connected", "settlement", "credits"]);
function metadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => safeMetadataKeys.has(k) &&
    (typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && /^[a-z0-9_.:-]{1,160}$/i.test(v)))));
}
// Preserve numeric provider usage trees; only known non-text enum fields survive.
function usage(value: unknown, key = ""): unknown {
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "string") return ["source", "role", "type", "unit", "currency"].includes(key) && /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(v => usage(v)).filter(v => v !== undefined);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value!).map(([k, v]) => [k, usage(v, k)]).filter(([, v]) => v !== undefined));
  return undefined;
}
export function mapExportRow(s: ExportSource, data: Record<string, unknown>, key: DataEncryptionMaterial, available = true) {
  if (!available && s.table === "call_briefs") return { schemaVersion: 1, recordType: s.table, availability: "deleted_or_deletion_pending", data: { id: data.id, status: data.status, created_at: data.created_at, data_deleted_at: data.data_deleted_at } };
  const mapped: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(data)) {
    if (field.endsWith("_ciphertext")) mapped[field.replace(/_ciphertext$/, "")] = value === null ? null : decryptJson(String(value), key);
    else if (s.table === "audit_events" && field === "metadata") mapped[field] = metadata(value);
    else if (field === "raw_usage" || field === "raw_cost") mapped[field] = usage(value);
    else mapped[field] = value;
  }
  if (s.table === "effective_provider_usage") mapped.calculated_cost = calculatedCost(data);
  return { schemaVersion: 1, recordType: s.table, ...(s.table === "transcript_segments" ? { attribution: "legacy_unattributed", attemptId: null } : {}), data: mapped };
}

function calculatedCost(data: Record<string, unknown>) {
  const pairs = [
    ["input_text_tokens", "inputTextTokens", "inputTextTokenSamples"], ["cached_input_text_tokens", "cachedInputTextTokens", "cachedInputTextTokenSamples"],
    ["cache_write_input_text_tokens", "cacheWriteInputTextTokens", "cacheWriteInputTextTokenSamples"], ["output_text_tokens", "outputTextTokens", "outputTextTokenSamples"],
    ["reasoning_output_tokens", "reasoningOutputTokens", "reasoningOutputTokenSamples"], ["input_audio_tokens", "inputAudioTokens", "inputAudioTokenSamples"],
    ["cached_input_audio_tokens", "cachedInputAudioTokens", "cachedInputAudioTokenSamples"], ["output_audio_tokens", "outputAudioTokens", "outputAudioTokenSamples"],
    ["total_tokens", "totalTokens", "totalTokenSamples"], ["duration_seconds", "durationSeconds", "durationSamples"], ["billable_seconds", "billableSeconds", "billableSamples"]
  ];
  const metrics: Record<string, number> = {};
  for (const [column, amount, samples] of pairs) { metrics[amount!] = Number(data[column!] ?? 0); metrics[samples!] = data[column!] == null ? 0 : 1; }
  const cost = calculateProviderUsageCost({ ...metrics, provider: String(data.provider), model: String(data.model), operationType: String(data.operation_type),
    stage: String(data.stage), pricingVersion: String(data.pricing_version), usageRecords: 1, requestCount: Number(data.request_count ?? 0) } as AdminProviderUsageBucket);
  return { basis: "versioned_public_rates", currency: "USD", pricingVersion: cost.pricingVersion,
    amountMicros: cost.calculatedUsdMicros === null ? null : String(cost.calculatedUsdMicros), unpricedMetrics: cost.unpricedMetrics,
    matched: cost.matched, complete: cost.calculatedUsdMicros !== null && cost.unpricedMetrics.length === 0 };
}
