ALTER TABLE call_attempts
  ADD COLUMN compilation_revision integer,
  ADD COLUMN compilation_snapshot_hash varchar(64),
  ADD COLUMN execution_snapshot_ciphertext text;

ALTER TABLE call_attempts
  ADD CONSTRAINT call_attempts_compilation_revision_check CHECK (
    compilation_revision IS NULL OR compilation_revision > 0
  ),
  ADD CONSTRAINT call_attempts_compilation_snapshot_hash_check CHECK (
    compilation_snapshot_hash IS NULL
    OR compilation_snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT call_attempts_execution_snapshot_complete_check CHECK (
    (compilation_revision IS NULL
      AND compilation_snapshot_hash IS NULL
      AND execution_snapshot_ciphertext IS NULL)
    OR
    (compilation_revision IS NOT NULL
      AND compilation_snapshot_hash IS NOT NULL
      AND execution_snapshot_ciphertext IS NOT NULL)
  );

CREATE INDEX call_attempts_compilation_snapshot_idx
  ON call_attempts(call_brief_id, compilation_revision, compilation_snapshot_hash)
  WHERE compilation_snapshot_hash IS NOT NULL;
