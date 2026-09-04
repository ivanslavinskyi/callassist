CREATE TABLE call_compilations (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot_hash varchar(64) NOT NULL CHECK (
    snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  compilation_ciphertext text,
  origin varchar(24) NOT NULL CHECK (origin IN ('native', 'legacy_backfill')),
  created_at timestamptz NOT NULL,
  UNIQUE (call_brief_id, revision),
  UNIQUE (call_brief_id, snapshot_hash),
  UNIQUE (id, call_brief_id),
  UNIQUE (id, call_brief_id, revision, snapshot_hash)
);

CREATE INDEX call_compilations_call_created_idx
  ON call_compilations(call_brief_id, created_at DESC);

ALTER TABLE call_briefs
  ADD COLUMN current_compilation_id uuid;

ALTER TABLE call_briefs
  ADD CONSTRAINT call_briefs_current_compilation_fk
  FOREIGN KEY (current_compilation_id, id)
  REFERENCES call_compilations(id, call_brief_id)
  ON DELETE RESTRICT;

CREATE TABLE call_compilation_approvals (
  id uuid PRIMARY KEY,
  compilation_id uuid NOT NULL UNIQUE,
  call_brief_id uuid NOT NULL,
  revision integer NOT NULL,
  snapshot_hash varchar(64) NOT NULL,
  approved_at timestamptz NOT NULL,
  execution_snapshot_ciphertext text,
  FOREIGN KEY (compilation_id, call_brief_id, revision, snapshot_hash)
    REFERENCES call_compilations(id, call_brief_id, revision, snapshot_hash)
    ON DELETE RESTRICT
);

CREATE INDEX call_compilation_approvals_call_time_idx
  ON call_compilation_approvals(call_brief_id, approved_at DESC);

ALTER TABLE call_attempts
  ADD COLUMN compilation_id uuid;

ALTER TABLE call_attempts
  ADD CONSTRAINT call_attempts_compilation_id_complete_check CHECK (
    compilation_id IS NULL
    OR (
      compilation_revision IS NOT NULL
      AND compilation_snapshot_hash IS NOT NULL
      AND execution_snapshot_ciphertext IS NOT NULL
    )
  );

ALTER TABLE call_attempts
  ADD CONSTRAINT call_attempts_compilation_fk
  FOREIGN KEY (
    compilation_id,
    call_brief_id,
    compilation_revision,
    compilation_snapshot_hash
  )
  REFERENCES call_compilations(id, call_brief_id, revision, snapshot_hash)
  ON DELETE RESTRICT;

CREATE INDEX call_attempts_compilation_id_idx
  ON call_attempts(compilation_id)
  WHERE compilation_id IS NOT NULL;

CREATE FUNCTION prevent_call_compilation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'compilation_ciphertext') =
      (to_jsonb(OLD) - 'compilation_ciphertext')
    AND (
      NEW.compilation_ciphertext IS NULL
      OR current_setting('callassist.encryption_rotation', true) = 'enabled'
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'call compilations are immutable';
END;
$$;

CREATE TRIGGER call_compilations_immutable
BEFORE UPDATE OR DELETE ON call_compilations
FOR EACH ROW EXECUTE FUNCTION prevent_call_compilation_mutation();

CREATE FUNCTION prevent_call_compilation_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.execution_snapshot_ciphertext IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF
    TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'execution_snapshot_ciphertext') =
      (to_jsonb(OLD) - 'execution_snapshot_ciphertext')
    AND (
      NEW.execution_snapshot_ciphertext IS NULL
      OR current_setting('callassist.encryption_rotation', true) = 'enabled'
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'call compilation approvals are immutable';
END;
$$;

CREATE TRIGGER call_compilation_approvals_immutable
BEFORE INSERT OR UPDATE OR DELETE ON call_compilation_approvals
FOR EACH ROW EXECUTE FUNCTION prevent_call_compilation_approval_mutation();
