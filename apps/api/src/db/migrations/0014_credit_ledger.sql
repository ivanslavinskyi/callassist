ALTER TABLE call_attempts
  ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

UPDATE call_attempts
SET user_id = call_briefs.user_id
FROM call_briefs
WHERE call_briefs.id = call_attempts.call_brief_id;

UPDATE call_attempts
SET ended_at = COALESCE(ended_at, created_at)
WHERE ended_at IS NULL
  AND status IN ('blocked', 'completed', 'stopped', 'failed');

WITH duplicate_active_attempts AS (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY user_id
        ORDER BY created_at DESC, id DESC
      ) AS position
    FROM call_attempts
    WHERE user_id IS NOT NULL AND ended_at IS NULL
  ) ranked
  WHERE position > 1
)
UPDATE call_attempts
SET
  status = 'failed',
  ended_at = now(),
  failure_reason = COALESCE(failure_reason, 'superseded_during_credit_migration')
WHERE id IN (SELECT id FROM duplicate_active_attempts);

CREATE UNIQUE INDEX call_attempts_one_active_per_user_idx
  ON call_attempts(user_id)
  WHERE user_id IS NOT NULL AND ended_at IS NULL;

CREATE TABLE credit_transactions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount integer NOT NULL,
  type varchar(32) NOT NULL CHECK (
    type IN (
      'signup_grant',
      'promo_grant',
      'admin_grant',
      'call_reservation',
      'call_charge',
      'call_refund',
      'adjustment'
    )
  ),
  call_attempt_id uuid REFERENCES call_attempts(id) ON DELETE RESTRICT,
  promo_redemption_id uuid,
  admin_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE INDEX credit_transactions_user_created_at_idx
  ON credit_transactions(user_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX credit_transactions_attempt_settlement_idx
  ON credit_transactions(call_attempt_id)
  WHERE call_attempt_id IS NOT NULL
    AND type IN ('call_charge', 'call_refund');

CREATE FUNCTION prevent_credit_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credit_transactions are immutable';
END;
$$;

CREATE TRIGGER credit_transactions_immutable
BEFORE UPDATE OR DELETE ON credit_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_credit_transaction_mutation();

INSERT INTO credit_transactions (
  id,
  user_id,
  amount,
  type,
  idempotency_key,
  created_at
)
SELECT
  gen_random_uuid(),
  id,
  3,
  'signup_grant',
  'signup:' || id::text,
  COALESCE(phone_verified_at, created_at)
FROM users
WHERE phone_verified_at IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;
