CREATE TABLE post_call_transcription_chunks (
  id uuid PRIMARY KEY,
  recording_id uuid NOT NULL
    REFERENCES call_recordings(id) ON DELETE RESTRICT,
  durable_job_generation integer NOT NULL CHECK (durable_job_generation > 0),
  stage varchar(80) NOT NULL CHECK (
    stage IN ('full_recording', 'assistant_utterance', 'recipient_utterance')
  ),
  chunk_key varchar(80) NOT NULL CHECK (
    chunk_key ~ '^[a-z0-9_]{1,80}$'
  ),
  input_fingerprint char(64) NOT NULL CHECK (
    input_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  requested_model varchar(160) NOT NULL CHECK (
    length(btrim(requested_model)) > 0
  ),
  provider_operation_id uuid NOT NULL UNIQUE
    REFERENCES provider_operations(id) ON DELETE RESTRICT,
  text_ciphertext text NOT NULL CHECK (length(text_ciphertext) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (
    recording_id,
    durable_job_generation,
    chunk_key,
    input_fingerprint
  )
);

CREATE INDEX post_call_transcription_chunks_recording_generation_idx
  ON post_call_transcription_chunks(
    recording_id,
    durable_job_generation,
    chunk_key
  );
