-- Extend storage once; readiness is revision metadata, independent of UI/voice.
-- Published localized content, editorial snapshot JSON and acceptance rows are
-- not rewritten. Legacy revisions inherit their existing EN/DE requirement.
ALTER TABLE content_pages DROP CONSTRAINT content_pages_source_locale_check;
ALTER TABLE content_pages ALTER COLUMN source_locale TYPE varchar(35);
ALTER TABLE content_pages ADD CONSTRAINT content_pages_source_locale_check
  CHECK (source_locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$');

ALTER TABLE content_page_localizations DROP CONSTRAINT content_page_localizations_locale_check;
ALTER TABLE content_page_localizations ALTER COLUMN locale TYPE varchar(35);
ALTER TABLE content_page_localizations ADD CONSTRAINT content_page_localizations_locale_check
  CHECK (locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$');

ALTER TABLE content_page_revision_localizations DROP CONSTRAINT content_page_revision_localizations_locale_check;
ALTER TABLE content_page_revision_localizations ALTER COLUMN locale TYPE varchar(35);
ALTER TABLE content_page_revision_localizations ADD CONSTRAINT content_page_revision_localizations_locale_check
  CHECK (locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$');

ALTER TABLE user_onboarding_acceptances DROP CONSTRAINT user_onboarding_acceptances_accepted_locale_check;
ALTER TABLE user_onboarding_acceptances ALTER COLUMN accepted_locale TYPE varchar(35);
ALTER TABLE user_onboarding_acceptances ADD CONSTRAINT user_onboarding_acceptances_accepted_locale_check
  CHECK (accepted_locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$');

ALTER TABLE content_admin_events DROP CONSTRAINT content_admin_events_locale_check;
ALTER TABLE content_admin_events ALTER COLUMN locale TYPE varchar(35);
ALTER TABLE content_admin_events ADD CONSTRAINT content_admin_events_locale_check
  CHECK (locale IS NULL OR locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$');

CREATE FUNCTION valid_content_locale_set(locales jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE WHEN jsonb_typeof(locales) <> 'array' THEN false ELSE
    jsonb_array_length(locales) BETWEEN 1 AND 30
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(locales) AS entry(value)
      WHERE jsonb_typeof(value) <> 'string'
        OR char_length(value #>> '{}') > 35
        OR (value #>> '{}') !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'
    )
    AND (SELECT count(DISTINCT value) FROM jsonb_array_elements(locales) AS entry(value)) = jsonb_array_length(locales)
  END;
$$;

ALTER TABLE content_page_revisions
  ADD COLUMN required_locales jsonb NOT NULL DEFAULT '["en", "de"]'::jsonb
  CHECK (valid_content_locale_set(required_locales));
ALTER TABLE content_editorial_revisions
  ADD COLUMN required_locales jsonb NOT NULL DEFAULT '["en", "de"]'::jsonb
  CHECK (valid_content_locale_set(required_locales));
