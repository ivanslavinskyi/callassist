ALTER TABLE call_preparation_requests
  ADD COLUMN operation_kind varchar(24) NOT NULL DEFAULT 'creation'
    CHECK (operation_kind IN ('creation', 'recompilation')),
  ADD COLUMN target_call_brief_id uuid
    REFERENCES call_briefs(id) ON DELETE CASCADE,
  ADD COLUMN expected_compilation_id uuid
    REFERENCES call_compilations(id) ON DELETE CASCADE,
  ADD COLUMN target_revision integer NOT NULL DEFAULT 1
    CHECK (target_revision > 0);

ALTER TABLE call_preparation_requests
  DROP CONSTRAINT call_preparation_requests_call_brief_id_key,
  ADD CONSTRAINT call_preparation_requests_operation_target_check CHECK (
    (
      operation_kind = 'creation'
      AND target_call_brief_id IS NULL
      AND expected_compilation_id IS NULL
      AND target_revision = 1
    )
    OR
    (
      operation_kind = 'recompilation'
      AND target_call_brief_id IS NOT NULL
      AND expected_compilation_id IS NOT NULL
      AND target_revision > 1
    )
  ),
  ADD CONSTRAINT call_preparation_requests_result_target_check CHECK (
    operation_kind = 'creation'
    OR call_brief_id IS NULL
    OR call_brief_id = target_call_brief_id
  );

CREATE UNIQUE INDEX call_preparation_requests_active_recompilation_idx
  ON call_preparation_requests(target_call_brief_id)
  WHERE operation_kind = 'recompilation'
    AND status IN ('queued', 'processing', 'retrying');

CREATE INDEX call_preparation_requests_recompilation_history_idx
  ON call_preparation_requests(target_call_brief_id, created_at DESC)
  WHERE operation_kind = 'recompilation';

CREATE FUNCTION prevent_attempt_during_call_recompilation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM id
  FROM call_briefs
  WHERE id = NEW.call_brief_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM call_preparation_requests
    WHERE target_call_brief_id = NEW.call_brief_id
      AND status IN ('queued', 'processing', 'retrying')
  ) THEN
    RAISE EXCEPTION 'call recompilation is in progress'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER call_attempts_no_active_recompilation
BEFORE INSERT ON call_attempts
FOR EACH ROW
EXECUTE FUNCTION prevent_attempt_during_call_recompilation();
