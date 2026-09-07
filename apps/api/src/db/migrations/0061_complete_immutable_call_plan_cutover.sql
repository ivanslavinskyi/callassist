ALTER TABLE call_briefs
  VALIDATE CONSTRAINT call_briefs_ready_immutable_compilation_check;

COMMENT ON COLUMN call_briefs.compilation_ciphertext IS
  'Deprecated encrypted legacy projection retained only for historical retention/audit and the explicit offline backfill command; new compilations are stored in call_compilations.';
