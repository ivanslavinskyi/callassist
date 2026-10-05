ALTER TABLE durable_worker_heartbeats ADD COLUMN role text NOT NULL DEFAULT 'all'
  CHECK(role IN ('all','preparation','review','operations','background'));
ALTER TABLE durable_worker_heartbeats ADD COLUMN metrics jsonb
  CHECK(metrics IS NULL OR (jsonb_typeof(metrics)='object' AND octet_length(metrics::text)<2048));
CREATE TABLE preparation_daily_metrics (
  day date NOT NULL, model text NOT NULL, tier text NOT NULL, stage text NOT NULL,
  requests integer NOT NULL, successes integer NOT NULL, unknown_usage integer NOT NULL,
  duration_total_ms bigint NOT NULL, duration_p95_ms integer, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(day,model,tier,stage)
);
-- Only detail metadata may be pruned. Terminal accounting and pricing remain immutable.
CREATE OR REPLACE FUNCTION prevent_provider_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND current_setting('callassist.preparation_retention',true)='enabled' THEN
    IF TG_TABLE_NAME='provider_operations' THEN
      IF NEW.request_metadata IS NULL AND (to_jsonb(NEW)-'request_metadata')=(to_jsonb(OLD)-'request_metadata') THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME='provider_operation_results' THEN
      IF NEW.response_metadata IS NULL AND (to_jsonb(NEW)-'response_metadata')=(to_jsonb(OLD)-'response_metadata') THEN RETURN NEW; END IF;
    END IF;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
