-- Context is written once, under the artifact's worker lease, before generation.
-- Preserve the existing identity/payload guards and encryption rotation support.
CREATE OR REPLACE FUNCTION prevent_ready_text_artifact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','payload_ciphertext','payload_hash','failure_code','updated_at','provider_request_count','context_hash','context_ciphertext']) <>
    (to_jsonb(OLD) - ARRAY['status','payload_ciphertext','payload_hash','failure_code','updated_at','provider_request_count','context_hash','context_ciphertext']) THEN
    RAISE EXCEPTION 'text artifact identity is immutable';
  END IF;
  IF OLD.context_hash IS NOT NULL AND NEW.context_hash IS DISTINCT FROM OLD.context_hash THEN
    RAISE EXCEPTION 'text artifact context hash is immutable';
  END IF;
  IF OLD.context_hash IS NULL AND NEW.context_hash IS NOT NULL AND
    (OLD.status NOT IN ('pending','processing') OR NEW.context_ciphertext IS NULL) THEN
    RAISE EXCEPTION 'text artifact context must be frozen before completion';
  END IF;
  IF NEW.context_ciphertext IS NOT NULL AND NEW.context_hash IS NULL THEN
    RAISE EXCEPTION 'text artifact context requires a hash';
  END IF;
  IF OLD.context_hash IS NOT NULL AND OLD.context_ciphertext IS NULL AND NEW.context_ciphertext IS NOT NULL THEN
    RAISE EXCEPTION 'redacted text artifact context cannot be restored';
  END IF;
  IF OLD.context_ciphertext IS NOT NULL AND NEW.context_ciphertext IS DISTINCT FROM OLD.context_ciphertext
    AND NEW.context_ciphertext IS NOT NULL AND current_setting('callassist.encryption_rotation', true) IS DISTINCT FROM 'enabled' THEN
    RAISE EXCEPTION 'text artifact context is immutable';
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

CREATE TRIGGER call_assessment_revisions_immutable BEFORE UPDATE OR DELETE ON call_assessment_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_text_source_mutation();
CREATE TRIGGER call_terminal_decisions_immutable BEFORE UPDATE OR DELETE ON call_terminal_decisions
  FOR EACH ROW EXECUTE FUNCTION prevent_text_source_mutation();
