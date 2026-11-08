-- Scope refusal to its attempt, including late writes to derived artifacts.
-- Keep earlier attempts' summaries and translations intact. Legacy artifacts
-- without an attributable attempt are conservatively redacted.

CREATE OR REPLACE FUNCTION guard_discarded_live_content() RETURNS trigger LANGUAGE plpgsql AS $$
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
  ELSIF TG_TABLE_NAME='call_text_artifacts' THEN
    IF row_data->>'kind' NOT IN ('call_summary','transcript_translation') THEN RETURN NEW; END IF;
    SELECT call_attempt_id INTO attempt_id FROM final_transcript_revisions WHERE id=(row_data->>'transcript_revision_id')::uuid;
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

CREATE OR REPLACE FUNCTION discard_live_conversation(attempt_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
    (SELECT id FROM call_text_artifacts WHERE call_brief_id=brief_id AND kind IN ('call_summary','transcript_translation')
      AND transcript_revision_id IN (SELECT id FROM final_transcript_revisions WHERE call_attempt_id=attempt_id OR call_attempt_id IS NULL));
  UPDATE call_text_artifacts SET payload_ciphertext=NULL,context_ciphertext=NULL,status='cancelled',updated_at=now()
    WHERE call_brief_id=brief_id AND kind IN ('call_summary','transcript_translation')
      AND transcript_revision_id IN (SELECT id FROM final_transcript_revisions WHERE call_attempt_id=attempt_id OR call_attempt_id IS NULL);
  UPDATE user_call_notifications SET payload_ciphertext=NULL,status='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE call_attempt_id=attempt_id;
  UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now(),last_error_code='conversation_discarded'
    WHERE status IN ('queued','running') AND (call_attempt_id=attempt_id AND job_type IN ('live_transcript_finalization') OR
      recording_id IN (SELECT id FROM call_recordings WHERE call_attempt_id=attempt_id) AND job_type IN ('final_transcription','recording_retention') OR
      text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id=brief_id AND kind IN ('call_summary','transcript_translation')
      AND transcript_revision_id IN (SELECT id FROM final_transcript_revisions WHERE call_attempt_id=attempt_id OR call_attempt_id IS NULL)));
END; $$;

