-- Additive readers: no rewrite of historical approvals, prompts or recordings.
ALTER TABLE call_recordings ALTER COLUMN consent_granted_at DROP NOT NULL;
ALTER TABLE call_recordings ADD COLUMN recording_basis text NOT NULL DEFAULT 'affirmative_consent'
  CHECK(recording_basis IN ('affirmative_consent','declarative_local'));
ALTER TABLE call_recordings ADD CONSTRAINT recording_consent_basis CHECK
  ((recording_basis='affirmative_consent' AND consent_granted_at IS NOT NULL) OR
   (recording_basis='declarative_local' AND consent_granted_at IS NULL));

CREATE TABLE live_attempt_privacy (
  call_attempt_id uuid PRIMARY KEY REFERENCES call_attempts(id) ON DELETE CASCADE,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL UNIQUE,
  provider_call_id text,
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','discard_requested','discarded')),
  reason text CHECK(reason IN ('conversation_refused','recording_refused','transcription_refused','owner_deleted')),
  generation integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(), cleanup_attempts integer NOT NULL DEFAULT 0, last_error_code text,
  requested_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_discard_pending ON live_attempt_privacy(updated_at) WHERE state='discard_requested';
CREATE TABLE live_trace_events (
  call_attempt_id uuid NOT NULL REFERENCES call_attempts(id) ON DELETE CASCADE,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  trace_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence>0), direction text NOT NULL CHECK(direction IN ('in','out','host')),
  event_type text NOT NULL, observed_at timestamptz NOT NULL, elapsed_ms bigint NOT NULL CHECK(elapsed_ms>=0),
  byte_length integer NOT NULL CHECK(byte_length>=0), schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  PRIMARY KEY(call_attempt_id,trace_id,sequence)
);
CREATE TABLE live_trace_payloads (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  call_attempt_id uuid NOT NULL, trace_id uuid NOT NULL, sequence bigint NOT NULL, payload_ciphertext text NOT NULL,
  PRIMARY KEY(call_attempt_id,trace_id,sequence), FOREIGN KEY(call_attempt_id,trace_id,sequence)
    REFERENCES live_trace_events(call_attempt_id,trace_id,sequence) ON DELETE CASCADE
);

-- Serialize conversation writes with the parent lock used by a refusal. A late
-- worker cannot restore payloads after the tombstone transaction commits.
CREATE FUNCTION guard_discarded_live_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb:=to_jsonb(NEW); attempt_id uuid; brief_id uuid; discarded boolean;
BEGIN
  attempt_id:=NULLIF(row_data->>'call_attempt_id','')::uuid;
  brief_id:=NULLIF(row_data->>'call_brief_id','')::uuid;
  IF brief_id IS NULL AND attempt_id IS NOT NULL THEN SELECT call_brief_id INTO brief_id FROM call_attempts WHERE id=attempt_id; END IF;
  IF TG_TABLE_NAME='post_call_transcription_chunks' THEN
    SELECT call_brief_id,call_attempt_id INTO brief_id,attempt_id FROM call_recordings WHERE id=(row_data->>'recording_id')::uuid;
  ELSIF TG_TABLE_NAME='call_text_artifact_chunks' THEN
    SELECT a.call_brief_id,r.call_attempt_id INTO brief_id,attempt_id FROM call_text_artifacts a LEFT JOIN final_transcript_revisions r ON r.id=a.transcript_revision_id
      WHERE a.id=(row_data->>'artifact_id')::uuid AND a.kind IN ('call_summary','transcript_translation');
  ELSIF TG_TABLE_NAME='call_text_artifacts' AND row_data->>'kind' NOT IN ('call_summary','transcript_translation') THEN RETURN NEW;
  END IF;
  IF brief_id IS NULL THEN RETURN NEW; END IF;
  PERFORM id FROM call_briefs WHERE id=brief_id FOR SHARE;
  SELECT EXISTS(SELECT 1 FROM live_attempt_privacy WHERE call_brief_id=brief_id AND state<>'active'
    AND (attempt_id IS NULL OR call_attempt_id=attempt_id)) INTO discarded;
  IF NOT discarded THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='user_call_notifications' THEN
    IF TG_OP='INSERT' THEN RETURN NULL; END IF;
    NEW.payload_ciphertext:=NULL; NEW.status:='cancelled'; NEW.lease_owner:=NULL; NEW.lease_until:=NULL; RETURN NEW;
  END IF;
  IF TG_OP='INSERT' OR EXISTS(SELECT 1 FROM jsonb_each(row_data) e
    WHERE e.key IN ('text','text_ciphertext','segments_ciphertext','payload_ciphertext','context_ciphertext') AND e.value<>'null'::jsonb) THEN
    RAISE EXCEPTION 'LIVE_CONVERSATION_DISCARDED' USING ERRCODE='23000';
  END IF;
  RETURN NEW;
END; $$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['transcript_segments','final_transcripts','final_transcript_revisions','post_call_transcription_chunks',
    'call_text_artifacts','call_text_artifact_chunks','call_assessments','call_assessment_revisions','call_terminal_decisions',
    'call_voice_actions','user_call_notifications','live_trace_events','live_trace_payloads'] LOOP
    EXECUTE format('CREATE TRIGGER live_content_fence BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_discarded_live_content()',table_name);
  END LOOP;
END; $$;

CREATE FUNCTION discard_live_conversation(attempt_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE brief_id uuid; BEGIN
  SELECT call_brief_id INTO brief_id FROM live_attempt_privacy WHERE call_attempt_id=attempt_id AND state<>'active';
  IF brief_id IS NULL THEN RAISE EXCEPTION 'LIVE_DISCARD_TOMBSTONE_REQUIRED'; END IF;
  DELETE FROM live_trace_events WHERE call_attempt_id=attempt_id;
  DELETE FROM transcript_segments WHERE call_attempt_id=attempt_id;
  UPDATE call_attempts SET native_transcript_capture=NULL WHERE id=attempt_id;
  UPDATE post_call_transcription_chunks SET text_ciphertext=NULL WHERE recording_id IN (SELECT id FROM call_recordings WHERE call_attempt_id=attempt_id);
  UPDATE final_transcripts SET text_ciphertext=NULL,segments_ciphertext=NULL WHERE call_attempt_id=attempt_id;
  UPDATE final_transcript_revisions SET payload_ciphertext=NULL WHERE call_attempt_id=attempt_id;
  UPDATE call_terminal_decisions SET payload_ciphertext=NULL WHERE call_attempt_id=attempt_id;
  UPDATE call_assessment_revisions SET payload_ciphertext=NULL WHERE call_attempt_id=attempt_id;
  UPDATE call_assessments SET payload_ciphertext=NULL,status='unavailable',conversation=NULL,goal=NULL,reason='evidence_uncertain' WHERE call_attempt_id=attempt_id;
  UPDATE call_voice_actions SET payload_ciphertext=NULL WHERE call_attempt_id=attempt_id;
  UPDATE call_text_artifact_chunks SET payload_ciphertext=NULL WHERE artifact_id IN
    (SELECT id FROM call_text_artifacts WHERE call_brief_id=brief_id AND kind IN ('call_summary','transcript_translation'));
  UPDATE call_text_artifacts SET payload_ciphertext=NULL,context_ciphertext=NULL,status='cancelled',updated_at=now()
    WHERE call_brief_id=brief_id AND kind IN ('call_summary','transcript_translation');
  UPDATE user_call_notifications SET payload_ciphertext=NULL,status='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE call_attempt_id=attempt_id;
  UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now(),last_error_code='conversation_discarded'
    WHERE status IN ('queued','running') AND (call_attempt_id=attempt_id AND job_type IN ('live_transcript_finalization') OR
      recording_id IN (SELECT id FROM call_recordings WHERE call_attempt_id=attempt_id) AND job_type IN ('final_transcription','recording_retention') OR
      text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id=brief_id AND kind IN ('call_summary','transcript_translation')));
END; $$;

CREATE FUNCTION fence_live_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM live_attempt_privacy WHERE call_attempt_id=NEW.id AND state<>'active') THEN NEW.native_transcript_capture:=NULL; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_capture_fence BEFORE UPDATE OF native_transcript_capture ON call_attempts FOR EACH ROW EXECUTE FUNCTION fence_live_capture();

-- Owner deletion also erases the new channel and schedules provider cleanup.
CREATE FUNCTION redact_live_trace_on_owner_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.data_deleted_at IS NOT NULL THEN
    UPDATE live_attempt_privacy SET state='discard_requested',generation=generation+1,next_retry_at=now(),reason=COALESCE(reason,'owner_deleted'),requested_at=COALESCE(requested_at,now()),updated_at=now() WHERE call_brief_id=NEW.id;
    DELETE FROM live_trace_events WHERE call_brief_id=NEW.id;
  END IF; RETURN NEW;
END; $$;
CREATE TRIGGER live_owner_deletion AFTER UPDATE OF data_deleted_at ON call_briefs FOR EACH ROW EXECUTE FUNCTION redact_live_trace_on_owner_deletion();

CREATE TRIGGER live_discard_revoke_exports AFTER UPDATE OF state ON live_attempt_privacy
  FOR EACH ROW WHEN (NEW.state='discard_requested' AND OLD.state='active')
  EXECUTE FUNCTION invalidate_admin_telemetry_exports();
