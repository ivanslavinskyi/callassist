ALTER TABLE call_briefs
  ADD COLUMN legacy_compilation_disposition varchar(32);

ALTER TABLE call_briefs
  ADD CONSTRAINT call_briefs_legacy_compilation_disposition_check CHECK (
    legacy_compilation_disposition IS NULL
    OR (
      current_compilation_id IS NULL
      AND compilation_ciphertext IS NOT NULL
      AND (
        (
          legacy_compilation_disposition = 'archived_terminal'
          AND status IN ('completed', 'stopped', 'failed')
        )
        OR (
          legacy_compilation_disposition = 'recompile_required'
          AND status IN (
            'review_required',
            'needs_clarification',
            'blocked'
          )
        )
      )
    )
  );

CREATE INDEX call_briefs_legacy_compilation_disposition_idx
  ON call_briefs(legacy_compilation_disposition)
  WHERE legacy_compilation_disposition IS NOT NULL
    AND data_deleted_at IS NULL;

COMMENT ON COLUMN call_briefs.legacy_compilation_disposition IS
  'Explicit terminal disposition for incompatible mutable compilations; ciphertext remains encrypted for retention/audit but is never an execution source.';
