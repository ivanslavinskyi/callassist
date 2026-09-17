-- Keep original provider facts immutable. Late webhook measurements supplement
-- missing values; replay never adds another charge or usage request.
ALTER TABLE provider_usage_records ADD COLUMN pricing_version varchar(80)
  NOT NULL DEFAULT 'openai-public-2026-09-15';

CREATE TABLE provider_usage_supplements (
  operation_id uuid NOT NULL REFERENCES provider_operations(id),
  observation_key text NOT NULL,
  duration_seconds numeric(14,3) CHECK (duration_seconds >= 0),
  billable_seconds integer CHECK (billable_seconds >= 0),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (operation_id, observation_key)
);
CREATE TRIGGER provider_usage_supplements_immutable BEFORE UPDATE OR DELETE
  ON provider_usage_supplements FOR EACH ROW EXECUTE FUNCTION prevent_provider_ledger_mutation();

CREATE VIEW effective_provider_usage AS
SELECT u.id, u.operation_id, u.schema_version, u.request_count,
  u.input_text_tokens, u.cached_input_text_tokens, u.cache_write_input_text_tokens,
  u.output_text_tokens, u.reasoning_output_tokens, u.input_audio_tokens,
  u.cached_input_audio_tokens, u.output_audio_tokens, u.total_tokens,
  COALESCE(u.duration_seconds, (SELECT s.duration_seconds FROM provider_usage_supplements s
    WHERE s.operation_id=u.operation_id AND s.duration_seconds IS NOT NULL
    ORDER BY s.observed_at, s.observation_key LIMIT 1)) AS duration_seconds,
  COALESCE(u.billable_seconds, (SELECT s.billable_seconds FROM provider_usage_supplements s
    WHERE s.operation_id=u.operation_id AND s.billable_seconds IS NOT NULL
    ORDER BY s.observed_at, s.observation_key LIMIT 1)) AS billable_seconds,
  u.raw_usage, u.observed_at, u.pricing_version
FROM provider_usage_records u;

-- Daily account/project totals are a separate source, never additive to the
-- request ledger. Snapshots can change as provider reporting settles.
CREATE TABLE provider_billing_snapshots (
  id uuid PRIMARY KEY,
  provider varchar(40) NOT NULL CHECK (provider IN ('twilio','openai')),
  scope_key varchar(160) NOT NULL,
  day date NOT NULL,
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_micros bigint NOT NULL,
  components jsonb NOT NULL CHECK (jsonb_typeof(components)='array'),
  source varchar(40) NOT NULL CHECK (source IN ('usage_api','costs_api','verified_import')),
  observed_at timestamptz NOT NULL,
  UNIQUE (provider, scope_key, day, observed_at)
);
CREATE INDEX provider_billing_latest ON provider_billing_snapshots(provider,scope_key,day,observed_at DESC);
CREATE TRIGGER provider_billing_snapshots_immutable BEFORE UPDATE OR DELETE
  ON provider_billing_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_provider_ledger_mutation();

-- Provider prices frequently arrive hours later. Requeue only exhausted jobs
-- whose last result was a pending price; preserve their attempt audit trail.
UPDATE durable_jobs SET status='queued', generation=generation+1, attempt_count=0,
  max_attempts=20, run_after=now(), completed_at=NULL, updated_at=now(),
  lease_owner=NULL, leased_at=NULL, lease_expires_at=NULL
WHERE job_type='provider_call_cost_reconciliation' AND status='dead_letter'
  AND last_error_code='PROVIDER_CALL_COST_PENDING';
UPDATE durable_jobs SET max_attempts=20 WHERE job_type='provider_call_cost_reconciliation'
  AND status IN ('queued','running');
