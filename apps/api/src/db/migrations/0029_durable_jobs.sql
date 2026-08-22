CREATE TABLE durable_jobs (
  id uuid PRIMARY KEY,
  job_type varchar(40) NOT NULL CHECK (job_type IN (
    'final_transcription',
    'recording_retention'
  )),
  recording_id uuid NOT NULL REFERENCES call_recordings(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL CHECK (status IN (
    'queued',
    'running',
    'succeeded',
    'dead_letter'
  )),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  run_after timestamptz NOT NULL,
  force_requested boolean NOT NULL DEFAULT false,
  lease_owner varchar(120),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (job_type, recording_id),
  CHECK (
    status = 'running'
      OR (lease_owner IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    status <> 'running'
      OR (lease_owner IS NOT NULL AND leased_at IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX durable_jobs_due_idx
  ON durable_jobs(run_after ASC, created_at ASC)
  WHERE status = 'queued';

CREATE INDEX durable_jobs_status_updated_idx
  ON durable_jobs(status, updated_at DESC);

CREATE TABLE durable_job_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES durable_jobs(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id varchar(120) NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  outcome varchar(24) NOT NULL CHECK (outcome IN (
    'succeeded',
    'retry_scheduled',
    'dead_letter',
    'lease_expired'
  )),
  error_code varchar(160),
  UNIQUE (job_id, generation, attempt_number)
);

CREATE INDEX durable_job_attempts_job_time_idx
  ON durable_job_attempts(job_id, completed_at DESC);

CREATE FUNCTION prevent_durable_job_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'durable_job_attempts are immutable';
END;
$$;

CREATE TRIGGER durable_job_attempts_immutable
BEFORE UPDATE OR DELETE ON durable_job_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_durable_job_attempt_mutation();

INSERT INTO durable_jobs (
  id,
  job_type,
  recording_id,
  status,
  max_attempts,
  run_after
)
SELECT
  gen_random_uuid(),
  'final_transcription',
  call_recordings.id,
  'queued',
  3,
  now()
FROM call_recordings
LEFT JOIN final_transcripts
  ON final_transcripts.call_recording_id = call_recordings.id
WHERE call_recordings.status = 'available'
  AND (
    final_transcripts.id IS NULL
    OR final_transcripts.status IN ('processing', 'failed')
  )
ON CONFLICT (job_type, recording_id) DO NOTHING;

INSERT INTO durable_jobs (
  id,
  job_type,
  recording_id,
  status,
  max_attempts,
  run_after
)
SELECT
  gen_random_uuid(),
  'recording_retention',
  call_recordings.id,
  'queued',
  5,
  call_recordings.delete_after
FROM call_recordings
INNER JOIN final_transcripts
  ON final_transcripts.call_recording_id = call_recordings.id
  AND final_transcripts.status = 'completed'
WHERE call_recordings.status = 'available'
  AND call_recordings.delete_after IS NOT NULL
ON CONFLICT (job_type, recording_id) DO NOTHING;
