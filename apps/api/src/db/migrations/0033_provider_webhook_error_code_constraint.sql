ALTER TABLE provider_webhook_delivery_buckets
  ADD CONSTRAINT provider_webhook_delivery_error_code_check CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[A-Za-z0-9_.:/-]{1,160}$'
  );
