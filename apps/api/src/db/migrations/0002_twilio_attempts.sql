CREATE UNIQUE INDEX call_attempts_provider_call_id_idx
  ON call_attempts(provider_call_id)
  WHERE provider_call_id IS NOT NULL;
