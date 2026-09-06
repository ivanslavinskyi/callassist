ALTER TABLE call_preparation_requests
  ADD COLUMN provider_request_count integer NOT NULL DEFAULT 0
    CHECK (provider_request_count >= 0);
