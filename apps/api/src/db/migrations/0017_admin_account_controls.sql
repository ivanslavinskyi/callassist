CREATE TABLE account_admin_events (
  id uuid PRIMARY KEY,
  event_type varchar(64) NOT NULL CHECK (
    event_type IN (
      'account.suspended',
      'account.unsuspended',
      'account.sessions_revoked'
    )
  ),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_status varchar(16),
  new_status varchar(16),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CHECK (actor_user_id <> target_user_id),
  CHECK (
    (
      event_type = 'account.sessions_revoked'
      AND previous_status IS NULL
      AND new_status IS NULL
    )
    OR
    (
      event_type IN ('account.suspended', 'account.unsuspended')
      AND previous_status IN ('active', 'suspended')
      AND new_status IN ('active', 'suspended')
      AND previous_status <> new_status
    )
  )
);

CREATE INDEX account_admin_events_target_created_at_idx
  ON account_admin_events(target_user_id, created_at DESC);

CREATE INDEX account_admin_events_actor_created_at_idx
  ON account_admin_events(actor_user_id, created_at DESC);

CREATE FUNCTION prevent_account_admin_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'account_admin_events are immutable';
END;
$$;

CREATE TRIGGER account_admin_events_immutable
BEFORE UPDATE OR DELETE ON account_admin_events
FOR EACH ROW EXECUTE FUNCTION prevent_account_admin_event_mutation();
