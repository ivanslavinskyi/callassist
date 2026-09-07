ALTER TABLE call_briefs
  ADD CONSTRAINT call_briefs_ready_immutable_compilation_check CHECK (
    status <> 'ready' OR current_compilation_id IS NOT NULL
  ) NOT VALID;

CREATE FUNCTION require_immutable_call_attempt_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.compilation_id IS NULL
    OR NEW.compilation_revision IS NULL
    OR NEW.compilation_snapshot_hash IS NULL
    OR NEW.execution_snapshot_ciphertext IS NULL
  THEN
    RAISE EXCEPTION 'new call attempts require an immutable execution plan'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER call_attempts_require_immutable_plan
BEFORE INSERT ON call_attempts
FOR EACH ROW
EXECUTE FUNCTION require_immutable_call_attempt_plan();

COMMENT ON CONSTRAINT call_briefs_ready_immutable_compilation_check
  ON call_briefs IS
  'NOT VALID during legacy drain; enforced for every new or changed ready row.';

