ALTER TABLE call_briefs
  ADD COLUMN assistance_reason_ciphertext text;

ALTER TABLE call_briefs
  DROP CONSTRAINT call_briefs_assistance_reason_check,
  DROP COLUMN assistance_reason;
