CREATE TABLE provider_cost_records (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES provider_operations(id) ON DELETE RESTRICT,
  provider varchar(40) NOT NULL CHECK (provider ~ '^[a-z0-9_.-]{1,40}$'),
  provider_cost_id varchar(240) NOT NULL CHECK (length(btrim(provider_cost_id)) > 0),
  cost_basis varchar(40) NOT NULL CHECK (cost_basis = 'provider_reported_actual'),
  component varchar(80) NOT NULL CHECK (component ~ '^[a-z0-9_.-]{1,80}$'),
  amount_micros bigint NOT NULL CHECK (amount_micros >= 0),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  raw_cost jsonb NOT NULL CHECK (
    jsonb_typeof(raw_cost) = 'object'
    AND octet_length(raw_cost::text) <= 4096
  ),
  observed_at timestamptz NOT NULL,
  UNIQUE (provider, provider_cost_id),
  UNIQUE (operation_id, cost_basis, component)
);

CREATE INDEX provider_cost_records_observed_idx
  ON provider_cost_records(observed_at, id);

CREATE TRIGGER provider_cost_records_immutable
BEFORE UPDATE OR DELETE ON provider_cost_records
FOR EACH ROW EXECUTE FUNCTION prevent_provider_ledger_mutation();

ALTER TABLE durable_jobs
  DROP CONSTRAINT durable_jobs_job_type_check,
  DROP CONSTRAINT durable_jobs_target_check;

ALTER TABLE durable_jobs
  ADD CONSTRAINT durable_jobs_job_type_check CHECK (job_type IN (
    'brief_compilation',
    'final_transcription',
    'recording_retention',
    'provider_call_reconciliation',
    'provider_call_cost_reconciliation',
    'provider_recording_reconciliation'
  )),
  ADD CONSTRAINT durable_jobs_target_check CHECK (
    (
      job_type = 'brief_compilation'
      AND call_preparation_id IS NOT NULL
      AND call_attempt_id IS NULL
      AND recording_id IS NULL
    )
    OR
    (
      job_type IN (
        'provider_call_reconciliation',
        'provider_call_cost_reconciliation'
      )
      AND call_preparation_id IS NULL
      AND call_attempt_id IS NOT NULL
      AND recording_id IS NULL
    )
    OR
    (
      job_type IN (
        'final_transcription',
        'recording_retention',
        'provider_recording_reconciliation'
      )
      AND call_preparation_id IS NULL
      AND recording_id IS NOT NULL
      AND call_attempt_id IS NULL
    )
  );

INSERT INTO durable_jobs (
  id, job_type, call_attempt_id, status, max_attempts, run_after
)
SELECT
  gen_random_uuid(),
  'provider_call_cost_reconciliation',
  call_attempts.id,
  'queued',
  10,
  now()
FROM call_attempts
WHERE call_attempts.provider = 'twilio'
  AND call_attempts.provider_call_id IS NOT NULL
  AND call_attempts.status IN ('completed', 'failed', 'stopped')
ON CONFLICT (job_type, call_attempt_id)
  WHERE call_attempt_id IS NOT NULL
DO NOTHING;
