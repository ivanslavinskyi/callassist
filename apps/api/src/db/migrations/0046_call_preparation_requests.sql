CREATE TABLE call_preparation_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  input_fingerprint varchar(64) NOT NULL CHECK (
    input_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  input_ciphertext text,
  status varchar(24) NOT NULL CHECK (status IN (
    'queued',
    'processing',
    'retrying',
    'succeeded',
    'failed',
    'cancelled'
  )),
  call_brief_id uuid UNIQUE REFERENCES call_briefs(id),
  failure_code varchar(160) CHECK (
    failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,160}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, idempotency_key),
  CHECK (
    (status IN ('queued', 'processing', 'retrying') AND input_ciphertext IS NOT NULL)
    OR
    (status IN ('succeeded', 'failed', 'cancelled') AND input_ciphertext IS NULL)
  ),
  CHECK ((status = 'succeeded') = (call_brief_id IS NOT NULL)),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  CHECK (
    (status IN ('succeeded', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
  )
);

CREATE INDEX call_preparation_requests_owner_time_idx
  ON call_preparation_requests(user_id, created_at DESC);

CREATE INDEX call_preparation_requests_active_idx
  ON call_preparation_requests(updated_at ASC)
  WHERE status IN ('queued', 'processing', 'retrying');

ALTER TABLE durable_jobs
  DROP CONSTRAINT durable_jobs_job_type_check,
  DROP CONSTRAINT durable_jobs_target_check,
  ADD COLUMN call_preparation_id uuid
    REFERENCES call_preparation_requests(id) ON DELETE CASCADE;

ALTER TABLE durable_jobs
  ADD CONSTRAINT durable_jobs_job_type_check CHECK (job_type IN (
    'brief_compilation',
    'final_transcription',
    'recording_retention',
    'provider_call_reconciliation',
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
      job_type = 'provider_call_reconciliation'
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

CREATE UNIQUE INDEX durable_jobs_type_preparation_idx
  ON durable_jobs(job_type, call_preparation_id)
  WHERE call_preparation_id IS NOT NULL;
