UPDATE call_briefs
SET
  status = 'blocked',
  updated_at = now()
WHERE status = 'ready'
  AND compilation_ciphertext IS NULL;
