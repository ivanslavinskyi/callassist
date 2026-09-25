ALTER TABLE call_briefs
  ADD COLUMN retry_source_call_id uuid REFERENCES call_briefs(id),
  ADD COLUMN retry_source_attempt_id uuid REFERENCES call_attempts(id);
CREATE UNIQUE INDEX call_briefs_retry_source_attempt_unique ON call_briefs(retry_source_attempt_id)
  WHERE retry_source_attempt_id IS NOT NULL;
ALTER TABLE call_briefs ADD CONSTRAINT retry_source_pair
  CHECK ((retry_source_call_id IS NULL) = (retry_source_attempt_id IS NULL));
