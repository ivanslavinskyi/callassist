-- Fresh rows use 30 days; existing values and recording deadlines are unchanged.
ALTER TABLE call_briefs ALTER COLUMN audio_retention_days SET DEFAULT 30;
ALTER TABLE call_briefs ADD COLUMN objective_ciphertext text;

-- Encryption backfill is performed by the application with its keyring, not SQL.
-- Deletion must also fence any late projection write.
CREATE FUNCTION fence_objective_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data_deleted_at IS NOT NULL THEN NEW.objective_ciphertext := NULL; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER objective_projection_privacy BEFORE INSERT OR UPDATE ON call_briefs
  FOR EACH ROW EXECUTE FUNCTION fence_objective_projection();
