CREATE TABLE preparation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
  capacity jsonb NOT NULL CHECK(jsonb_typeof(capacity)='object'),
  approved_profiles jsonb NOT NULL DEFAULT '["gpt-5.6:default"]',
  updated_at timestamptz, updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL, reason text
);
INSERT INTO preparation_settings(id,policy,capacity) VALUES(true,
 '{"version":1,"revision":1,"generation":{"model":"gpt-5.6","serviceTier":"default"},"audit":{"model":"gpt-5.6","serviceTier":"default"},"review":{"model":"gpt-5.6","serviceTier":"default"},"promptVersion":"preparation-2026-10-05","pricingVersion":"openai-preparation-2026-10-05","timeoutMs":120000,"requestTimeoutMs":35000,"maxProviderRequests":12,"maxOutputTokens":20000}',
 '{"generationSlots":4,"reviewSlots":2,"providerSlots":4,"queueLimit":40,"perUserWaiting":2}');
CREATE TABLE preparation_settings_audit (
  id uuid PRIMARY KEY, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  previous_settings jsonb NOT NULL, next_settings jsonb NOT NULL,
  reason text NOT NULL, report_sha256 text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE call_preparation_requests ADD COLUMN runtime_policy jsonb;
ALTER TABLE call_preparation_requests ADD COLUMN deadline_at timestamptz;
UPDATE call_preparation_requests SET runtime_policy=(SELECT policy FROM preparation_settings),
  deadline_at=created_at+interval '120 seconds';
ALTER TABLE call_preparation_requests ALTER COLUMN runtime_policy SET NOT NULL;
ALTER TABLE call_preparation_requests ALTER COLUMN deadline_at SET NOT NULL;
CREATE FUNCTION pin_preparation_runtime() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings preparation_settings%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.runtime_policy IS DISTINCT FROM OLD.runtime_policy OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN
      RAISE EXCEPTION 'PREPARATION_SNAPSHOT_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;
  -- Serializes admission, capacity changes and claims; no provider IO holds this lock.
  SELECT * INTO STRICT settings FROM preparation_settings WHERE id=true FOR UPDATE;
  NEW.runtime_policy:=settings.policy;
  NEW.deadline_at:=NEW.created_at+((settings.policy->>'timeoutMs')::int*interval '1 millisecond');
  -- An idempotent replay must still succeed when the queue is full.
  IF EXISTS(SELECT 1 FROM call_preparation_requests WHERE user_id IS NOT DISTINCT FROM NEW.user_id AND idempotency_key=NEW.idempotency_key) THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM call_preparation_requests WHERE status IN ('queued','processing','retrying')) >= (settings.capacity->>'queueLimit')::int THEN
    RAISE EXCEPTION 'PREPARATION_QUEUE_FULL';
  END IF;
  IF (SELECT count(*) FROM call_preparation_requests WHERE user_id IS NOT DISTINCT FROM NEW.user_id AND status IN ('queued','retrying')) >= (settings.capacity->>'perUserWaiting')::int THEN
    RAISE EXCEPTION 'PREPARATION_USER_QUEUE_FULL';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_runtime_pin BEFORE INSERT OR UPDATE OF runtime_policy,deadline_at ON call_preparation_requests
  FOR EACH ROW EXECUTE FUNCTION pin_preparation_runtime();

ALTER TABLE durable_jobs ADD COLUMN work_class text;
UPDATE durable_jobs SET work_class=CASE WHEN job_type='brief_compilation' THEN 'preparation'
  WHEN job_type='text_artifact_generation' AND EXISTS(SELECT 1 FROM call_text_artifacts a WHERE a.id=text_artifact_id AND a.kind IN ('plan_review','clarification_review')) THEN 'review'
  WHEN job_type IN ('answer_detection_timeout','provider_call_reconciliation','live_transcript_finalization') THEN 'operations' ELSE 'background' END;
ALTER TABLE durable_jobs ALTER COLUMN work_class SET NOT NULL;
ALTER TABLE durable_jobs ADD CONSTRAINT durable_work_class CHECK(work_class IN ('preparation','review','operations','background'));
CREATE FUNCTION pin_durable_work_class() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.work_class IS DISTINCT FROM OLD.work_class THEN RAISE EXCEPTION 'DURABLE_WORK_CLASS_IMMUTABLE'; END IF;
    RETURN NEW;
  END IF;
  NEW.work_class:=CASE WHEN NEW.job_type='brief_compilation' THEN 'preparation'
    WHEN NEW.job_type='text_artifact_generation' AND EXISTS(SELECT 1 FROM call_text_artifacts WHERE id=NEW.text_artifact_id AND kind IN ('plan_review','clarification_review')) THEN 'review'
    WHEN NEW.job_type IN ('answer_detection_timeout','provider_call_reconciliation','live_transcript_finalization') THEN 'operations' ELSE 'background' END;
  RETURN NEW;
END $$;
CREATE TRIGGER durable_work_class_pin BEFORE INSERT OR UPDATE OF work_class ON durable_jobs FOR EACH ROW EXECUTE FUNCTION pin_durable_work_class();
CREATE INDEX durable_jobs_work_class_queue ON durable_jobs(work_class,run_after,created_at) WHERE status='queued';
CREATE TABLE preparation_dispatch_users(user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_started_at timestamptz NOT NULL);

ALTER TABLE provider_operations ADD COLUMN requested_service_tier text;
ALTER TABLE provider_operations ADD COLUMN pricing_version text;
ALTER TABLE provider_operation_results ADD COLUMN actual_service_tier text;
CREATE TABLE preparation_request_checkpoints (
  operation_id uuid NOT NULL REFERENCES provider_operations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('dispatched','headers','response_created','first_event','first_output','terminal')),
  metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=1024),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(operation_id,kind)
);
CREATE TABLE preparation_provider_permits (
  operation_id uuid PRIMARY KEY REFERENCES provider_operations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES durable_jobs(id) ON DELETE CASCADE,
  generation integer NOT NULL, attempt_number integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX preparation_permit_expiry ON preparation_provider_permits(expires_at);
CREATE TABLE preparation_provider_cooldown(id boolean PRIMARY KEY DEFAULT true CHECK(id), until_at timestamptz NOT NULL);
INSERT INTO preparation_provider_cooldown VALUES(true,'epoch');
