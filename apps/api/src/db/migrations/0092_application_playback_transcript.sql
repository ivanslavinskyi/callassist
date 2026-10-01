-- Playback receipts contain timing/provenance only; text remains in its existing store.
ALTER TABLE transcript_segments ADD COLUMN application_playback jsonb
  CHECK (application_playback IS NULL OR (
    jsonb_typeof(application_playback) = 'object'
    AND application_playback ?& ARRAY['sessionId', 'markId', 'sentAt', 'acknowledgedAt', 'durationMs']));
ALTER TABLE final_transcripts DROP CONSTRAINT final_transcripts_source_check;
ALTER TABLE final_transcripts ADD CONSTRAINT final_transcripts_source_check
  CHECK (source IN ('recording_asr', 'live_native', 'live_composed'));
