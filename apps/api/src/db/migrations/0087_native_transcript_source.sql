-- Existing transcripts and pending legacy jobs retain recording ASR provenance.
ALTER TABLE final_transcripts ADD COLUMN source varchar(24) NOT NULL DEFAULT 'recording_asr'
  CHECK (source IN ('recording_asr', 'live_native'));
ALTER TABLE call_attempts ADD COLUMN native_transcript_capture jsonb
  CHECK (native_transcript_capture IS NULL OR (
    jsonb_typeof(native_transcript_capture) = 'object'
    AND native_transcript_capture->>'status' IN ('collecting', 'complete', 'incomplete')
    AND native_transcript_capture->>'version' = '1'));
