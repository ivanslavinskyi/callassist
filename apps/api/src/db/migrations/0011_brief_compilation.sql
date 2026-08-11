ALTER TABLE call_briefs
  ADD COLUMN compilation_ciphertext text;

ALTER TABLE call_briefs
  DROP CONSTRAINT call_briefs_status_check;

ALTER TABLE call_briefs
  ADD CONSTRAINT call_briefs_status_check CHECK (
    status IN (
      'review_required',
      'needs_clarification',
      'blocked',
      'ready',
      'dialing',
      'in_progress',
      'awaiting_approval',
      'completed',
      'stopped',
      'failed'
    )
  );
