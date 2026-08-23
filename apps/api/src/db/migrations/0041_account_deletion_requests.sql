CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL CHECK (status IN (
    'queued',
    'processing',
    'waiting_for_calls',
    'retrying',
    'needs_support',
    'completed'
  )),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  run_after timestamptz NOT NULL,
  lease_owner varchar(120),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code varchar(160),
  requested_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (
    status = 'processing'
      OR (lease_owner IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    status <> 'processing'
      OR (lease_owner IS NOT NULL AND leased_at IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX account_deletion_requests_due_idx
  ON account_deletion_requests(run_after ASC, requested_at ASC)
  WHERE status IN ('queued', 'waiting_for_calls', 'retrying');

CREATE INDEX account_deletion_requests_status_updated_idx
  ON account_deletion_requests(status, updated_at DESC);

CREATE TABLE account_deletion_attempts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES account_deletion_requests(id) ON DELETE RESTRICT,
  generation integer NOT NULL CHECK (generation > 0),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id varchar(120) NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  outcome varchar(32) NOT NULL CHECK (outcome IN (
    'succeeded',
    'retry_scheduled',
    'needs_support',
    'lease_expired'
  )),
  error_code varchar(160),
  UNIQUE (request_id, generation, attempt_number)
);

CREATE INDEX account_deletion_attempts_request_time_idx
  ON account_deletion_attempts(request_id, completed_at DESC);

CREATE FUNCTION prevent_account_deletion_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'account_deletion_attempts are immutable';
END;
$$;

CREATE TRIGGER account_deletion_attempts_immutable
BEFORE UPDATE OR DELETE ON account_deletion_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_account_deletion_attempt_mutation();

CREATE TABLE account_deletion_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES account_deletion_requests(id) ON DELETE RESTRICT,
  event_type varchar(64) NOT NULL CHECK (event_type IN (
    'account_deletion.requested',
    'account_deletion.active_call_delayed',
    'account_deletion.retry_requested',
    'account_deletion.completed'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL,
  CHECK (
    (event_type = 'account_deletion.retry_requested'
      AND reason IS NOT NULL
      AND char_length(btrim(reason)) BETWEEN 3 AND 500)
    OR
    (event_type <> 'account_deletion.retry_requested' AND reason IS NULL)
  )
);

CREATE INDEX account_deletion_events_request_created_at_idx
  ON account_deletion_events(request_id, created_at DESC);

CREATE FUNCTION prevent_account_deletion_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'account_deletion_events are immutable';
END;
$$;

CREATE TRIGGER account_deletion_events_immutable
BEFORE UPDATE OR DELETE ON account_deletion_events
FOR EACH ROW EXECUTE FUNCTION prevent_account_deletion_event_mutation();
