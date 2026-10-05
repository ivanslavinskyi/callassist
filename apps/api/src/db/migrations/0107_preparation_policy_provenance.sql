-- The baseline filled by 0102 is a compatibility value, not evidence of an old request's profile.
ALTER TABLE call_preparation_requests ADD COLUMN runtime_policy_source text NOT NULL DEFAULT 'legacy_unknown'
  CHECK(runtime_policy_source IN ('legacy_unknown','pinned'));
ALTER TABLE call_preparation_requests ALTER COLUMN runtime_policy_source SET DEFAULT 'pinned';
CREATE FUNCTION prevent_preparation_policy_source_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.runtime_policy_source IS DISTINCT FROM OLD.runtime_policy_source THEN RAISE EXCEPTION 'PREPARATION_SNAPSHOT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_policy_source_immutable BEFORE UPDATE OF runtime_policy_source ON call_preparation_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_preparation_policy_source_change();
