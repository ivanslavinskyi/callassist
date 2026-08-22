CREATE TABLE durable_worker_heartbeats (
  worker_id text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  stopped_at timestamptz,
  active_jobs integer NOT NULL DEFAULT 0,
  CONSTRAINT durable_worker_heartbeats_worker_id_bounds
    CHECK (char_length(worker_id) BETWEEN 1 AND 160),
  CONSTRAINT durable_worker_heartbeats_active_jobs_bounds
    CHECK (active_jobs BETWEEN 0 AND 1000),
  CONSTRAINT durable_worker_heartbeats_time_order
    CHECK (last_seen_at >= started_at),
  CONSTRAINT durable_worker_heartbeats_stop_order
    CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

CREATE INDEX durable_worker_heartbeats_last_seen_idx
  ON durable_worker_heartbeats (last_seen_at DESC);
