CREATE TABLE recipient_suppressions (
  id uuid PRIMARY KEY,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source varchar(32) NOT NULL CHECK (
    source IN ('recipient_request', 'staff', 'complaint', 'provider')
  ),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  lifted_at timestamptz,
  lifted_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  lift_reason text,
  CHECK (
    (lifted_at IS NULL AND lifted_by_user_id IS NULL AND lift_reason IS NULL)
    OR
    (lifted_at IS NOT NULL AND lift_reason IS NOT NULL AND btrim(lift_reason) <> '')
  )
);

CREATE UNIQUE INDEX recipient_suppressions_active_phone_idx
  ON recipient_suppressions(phone_e164)
  WHERE lifted_at IS NULL;

CREATE INDEX recipient_suppressions_created_at_idx
  ON recipient_suppressions(created_at DESC);

CREATE TABLE system_controls (
  key varchar(64) PRIMARY KEY CHECK (key IN ('outbound_calls')),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL
);

INSERT INTO system_controls (
  key, enabled, reason, updated_at
) VALUES (
  'outbound_calls', true, 'Initial public-beta default', now()
);

CREATE TABLE safety_events (
  id uuid PRIMARY KEY,
  event_type varchar(64) NOT NULL CHECK (
    event_type IN (
      'recipient.suppressed',
      'recipient.suppression_lifted',
      'outbound_calls.enabled',
      'outbound_calls.disabled'
    )
  ),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  phone_e164 text,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX safety_events_created_at_idx
  ON safety_events(created_at DESC);

CREATE FUNCTION prevent_safety_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'safety_events are immutable';
END;
$$;

CREATE TRIGGER safety_events_immutable
BEFORE UPDATE OR DELETE ON safety_events
FOR EACH ROW EXECUTE FUNCTION prevent_safety_event_mutation();
