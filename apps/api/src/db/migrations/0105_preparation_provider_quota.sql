-- One conservative quota scope covers all preparation models and both tiers.
-- This is an application allocation, not a claim about the project's purchased quota.
UPDATE preparation_settings SET capacity=capacity ||
  '{"providerRequestsPerMinute":100,"providerTokensPerMinute":2000000,"voiceReservePercent":25}'::jsonb;
CREATE TABLE preparation_provider_admissions (
  operation_id uuid PRIMARY KEY REFERENCES provider_operations(id) ON DELETE CASCADE,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  estimated_tokens integer NOT NULL CHECK(estimated_tokens BETWEEN 0 AND 1000000)
);
CREATE INDEX preparation_provider_admission_window ON preparation_provider_admissions(admitted_at);
