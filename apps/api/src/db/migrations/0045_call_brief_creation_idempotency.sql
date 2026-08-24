ALTER TABLE call_briefs
  ADD COLUMN creation_idempotency_key uuid;

CREATE UNIQUE INDEX call_briefs_creation_idempotency_key_unique_idx
  ON call_briefs (creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;
