-- Optional, bounded transport diagnostics. Existing evidence remains unchanged.
ALTER TABLE provider_operation_results ADD COLUMN response_metadata jsonb;
ALTER TABLE provider_operation_results ADD CONSTRAINT provider_response_metadata_shape CHECK (
  response_metadata IS NULL OR (
    jsonb_typeof(response_metadata) = 'object'
    AND octet_length(response_metadata::text) <= 2048
  )
);
