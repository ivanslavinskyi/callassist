ALTER TABLE durable_jobs
  DROP CONSTRAINT durable_jobs_job_type_check;

ALTER TABLE durable_jobs
  ALTER COLUMN recording_id DROP NOT NULL,
  ADD COLUMN call_attempt_id uuid REFERENCES call_attempts(id) ON DELETE CASCADE;

ALTER TABLE durable_jobs
  ADD CONSTRAINT durable_jobs_job_type_check CHECK (job_type IN (
    'final_transcription',
    'recording_retention',
    'provider_call_reconciliation',
    'provider_recording_reconciliation'
  )),
  ADD CONSTRAINT durable_jobs_target_check CHECK (
    (
      job_type = 'provider_call_reconciliation'
      AND call_attempt_id IS NOT NULL
      AND recording_id IS NULL
    )
    OR
    (
      job_type <> 'provider_call_reconciliation'
      AND recording_id IS NOT NULL
      AND call_attempt_id IS NULL
    )
  );

CREATE UNIQUE INDEX durable_jobs_type_attempt_idx
  ON durable_jobs(job_type, call_attempt_id)
  WHERE call_attempt_id IS NOT NULL;

INSERT INTO durable_jobs (
  id,
  job_type,
  call_attempt_id,
  status,
  max_attempts,
  run_after
)
SELECT
  gen_random_uuid(),
  'provider_call_reconciliation',
  call_attempts.id,
  'queued',
  5,
  now()
FROM call_attempts
JOIN call_briefs ON call_briefs.id = call_attempts.call_brief_id
WHERE call_attempts.provider = 'twilio'
  AND call_attempts.provider_call_id IS NOT NULL
  AND call_briefs.status IN ('dialing', 'in_progress', 'awaiting_approval')
ON CONFLICT (job_type, call_attempt_id)
  WHERE call_attempt_id IS NOT NULL
DO NOTHING;

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
  'provider_recording_reconciliation',
  call_recordings.id,
  'queued',
  5,
  now()
FROM call_recordings
WHERE call_recordings.provider_recording_id IS NOT NULL
  AND call_recordings.status IN ('recording', 'processing')
ON CONFLICT (job_type, recording_id) DO NOTHING;
