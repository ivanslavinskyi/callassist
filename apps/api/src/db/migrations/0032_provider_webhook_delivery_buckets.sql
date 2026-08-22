CREATE TABLE provider_webhook_delivery_buckets (
  provider varchar(24) NOT NULL CHECK (provider = 'twilio'),
  webhook_kind varchar(32) NOT NULL CHECK (webhook_kind IN (
    'voice',
    'call_status',
    'recording_status'
  )),
  outcome varchar(24) NOT NULL CHECK (outcome IN (
    'accepted',
    'rejected',
    'unmatched',
    'failed'
  )),
  bucket_started_at timestamptz NOT NULL,
  delivery_count integer NOT NULL CHECK (delivery_count > 0),
  last_received_at timestamptz NOT NULL,
  last_error_code varchar(160),
  PRIMARY KEY (provider, webhook_kind, outcome, bucket_started_at),
  CHECK (bucket_started_at = date_trunc('hour', bucket_started_at)),
  CHECK (
    last_received_at >= bucket_started_at
    AND last_received_at < bucket_started_at + interval '1 hour'
  ),
  CHECK (
    (outcome = 'accepted' AND last_error_code IS NULL)
    OR
    (outcome <> 'accepted' AND last_error_code IS NOT NULL)
  )
);

CREATE INDEX provider_webhook_delivery_recent_idx
  ON provider_webhook_delivery_buckets(last_received_at DESC);
