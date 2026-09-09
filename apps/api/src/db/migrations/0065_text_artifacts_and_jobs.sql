CREATE TABLE final_transcript_revisions (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE RESTRICT,
  transcript_id uuid NOT NULL REFERENCES final_transcripts(id) ON DELETE RESTRICT,
  call_attempt_id uuid REFERENCES call_attempts(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  source_hash varchar(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  payload_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transcript_id, revision), UNIQUE (transcript_id, source_hash),
  UNIQUE (id, call_brief_id)
);
ALTER TABLE final_transcripts ADD COLUMN current_revision_id uuid REFERENCES final_transcript_revisions(id);

CREATE TABLE call_text_artifacts (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE RESTRICT,
  kind varchar(40) NOT NULL CHECK (kind IN ('plan_review','clarification_review','transcript_translation','call_summary')),
  compilation_id uuid REFERENCES call_compilations(id) ON DELETE RESTRICT,
  transcript_revision_id uuid REFERENCES final_transcript_revisions(id) ON DELETE RESTRICT,
  source_hash varchar(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  target_language varchar(35) NOT NULL,
  generator_version varchar(180) NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN ('queued','processing','ready','failed','stale','cancelled')),
  payload_ciphertext text,
  payload_hash varchar(64) CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  failure_code varchar(160),
  provider_request_count integer NOT NULL DEFAULT 0 CHECK (provider_request_count BETWEEN 0 AND 24),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind IN ('plan_review','clarification_review') AND compilation_id IS NOT NULL AND transcript_revision_id IS NULL)
    OR (kind IN ('transcript_translation','call_summary') AND transcript_revision_id IS NOT NULL)),
  CHECK (kind <> 'call_summary' OR compilation_id IS NOT NULL),
  FOREIGN KEY (compilation_id, call_brief_id) REFERENCES call_compilations(id, call_brief_id),
  FOREIGN KEY (transcript_revision_id, call_brief_id) REFERENCES final_transcript_revisions(id, call_brief_id)
);
CREATE UNIQUE INDEX call_text_artifacts_source_identity_idx ON call_text_artifacts
  (call_brief_id, kind, COALESCE(compilation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(transcript_revision_id, '00000000-0000-0000-0000-000000000000'::uuid), source_hash, target_language, generator_version);
CREATE INDEX call_text_artifacts_call_idx ON call_text_artifacts(call_brief_id, created_at);

CREATE TABLE call_text_artifact_chunks (
  id uuid PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES call_text_artifacts(id) ON DELETE RESTRICT,
  chunk_index integer NOT NULL CHECK (chunk_index BETWEEN 0 AND 23),
  payload_ciphertext text,
  payload_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, chunk_index)
);

CREATE FUNCTION prevent_text_source_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'payload_ciphertext') = (to_jsonb(OLD) - 'payload_ciphertext')
    AND (NEW.payload_ciphertext IS NULL OR (OLD.payload_ciphertext IS NOT NULL
      AND current_setting('callassist.encryption_rotation', true) = 'enabled'))
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'text source and chunk payloads are immutable';
END; $$;
CREATE TRIGGER final_transcript_revisions_immutable BEFORE UPDATE OR DELETE ON final_transcript_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_text_source_mutation();
CREATE TRIGGER call_text_artifact_chunks_immutable BEFORE UPDATE OR DELETE ON call_text_artifact_chunks
  FOR EACH ROW EXECUTE FUNCTION prevent_text_source_mutation();

CREATE FUNCTION prevent_ready_text_artifact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','payload_ciphertext','payload_hash','failure_code','updated_at','provider_request_count']) <>
    (to_jsonb(OLD) - ARRAY['status','payload_ciphertext','payload_hash','failure_code','updated_at','provider_request_count']) THEN
    RAISE EXCEPTION 'text artifact identity is immutable';
  END IF;
  IF OLD.status IN ('ready','stale','cancelled') AND NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
    THEN RAISE EXCEPTION 'completed text artifact hash is immutable'; END IF;
  IF OLD.status = 'cancelled' AND (NEW.status <> 'cancelled' OR (OLD.payload_ciphertext IS NULL AND NEW.payload_ciphertext IS NOT NULL))
    THEN RAISE EXCEPTION 'cancelled text artifact cannot be restored'; END IF;
  IF OLD.payload_ciphertext IS NOT NULL AND NEW.payload_ciphertext IS DISTINCT FROM OLD.payload_ciphertext
    AND NEW.payload_ciphertext IS NOT NULL AND current_setting('callassist.encryption_rotation', true) IS DISTINCT FROM 'enabled'
  THEN RAISE EXCEPTION 'completed text payload is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER call_text_artifacts_immutable_payload BEFORE UPDATE ON call_text_artifacts
  FOR EACH ROW EXECUTE FUNCTION prevent_ready_text_artifact_mutation();

ALTER TABLE durable_jobs ADD COLUMN text_artifact_id uuid REFERENCES call_text_artifacts(id) ON DELETE RESTRICT;
ALTER TABLE durable_jobs DROP CONSTRAINT durable_jobs_job_type_check, DROP CONSTRAINT durable_jobs_target_check;
ALTER TABLE durable_jobs ADD CONSTRAINT durable_jobs_job_type_check CHECK (job_type IN (
  'brief_compilation','final_transcription','recording_retention','provider_call_reconciliation',
  'provider_call_cost_reconciliation','provider_recording_reconciliation','text_artifact_generation'));
ALTER TABLE durable_jobs ADD CONSTRAINT durable_jobs_target_check CHECK (
  (job_type = 'text_artifact_generation' AND text_artifact_id IS NOT NULL AND recording_id IS NULL AND call_attempt_id IS NULL AND call_preparation_id IS NULL)
  OR (text_artifact_id IS NULL AND (
    (job_type = 'brief_compilation' AND call_preparation_id IS NOT NULL AND call_attempt_id IS NULL AND recording_id IS NULL)
    OR (job_type IN ('provider_call_reconciliation','provider_call_cost_reconciliation') AND call_attempt_id IS NOT NULL AND call_preparation_id IS NULL AND recording_id IS NULL)
    OR (job_type IN ('final_transcription','recording_retention','provider_recording_reconciliation') AND recording_id IS NOT NULL AND call_attempt_id IS NULL AND call_preparation_id IS NULL)
  )));
CREATE UNIQUE INDEX durable_jobs_text_artifact_idx ON durable_jobs(job_type, text_artifact_id) WHERE text_artifact_id IS NOT NULL;
ALTER TABLE durable_jobs ADD CONSTRAINT durable_jobs_text_attempt_limit CHECK
  (job_type <> 'text_artifact_generation' OR (max_attempts <= 3 AND generation <= 3));

ALTER TABLE provider_operations ADD COLUMN text_artifact_id uuid REFERENCES call_text_artifacts(id) ON DELETE RESTRICT;
ALTER TABLE provider_operations DROP CONSTRAINT provider_operations_operation_type_check;
ALTER TABLE provider_operations ADD CONSTRAINT provider_operations_operation_type_check CHECK (operation_type IN (
  'brief_moderation','brief_compilation','realtime_session','realtime_response','telephony_leg','transcription','text_translation','call_summary'));
CREATE INDEX provider_operations_text_artifact_idx ON provider_operations(text_artifact_id, started_at) WHERE text_artifact_id IS NOT NULL;
