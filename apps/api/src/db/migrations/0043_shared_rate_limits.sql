CREATE TABLE rate_limit_buckets (
  scope varchar(120) NOT NULL CHECK (
    scope ~ '^[a-z0-9][a-z0-9:_-]{0,119}$'
  ),
  identifier_hash char(64) NOT NULL CHECK (
    identifier_hash ~ '^[0-9a-f]{64}$'
  ),
  request_count integer NOT NULL CHECK (request_count > 0),
  request_limit integer NOT NULL CHECK (
    request_limit BETWEEN 1 AND 1000000
  ),
  window_ms integer NOT NULL CHECK (
    window_ms BETWEEN 1000 AND 604800000
  ),
  reset_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope, identifier_hash),
  CHECK (reset_at > created_at),
  CHECK (updated_at >= created_at)
);

CREATE INDEX rate_limit_buckets_reset_at_idx
  ON rate_limit_buckets(reset_at);

CREATE TABLE rate_limit_hourly_metrics (
  hour timestamptz NOT NULL,
  scope varchar(120) NOT NULL CHECK (
    scope ~ '^[a-z0-9][a-z0-9:_-]{0,119}$'
  ),
  allowed_count bigint NOT NULL DEFAULT 0 CHECK (allowed_count >= 0),
  denied_count bigint NOT NULL DEFAULT 0 CHECK (denied_count >= 0),
  PRIMARY KEY (hour, scope),
  CHECK (date_trunc('hour', hour) = hour)
);

CREATE INDEX rate_limit_hourly_metrics_scope_hour_idx
  ON rate_limit_hourly_metrics(scope, hour DESC);
