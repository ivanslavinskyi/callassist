-- Account presentation and content preferences are independent. NULL content
-- language means automatic selection from each task; never backfill it from UI.
ALTER TABLE users DROP CONSTRAINT users_ui_locale_check;
ALTER TABLE users ALTER COLUMN ui_locale TYPE varchar(35);
ALTER TABLE users ADD CONSTRAINT users_ui_locale_check CHECK (
  ui_locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'
);

ALTER TABLE users ADD COLUMN preferred_content_language varchar(35);
ALTER TABLE users ADD CONSTRAINT users_preferred_content_language_check CHECK (
  preferred_content_language IS NULL OR
  preferred_content_language ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'
);
