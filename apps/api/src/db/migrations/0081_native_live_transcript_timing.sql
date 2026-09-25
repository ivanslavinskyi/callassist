-- Nullable metadata preserves Live's overlapping/late transcript fragments.
-- Existing Realtime rows and old writers remain compatible; text is unchanged.
ALTER TABLE transcript_segments ADD COLUMN native_timing jsonb;
ALTER TABLE transcript_segments ADD CONSTRAINT transcript_native_timing_object
  CHECK (native_timing IS NULL OR jsonb_typeof(native_timing) = 'object');
