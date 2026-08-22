ALTER TABLE call_briefs
  ADD COLUMN data_deleted_at timestamptz;

CREATE INDEX call_briefs_owner_visible_created_at_idx
  ON call_briefs(user_id, created_at DESC, id DESC)
  WHERE data_deleted_at IS NULL;

ALTER TABLE call_recordings
  ALTER COLUMN provider_call_id DROP NOT NULL;

ALTER TABLE durable_jobs
  DROP CONSTRAINT durable_jobs_status_check;

ALTER TABLE durable_jobs
  ADD CONSTRAINT durable_jobs_status_check CHECK (status IN (
    'queued',
    'running',
    'succeeded',
    'dead_letter',
    'cancelled'
  ));

ALTER TABLE durable_job_attempts
  DROP CONSTRAINT durable_job_attempts_outcome_check;

ALTER TABLE durable_job_attempts
  ADD CONSTRAINT durable_job_attempts_outcome_check CHECK (outcome IN (
    'succeeded',
    'retry_scheduled',
    'dead_letter',
    'lease_expired',
    'cancelled'
  ));

CREATE TABLE call_data_deletion_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  call_brief_id uuid NOT NULL UNIQUE REFERENCES call_briefs(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_recording_disposition varchar(24) NOT NULL CHECK (
    provider_recording_disposition IN (
      'not_present',
      'already_deleted',
      'deleted'
    )
  ),
  created_at timestamptz NOT NULL
);

CREATE INDEX call_data_deletion_events_actor_created_at_idx
  ON call_data_deletion_events(actor_user_id, created_at DESC);

CREATE FUNCTION prevent_call_data_deletion_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'call_data_deletion_events are immutable';
END;
$$;

CREATE TRIGGER call_data_deletion_events_immutable
BEFORE UPDATE OR DELETE ON call_data_deletion_events
FOR EACH ROW EXECUTE FUNCTION prevent_call_data_deletion_event_mutation();

CREATE OR REPLACE FUNCTION prevent_call_outcome_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    TG_TABLE_NAME = 'call_feedback_revisions'
    AND TG_OP = 'UPDATE'
    AND NEW.comment_ciphertext IS NULL
    AND (to_jsonb(NEW) - 'comment_ciphertext') =
      (to_jsonb(OLD) - 'comment_ciphertext')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'call outcome and feedback revisions are immutable';
END;
$$;
