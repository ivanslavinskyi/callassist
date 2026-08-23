CREATE TABLE password_recovery_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (
    attempt_count BETWEEN 0 AND 8
  ),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  invalidated_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (verified_at IS NULL OR verified_at >= created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);

CREATE INDEX password_recovery_challenges_user_created_at_idx
  ON password_recovery_challenges(user_id, created_at DESC);

CREATE INDEX password_recovery_challenges_expiry_idx
  ON password_recovery_challenges(expires_at)
  WHERE verified_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE password_recovery_grants (
  id uuid PRIMARY KEY,
  challenge_id uuid NOT NULL UNIQUE REFERENCES password_recovery_challenges(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash varchar(64) NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX password_recovery_grants_expiry_idx
  ON password_recovery_grants(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE password_recovery_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  challenge_id uuid NOT NULL UNIQUE REFERENCES password_recovery_challenges(id) ON DELETE RESTRICT,
  revoked_session_count integer NOT NULL CHECK (revoked_session_count >= 0),
  created_at timestamptz NOT NULL
);

CREATE INDEX password_recovery_events_user_created_at_idx
  ON password_recovery_events(user_id, created_at DESC);

CREATE FUNCTION prevent_password_recovery_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'password_recovery_events are immutable';
END;
$$;

CREATE TRIGGER password_recovery_events_immutable
BEFORE UPDATE OR DELETE ON password_recovery_events
FOR EACH ROW EXECUTE FUNCTION prevent_password_recovery_event_mutation();
