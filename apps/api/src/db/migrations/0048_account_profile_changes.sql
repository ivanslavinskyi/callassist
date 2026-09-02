CREATE TABLE email_change_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  initiating_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  new_email text NOT NULL CHECK (btrim(new_email) <> ''),
  code_hash varchar(64) NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (
    attempt_count BETWEEN 0 AND 8
  ),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  invalidated_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
  CHECK (completed_at IS NULL OR invalidated_at IS NULL)
);

CREATE INDEX email_change_challenges_user_created_at_idx
  ON email_change_challenges(user_id, created_at DESC);

CREATE INDEX email_change_challenges_created_at_idx
  ON email_change_challenges(created_at);

CREATE INDEX email_change_challenges_expiry_idx
  ON email_change_challenges(expires_at)
  WHERE completed_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE email_change_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  challenge_id uuid NOT NULL UNIQUE,
  revoked_session_count integer NOT NULL CHECK (revoked_session_count >= 0),
  invalidated_recovery_challenge_count integer NOT NULL CHECK (
    invalidated_recovery_challenge_count >= 0
  ),
  invalidated_recovery_grant_count integer NOT NULL CHECK (
    invalidated_recovery_grant_count >= 0
  ),
  created_at timestamptz NOT NULL
);

CREATE INDEX email_change_events_user_created_at_idx
  ON email_change_events(user_id, created_at DESC);

CREATE FUNCTION prevent_email_change_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'email_change_events are immutable';
END;
$$;

CREATE TRIGGER email_change_events_immutable
BEFORE UPDATE OR DELETE ON email_change_events
FOR EACH ROW EXECUTE FUNCTION prevent_email_change_event_mutation();
