CREATE TABLE durable_job_admin_events (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES durable_jobs(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action varchar(24) NOT NULL CHECK (action = 'retry'),
  reason varchar(500) NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 3 AND 500
  ),
  created_at timestamptz NOT NULL
);

CREATE INDEX durable_job_admin_events_job_time_idx
  ON durable_job_admin_events(job_id, created_at DESC);

CREATE INDEX durable_job_admin_events_actor_time_idx
  ON durable_job_admin_events(actor_user_id, created_at DESC);

CREATE TRIGGER durable_job_admin_events_immutable
BEFORE UPDATE OR DELETE ON durable_job_admin_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
