CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  phone_e164 text NOT NULL,
  phone_verified_at timestamptz,
  first_name text NOT NULL CHECK (btrim(first_name) <> ''),
  last_name text NOT NULL CHECK (btrim(last_name) <> ''),
  role varchar(32) NOT NULL DEFAULT 'user' CHECK (
    role IN ('user', 'admin', 'superadmin', 'content_editor', 'support')
  ),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'suspended', 'deleted')
  ),
  ui_locale varchar(8) NOT NULL DEFAULT 'en' CHECK (ui_locale IN ('en', 'de')),
  created_at timestamptz NOT NULL,
  last_login_at timestamptz
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email));
CREATE UNIQUE INDEX users_phone_e164_unique_idx ON users (phone_e164);
CREATE INDEX users_status_created_at_idx ON users (status, created_at DESC);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  ip_hash text,
  user_agent text
);

CREATE INDEX sessions_user_id_active_idx
  ON sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE call_briefs
  ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN represented_person_first_name text,
  ADD COLUMN represented_person_last_name text;

ALTER TABLE call_briefs
  ALTER COLUMN represented_person DROP DEFAULT;

UPDATE call_briefs
SET
  represented_person_first_name = CASE
    WHEN btrim(represented_person) ~ '\s'
      THEN regexp_replace(btrim(represented_person), '\s+\S+$', '')
    ELSE btrim(represented_person)
  END,
  represented_person_last_name = CASE
    WHEN btrim(represented_person) ~ '\s'
      THEN regexp_replace(btrim(represented_person), '^.*\s+(\S+)$', '\1')
    ELSE ''
  END;

ALTER TABLE call_briefs
  ALTER COLUMN represented_person_first_name SET NOT NULL,
  ALTER COLUMN represented_person_last_name SET NOT NULL;

ALTER TABLE call_briefs
  ADD CONSTRAINT call_briefs_represented_first_name_nonempty CHECK (
    btrim(represented_person_first_name) <> ''
  ) NOT VALID,
  ADD CONSTRAINT call_briefs_represented_last_name_nonempty CHECK (
    btrim(represented_person_last_name) <> ''
  ) NOT VALID;

CREATE INDEX call_briefs_user_id_created_at_idx
  ON call_briefs (user_id, created_at DESC);

COMMENT ON COLUMN call_briefs.user_id IS
  'Nullable only while pre-authentication MVP records and endpoints are migrated to tenant ownership.';
