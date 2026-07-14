ALTER TABLE call_attempts
  ADD COLUMN provider_status varchar(32);

UPDATE call_attempts
SET provider_status = status
WHERE provider_call_id IS NOT NULL;
