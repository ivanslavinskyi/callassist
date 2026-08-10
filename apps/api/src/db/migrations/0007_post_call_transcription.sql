ALTER TABLE call_briefs
ADD COLUMN audio_retention_days smallint NOT NULL DEFAULT 7;

ALTER TABLE call_briefs
ADD CONSTRAINT call_briefs_audio_retention_days_check
CHECK (audio_retention_days IN (0, 7, 30));

CREATE TABLE call_recordings (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL UNIQUE REFERENCES call_briefs(id) ON DELETE CASCADE,
  call_attempt_id uuid NOT NULL REFERENCES call_attempts(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL CHECK (provider IN ('twilio')),
  provider_call_id text NOT NULL,
  provider_recording_id text UNIQUE,
  status varchar(32) NOT NULL CHECK (
    status IN (
      'starting',
      'recording',
      'processing',
      'available',
      'failed',
      'deleted'
    )
  ),
  consent_granted_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  channels smallint CHECK (channels IS NULL OR channels > 0),
  delete_after timestamptz,
  deleted_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX call_recordings_expiry_idx
  ON call_recordings(delete_after)
  WHERE status = 'available' AND delete_after IS NOT NULL;

CREATE TABLE final_transcripts (
  id uuid PRIMARY KEY,
  call_recording_id uuid NOT NULL UNIQUE REFERENCES call_recordings(id) ON DELETE CASCADE,
  status varchar(32) NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  model text NOT NULL,
  text_ciphertext text,
  failure_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX final_transcripts_status_idx
  ON final_transcripts(status, updated_at);
