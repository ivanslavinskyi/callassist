CREATE TABLE live_native_action_revisions (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  call_attempt_id uuid NOT NULL REFERENCES call_attempts(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK(revision>0), action_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('authorized','delivered','uncertain','confirmed','declined')),
  payload_ciphertext text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(call_attempt_id,revision)
);
CREATE TRIGGER live_content_fence BEFORE INSERT OR UPDATE ON live_native_action_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_discarded_live_content();
CREATE FUNCTION redact_native_actions_on_discard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.state<>'active' THEN DELETE FROM live_native_action_revisions WHERE call_attempt_id=NEW.call_attempt_id; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_action_privacy AFTER UPDATE OF state ON live_attempt_privacy
  FOR EACH ROW EXECUTE FUNCTION redact_native_actions_on_discard();
