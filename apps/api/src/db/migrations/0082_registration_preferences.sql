ALTER TABLE users ADD COLUMN email_verification_deferred_at timestamptz;
ALTER TABLE user_onboarding_acceptances
  ADD COLUMN privacy_revision_id uuid REFERENCES content_page_revisions(id),
  ADD COLUMN privacy_locale varchar(8);
ALTER TABLE user_onboarding_acceptances ADD CONSTRAINT privacy_acceptance_pair
  CHECK ((privacy_revision_id IS NULL) = (privacy_locale IS NULL));

CREATE FUNCTION reset_email_verification_deferral() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email OR NEW.email_verified_at IS NOT NULL THEN
    NEW.email_verification_deferred_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reset_email_verification_deferral BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION reset_email_verification_deferral();
