-- Admission reconciles the rolling budget against each attempt's usage ledger.
-- Avoid scanning historical operations while holding the shared admission lock.
CREATE INDEX provider_operations_attempt_spend_idx
  ON provider_operations(call_attempt_id) WHERE call_attempt_id IS NOT NULL;
