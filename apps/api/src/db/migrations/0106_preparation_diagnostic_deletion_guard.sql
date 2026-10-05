-- Serialize late diagnostic writes with privacy deletion. Accounting is retained,
-- but diagnostic metadata must never reappear after deletion commits.
CREATE FUNCTION guard_preparation_diagnostic_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_call uuid; owner_id uuid; owner_status text; deleted_at timestamptz; allowed boolean := true;
BEGIN
  SELECT coalesce(o.call_brief_id,p.call_brief_id,p.target_call_brief_id),coalesce(p.user_id,b.user_id)
    INTO target_call,owner_id FROM provider_operations o
    LEFT JOIN call_preparation_requests p ON p.id=o.call_preparation_id
    LEFT JOIN call_briefs b ON b.id=coalesce(o.call_brief_id,p.call_brief_id,p.target_call_brief_id)
    WHERE o.id=NEW.operation_id;
  IF owner_id IS NOT NULL THEN
    SELECT status INTO owner_status FROM users WHERE id=owner_id FOR SHARE;
    allowed := owner_status='active';
  END IF;
  IF target_call IS NOT NULL THEN
    SELECT data_deleted_at INTO deleted_at FROM call_briefs WHERE id=target_call FOR SHARE;
    allowed := allowed AND deleted_at IS NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM provider_operations o JOIN call_preparation_requests p ON p.id=o.call_preparation_id
    WHERE o.id=NEW.operation_id AND p.status='cancelled') THEN allowed := false; END IF;
  IF NOT coalesce(allowed,false) THEN
    IF TG_TABLE_NAME='preparation_request_checkpoints' THEN RETURN NULL; END IF;
    NEW.response_metadata := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_checkpoint_deletion_guard BEFORE INSERT ON preparation_request_checkpoints
  FOR EACH ROW EXECUTE FUNCTION guard_preparation_diagnostic_insert();
CREATE TRIGGER preparation_result_deletion_guard BEFORE INSERT ON provider_operation_results
  FOR EACH ROW WHEN (NEW.response_metadata IS NOT NULL) EXECUTE FUNCTION guard_preparation_diagnostic_insert();
