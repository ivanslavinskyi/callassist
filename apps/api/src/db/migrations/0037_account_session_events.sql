CREATE TABLE account_session_events (
  id uuid PRIMARY KEY,
  event_type varchar(64) NOT NULL CHECK (
    event_type IN ('session.revoked', 'session.all_revoked')
  ),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_session_id uuid,
  revoked_session_count integer NOT NULL CHECK (revoked_session_count > 0),
  created_at timestamptz NOT NULL,
  CHECK (
    (event_type = 'session.revoked' AND target_session_id IS NOT NULL)
    OR
    (event_type = 'session.all_revoked' AND target_session_id IS NULL)
  )
);

CREATE INDEX account_session_events_actor_created_at_idx
  ON account_session_events(actor_user_id, created_at DESC);

CREATE FUNCTION prevent_account_session_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'account_session_events are immutable';
END;
$$;

CREATE TRIGGER account_session_events_immutable
BEFORE UPDATE OR DELETE ON account_session_events
FOR EACH ROW EXECUTE FUNCTION prevent_account_session_event_mutation();
