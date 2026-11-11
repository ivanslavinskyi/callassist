CREATE TABLE preparation_validation_events (
  id uuid PRIMARY KEY,
  preparation_id uuid NOT NULL REFERENCES call_preparation_requests(id) ON DELETE CASCADE,
  operation_id uuid REFERENCES provider_operations(id) ON DELETE SET NULL,
  job_generation integer NOT NULL CHECK (job_generation > 0),
  worker_attempt integer NOT NULL CHECK (worker_attempt > 0),
  metadata jsonb NOT NULL,
  detail_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX preparation_validation_by_request ON preparation_validation_events(preparation_id,created_at);
CREATE TABLE preparation_diagnostic_access_events (
  id uuid PRIMARY KEY,
  preparation_id uuid NOT NULL REFERENCES call_preparation_requests(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION purge_preparation_validation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_TABLE_NAME='users' THEN
    IF NEW.status='deleted' THEN
      DELETE FROM preparation_validation_events WHERE preparation_id IN (SELECT id FROM call_preparation_requests WHERE user_id=NEW.id);
      DELETE FROM preparation_diagnostic_access_events WHERE preparation_id IN (SELECT id FROM call_preparation_requests WHERE user_id=NEW.id);
    END IF;
  ELSIF NEW.data_deleted_at IS NOT NULL THEN
    DELETE FROM preparation_validation_events WHERE preparation_id IN (SELECT id FROM call_preparation_requests WHERE call_brief_id=NEW.id OR target_call_brief_id=NEW.id);
    DELETE FROM preparation_diagnostic_access_events WHERE preparation_id IN (SELECT id FROM call_preparation_requests WHERE call_brief_id=NEW.id OR target_call_brief_id=NEW.id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER preparation_validation_account_privacy AFTER UPDATE OF status ON users FOR EACH ROW EXECUTE FUNCTION purge_preparation_validation_evidence();
CREATE TRIGGER preparation_validation_call_privacy AFTER UPDATE OF data_deleted_at ON call_briefs FOR EACH ROW EXECUTE FUNCTION purge_preparation_validation_evidence();

CREATE FUNCTION cancel_preparation_validation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.status='cancelled' AND OLD.status<>'cancelled' THEN
    UPDATE preparation_validation_events SET detail_ciphertext=NULL,
      metadata=metadata || '{"retainedBytes":0,"truncated":true}'::jsonb WHERE preparation_id=NEW.id;
    INSERT INTO preparation_validation_events(id,preparation_id,job_generation,worker_attempt,metadata)
      SELECT gen_random_uuid(),NEW.id,j.generation,greatest(1,j.attempt_count),
        '{"version":1,"stage":"outcome","code":"PREPARATION_CANCELLED","candidateAttempt":0,"auditAttempt":0,"recoveryUsed":false,"originalBytes":0,"retainedBytes":0,"truncated":false}'::jsonb
      FROM durable_jobs j JOIN users u ON u.id=NEW.user_id AND u.status='active'
      LEFT JOIN call_briefs b ON b.id=coalesce(NEW.call_brief_id,NEW.target_call_brief_id)
      WHERE j.call_preparation_id=NEW.id AND b.data_deleted_at IS NULL LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER preparation_validation_cancel AFTER UPDATE OF status ON call_preparation_requests
  FOR EACH ROW EXECUTE FUNCTION cancel_preparation_validation_evidence();
