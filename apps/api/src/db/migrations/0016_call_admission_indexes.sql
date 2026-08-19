CREATE INDEX call_attempts_user_started_at_idx
  ON call_attempts(user_id, started_at DESC)
  WHERE user_id IS NOT NULL;
