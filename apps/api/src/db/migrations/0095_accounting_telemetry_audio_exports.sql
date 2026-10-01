-- Existing links were backfilled by timestamp; do not advertise exact provenance.
ALTER TABLE transcript_segments ADD COLUMN attempt_attribution text;
UPDATE transcript_segments SET attempt_attribution=CASE WHEN call_attempt_id IS NULL THEN 'unknown' ELSE 'legacy_inferred' END;
ALTER TABLE transcript_segments ALTER COLUMN attempt_attribution SET DEFAULT 'unknown';
ALTER TABLE transcript_segments ALTER COLUMN attempt_attribution SET NOT NULL;
ALTER TABLE transcript_segments ADD CONSTRAINT transcript_attempt_attribution CHECK (attempt_attribution IN ('direct','legacy_inferred','unknown'));
ALTER TABLE call_attempts ADD COLUMN runtime_descriptor jsonb CHECK (runtime_descriptor IS NULL OR jsonb_typeof(runtime_descriptor)='object');

-- Previously created requests remain metadata-only, including retried requests.
ALTER TABLE admin_telemetry_exports ADD COLUMN include_audio boolean NOT NULL DEFAULT false;
ALTER TABLE admin_telemetry_exports ADD COLUMN audio_deadline timestamptz;
CREATE TABLE admin_telemetry_export_recordings (
  export_id uuid NOT NULL REFERENCES admin_telemetry_exports(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  recording_id uuid NOT NULL,
  delete_after timestamptz,
  PRIMARY KEY(export_id,generation,recording_id)
);
-- No source-row FK: publication takes epoch/export locks, never recording locks.
CREATE INDEX admin_telemetry_recording_dependencies ON admin_telemetry_export_recordings(recording_id);

-- Keep conservative global revocation, including jobs whose membership snapshot
-- has not been captured yet. Deletion intent revokes before the provider request.
CREATE TRIGGER admin_telemetry_recording_privacy AFTER UPDATE OF status,deleted_at,delete_after,consent_granted_at ON call_recordings
  FOR EACH ROW WHEN (
    (OLD.status='available' AND NEW.status IS DISTINCT FROM OLD.status)
    OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
    OR (OLD.status='available' AND NEW.delete_after IS NOT NULL AND (OLD.delete_after IS NULL OR NEW.delete_after<OLD.delete_after))
    OR (OLD.consent_granted_at IS NOT NULL AND NEW.consent_granted_at IS NULL)
  ) EXECUTE FUNCTION invalidate_admin_telemetry_exports();
