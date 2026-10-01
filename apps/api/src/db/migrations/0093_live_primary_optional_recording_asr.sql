-- Reuse the existing artifact parent so immutable revision IDs and citations survive.
ALTER TABLE final_transcripts ADD COLUMN call_attempt_id uuid REFERENCES call_attempts(id);
UPDATE final_transcripts f SET call_attempt_id=r.call_attempt_id FROM call_recordings r WHERE r.id=f.call_recording_id;
ALTER TABLE final_transcripts ALTER COLUMN call_attempt_id SET NOT NULL;
ALTER TABLE final_transcripts ADD COLUMN artifact_kind varchar(24) NOT NULL DEFAULT 'recording_asr'
  CHECK (artifact_kind IN ('live','recording_asr'));
UPDATE final_transcripts SET artifact_kind='live' WHERE source IN ('live_native','live_composed');
ALTER TABLE final_transcripts DROP CONSTRAINT final_transcripts_call_recording_id_key;
ALTER TABLE final_transcripts ALTER COLUMN call_recording_id DROP NOT NULL;
ALTER TABLE final_transcripts ADD CONSTRAINT transcript_artifact_attempt_kind UNIQUE(call_attempt_id,artifact_kind);
ALTER TABLE final_transcripts ADD CONSTRAINT transcript_artifact_recording CHECK (artifact_kind='live' OR call_recording_id IS NOT NULL);
ALTER TABLE final_transcripts ADD COLUMN quality jsonb;
ALTER TABLE final_transcripts ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE final_transcripts ADD COLUMN requested_by uuid REFERENCES users(id);
ALTER TABLE final_transcripts ADD COLUMN requested_at timestamptz;
ALTER TABLE final_transcripts ADD CONSTRAINT transcript_explicit_request CHECK (
  (request_id IS NULL AND requested_by IS NULL AND requested_at IS NULL) OR
  (artifact_kind='recording_asr' AND request_id IS NOT NULL AND requested_by IS NOT NULL AND requested_at IS NOT NULL));

CREATE SEQUENCE transcript_ingestion_sequence;
ALTER TABLE transcript_segments ADD COLUMN ingestion_sequence bigint;
WITH ordered AS (SELECT id,row_number() OVER (ORDER BY created_at,id) AS sequence FROM transcript_segments)
UPDATE transcript_segments s SET ingestion_sequence=o.sequence FROM ordered o WHERE s.id=o.id;
SELECT setval('transcript_ingestion_sequence',GREATEST(COALESCE((SELECT max(ingestion_sequence) FROM transcript_segments),0),1),
  EXISTS(SELECT 1 FROM transcript_segments));
ALTER TABLE transcript_segments ALTER COLUMN ingestion_sequence SET DEFAULT nextval('transcript_ingestion_sequence');
ALTER TABLE transcript_segments ALTER COLUMN ingestion_sequence SET NOT NULL;
ALTER SEQUENCE transcript_ingestion_sequence OWNED BY transcript_segments.ingestion_sequence;
ALTER TABLE transcript_segments ADD COLUMN received_at timestamptz;
UPDATE transcript_segments SET received_at=created_at;
ALTER TABLE transcript_segments ALTER COLUMN received_at SET DEFAULT now();
ALTER TABLE transcript_segments ALTER COLUMN received_at SET NOT NULL;
ALTER TABLE transcript_segments ADD COLUMN call_attempt_id uuid REFERENCES call_attempts(id);
UPDATE transcript_segments s SET call_attempt_id=(SELECT a.id FROM call_attempts a
  WHERE a.call_brief_id=s.call_brief_id AND a.created_at<=s.created_at ORDER BY a.created_at DESC,a.id DESC LIMIT 1);

ALTER TABLE durable_jobs DROP CONSTRAINT durable_jobs_job_type_check, DROP CONSTRAINT durable_jobs_target_check;
ALTER TABLE durable_jobs ADD CONSTRAINT durable_jobs_job_type_check CHECK (job_type IN (
  'brief_compilation','final_transcription','live_transcript_finalization','recording_retention','answer_detection_timeout',
  'provider_call_reconciliation','provider_call_cost_reconciliation','provider_recording_reconciliation','text_artifact_generation'));
ALTER TABLE durable_jobs ADD CONSTRAINT durable_jobs_target_check CHECK (
  (job_type='text_artifact_generation' AND text_artifact_id IS NOT NULL AND recording_id IS NULL AND call_attempt_id IS NULL AND call_preparation_id IS NULL)
  OR (text_artifact_id IS NULL AND (
    (job_type='brief_compilation' AND call_preparation_id IS NOT NULL AND call_attempt_id IS NULL AND recording_id IS NULL)
    OR (job_type IN ('live_transcript_finalization','answer_detection_timeout','provider_call_reconciliation','provider_call_cost_reconciliation') AND call_attempt_id IS NOT NULL AND call_preparation_id IS NULL AND recording_id IS NULL)
    OR (job_type IN ('final_transcription','recording_retention','provider_recording_reconciliation') AND recording_id IS NOT NULL AND call_attempt_id IS NULL AND call_preparation_id IS NULL))));

-- Fence old automatic work, including leases owned by a pre-cutover worker.
UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,
  last_error_code='ASR_EXPLICIT_REQUEST_REQUIRED',updated_at=now(),completed_at=now()
  WHERE job_type='final_transcription' AND status IN ('queued','running');
-- Retention no longer depends on transcription finishing. Preserve existing deadlines.
UPDATE call_recordings r SET delete_after=COALESCE(r.completed_at,r.updated_at)+b.audio_retention_days*interval '1 day'
  FROM call_briefs b WHERE b.id=r.call_brief_id AND r.status='available' AND r.delete_after IS NULL;

-- Paid ASR operations carry their explicit durable authorization for audit.
ALTER TABLE provider_operations ADD COLUMN recording_transcript_request_id uuid;
