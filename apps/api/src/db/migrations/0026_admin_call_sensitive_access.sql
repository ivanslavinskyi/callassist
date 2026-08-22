CREATE TABLE call_sensitive_access_events (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 3 AND 500
  ),
  created_at timestamptz NOT NULL
);

CREATE INDEX call_sensitive_access_events_call_created_at_idx
  ON call_sensitive_access_events(call_brief_id, created_at DESC);

CREATE INDEX call_sensitive_access_events_actor_created_at_idx
  ON call_sensitive_access_events(actor_user_id, created_at DESC);

CREATE TRIGGER call_sensitive_access_events_immutable
BEFORE UPDATE OR DELETE ON call_sensitive_access_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
