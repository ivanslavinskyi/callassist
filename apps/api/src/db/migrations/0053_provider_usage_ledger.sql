CREATE TABLE provider_operations (
  id uuid PRIMARY KEY,
  provider varchar(40) NOT NULL CHECK (provider ~ '^[a-z0-9_.-]{1,40}$'),
  operation_type varchar(80) NOT NULL CHECK (
    operation_type IN (
      'brief_moderation',
      'brief_compilation',
      'realtime_session',
      'realtime_response',
      'telephony_leg',
      'transcription'
    )
  ),
  stage varchar(80) NOT NULL CHECK (stage ~ '^[a-z0-9_.-]{1,80}$'),
  requested_model varchar(160) NOT NULL CHECK (length(btrim(requested_model)) > 0),
  client_request_id varchar(200) NOT NULL CHECK (length(btrim(client_request_id)) > 0),
  call_preparation_id uuid REFERENCES call_preparation_requests(id) ON DELETE RESTRICT,
  call_brief_id uuid REFERENCES call_briefs(id) ON DELETE RESTRICT,
  call_attempt_id uuid REFERENCES call_attempts(id) ON DELETE RESTRICT,
  recording_id uuid REFERENCES call_recordings(id) ON DELETE RESTRICT,
  durable_job_id uuid REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  durable_job_generation integer CHECK (durable_job_generation > 0),
  started_at timestamptz NOT NULL,
  UNIQUE (provider, client_request_id),
  CHECK (
    call_preparation_id IS NOT NULL
    OR call_brief_id IS NOT NULL
    OR call_attempt_id IS NOT NULL
    OR recording_id IS NOT NULL
  ),
  CHECK ((durable_job_id IS NULL) = (durable_job_generation IS NULL))
);

CREATE INDEX provider_operations_preparation_time_idx
  ON provider_operations(call_preparation_id, started_at, id)
  WHERE call_preparation_id IS NOT NULL;

CREATE INDEX provider_operations_call_time_idx
  ON provider_operations(call_brief_id, started_at, id)
  WHERE call_brief_id IS NOT NULL;

CREATE TABLE provider_operation_results (
  operation_id uuid PRIMARY KEY REFERENCES provider_operations(id) ON DELETE RESTRICT,
  outcome varchar(40) NOT NULL CHECK (
    outcome IN ('succeeded', 'provider_error', 'network_error', 'invalid_response')
  ),
  provider_request_id varchar(200),
  provider_response_id varchar(200),
  provider_model varchar(160),
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  error_code varchar(160) CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,160}$'
  ),
  completed_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0)
);

CREATE UNIQUE INDEX provider_operation_results_provider_request_idx
  ON provider_operation_results(provider_request_id)
  WHERE provider_request_id IS NOT NULL;

CREATE UNIQUE INDEX provider_operation_results_provider_response_idx
  ON provider_operation_results(provider_response_id)
  WHERE provider_response_id IS NOT NULL;

CREATE TABLE provider_usage_records (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE
    REFERENCES provider_operations(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  request_count integer CHECK (request_count >= 0),
  input_text_tokens integer CHECK (input_text_tokens >= 0),
  cached_input_text_tokens integer CHECK (
    cached_input_text_tokens >= 0 AND (
      input_text_tokens IS NULL
      OR cached_input_text_tokens <= input_text_tokens
    )
  ),
  cache_write_input_text_tokens integer CHECK (
    cache_write_input_text_tokens >= 0
  ),
  output_text_tokens integer CHECK (output_text_tokens >= 0),
  reasoning_output_tokens integer CHECK (
    reasoning_output_tokens >= 0 AND (
      output_text_tokens IS NULL
      OR reasoning_output_tokens <= output_text_tokens
    )
  ),
  input_audio_tokens integer CHECK (input_audio_tokens >= 0),
  cached_input_audio_tokens integer CHECK (cached_input_audio_tokens >= 0),
  output_audio_tokens integer CHECK (output_audio_tokens >= 0),
  total_tokens integer CHECK (total_tokens >= 0),
  duration_seconds numeric(14,3) CHECK (duration_seconds >= 0),
  billable_seconds numeric(14,3) CHECK (billable_seconds >= 0),
  raw_usage jsonb NOT NULL CHECK (
    jsonb_typeof(raw_usage) = 'object'
    AND octet_length(raw_usage::text) <= 16384
  ),
  observed_at timestamptz NOT NULL,
  CHECK (
    request_count IS NOT NULL
    OR input_text_tokens IS NOT NULL
    OR input_audio_tokens IS NOT NULL
    OR duration_seconds IS NOT NULL
    OR billable_seconds IS NOT NULL
  )
);

CREATE FUNCTION prevent_provider_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER provider_operations_immutable
BEFORE UPDATE OR DELETE ON provider_operations
FOR EACH ROW EXECUTE FUNCTION prevent_provider_ledger_mutation();

CREATE TRIGGER provider_operation_results_immutable
BEFORE UPDATE OR DELETE ON provider_operation_results
FOR EACH ROW EXECUTE FUNCTION prevent_provider_ledger_mutation();

CREATE TRIGGER provider_usage_records_immutable
BEFORE UPDATE OR DELETE ON provider_usage_records
FOR EACH ROW EXECUTE FUNCTION prevent_provider_ledger_mutation();
