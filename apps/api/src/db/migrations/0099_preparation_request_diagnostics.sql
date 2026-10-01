-- Bounded technical metadata; no user text or provider error message is stored.
ALTER TABLE provider_operations ADD COLUMN request_metadata jsonb;
ALTER TABLE provider_operations ADD CONSTRAINT provider_request_metadata_shape CHECK (
  request_metadata IS NULL OR (
    jsonb_typeof(request_metadata) = 'object' AND
    octet_length(request_metadata::text) <= 2048
  )
);
