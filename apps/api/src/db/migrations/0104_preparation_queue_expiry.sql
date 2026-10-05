CREATE FUNCTION expire_preparation_queue() RETURNS void LANGUAGE sql AS $$
  WITH expired AS MATERIALIZED (
    SELECT j.id,p.id AS preparation_id FROM durable_jobs j JOIN call_preparation_requests p ON p.id=j.call_preparation_id
    WHERE j.status='queued' AND p.status IN ('queued','retrying') AND p.deadline_at<=clock_timestamp()
    FOR UPDATE OF j,p SKIP LOCKED
  ), jobs AS (
    UPDATE durable_jobs j SET status='dead_letter',last_error_code='PREPARATION_DEADLINE_EXCEEDED',completed_at=clock_timestamp(),updated_at=clock_timestamp()
    FROM expired e WHERE j.id=e.id RETURNING e.preparation_id
  ) UPDATE call_preparation_requests p SET status='failed',failure_code='BRIEF_COMPILER_UNAVAILABLE',input_ciphertext=NULL,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE p.id IN (SELECT preparation_id FROM jobs);
$$;

-- New diagnostic data follows call/account deletion in the same transaction.
CREATE FUNCTION purge_preparation_details_on_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[]; previous_setting text;
BEGIN
  IF (TG_TABLE_NAME='users' AND NEW.status<>'deleted') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='call_briefs' THEN
    IF NEW.data_deleted_at IS NULL THEN RETURN NEW; END IF;
    SELECT array_agg(o.id) INTO ids FROM provider_operations o LEFT JOIN call_preparation_requests p ON p.id=o.call_preparation_id
      WHERE o.call_brief_id=NEW.id OR p.call_brief_id=NEW.id OR p.target_call_brief_id=NEW.id;
  ELSE
    SELECT array_agg(o.id) INTO ids FROM provider_operations o LEFT JOIN call_preparation_requests p ON p.id=o.call_preparation_id
      LEFT JOIN call_briefs b ON b.id=o.call_brief_id WHERE p.user_id=NEW.id OR b.user_id=NEW.id;
  END IF;
  IF ids IS NULL THEN RETURN NEW; END IF;
  DELETE FROM preparation_request_checkpoints WHERE operation_id=ANY(ids);
  previous_setting:=current_setting('callassist.preparation_retention',true);
  PERFORM set_config('callassist.preparation_retention','enabled',true);
  UPDATE provider_operations SET request_metadata=NULL WHERE id=ANY(ids) AND request_metadata IS NOT NULL;
  UPDATE provider_operation_results SET response_metadata=NULL WHERE operation_id=ANY(ids) AND response_metadata IS NOT NULL;
  PERFORM set_config('callassist.preparation_retention',coalesce(previous_setting,''),true);
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_call_details_delete AFTER UPDATE OF data_deleted_at ON call_briefs
  FOR EACH ROW EXECUTE FUNCTION purge_preparation_details_on_deletion();
CREATE TRIGGER preparation_account_details_delete AFTER UPDATE OF status ON users
  FOR EACH ROW WHEN (NEW.status='deleted') EXECUTE FUNCTION purge_preparation_details_on_deletion();
