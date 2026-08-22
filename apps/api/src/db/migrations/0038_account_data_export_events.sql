CREATE TABLE account_data_export_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  schema_version varchar(32) NOT NULL CHECK (btrim(schema_version) <> ''),
  call_count integer NOT NULL CHECK (call_count >= 0),
  byte_count integer NOT NULL CHECK (byte_count > 0),
  created_at timestamptz NOT NULL
);

CREATE INDEX account_data_export_events_user_created_at_idx
  ON account_data_export_events(user_id, created_at DESC);

CREATE FUNCTION prevent_account_data_export_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'account_data_export_events are immutable';
END;
$$;

CREATE TRIGGER account_data_export_events_immutable
BEFORE UPDATE OR DELETE ON account_data_export_events
FOR EACH ROW EXECUTE FUNCTION prevent_account_data_export_event_mutation();
