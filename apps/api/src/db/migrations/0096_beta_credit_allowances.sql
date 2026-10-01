-- Existing immutable ledger rows remain persistent credits. No historical
-- allocation between signup, promotional and manual grants is inferred.
CREATE TABLE beta_credit_policies (
  id uuid PRIMARY KEY,
  amount integer NOT NULL CHECK (amount BETWEEN 0 AND 100),
  period text NOT NULL CHECK (period IN ('lifetime','day','week','month')),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO beta_credit_policies(id,amount,period)
VALUES ('96000000-0000-4000-8000-000000000001',3,'lifetime');
ALTER TABLE beta_controls ADD COLUMN credit_policy_id uuid NOT NULL
  DEFAULT '96000000-0000-4000-8000-000000000001' REFERENCES beta_credit_policies(id);
UPDATE beta_controls SET settings=settings ||
  '{"creditAllowance":{"amount":3,"period":"lifetime"},"showRegistrationRemaining":true}'::jsonb;

CREATE TABLE beta_credit_enrollments (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES beta_credit_policies(id),
  effective_at timestamptz NOT NULL DEFAULT now(),
  lifetime_grant_allowed boolean NOT NULL DEFAULT true,
  pending_policy_id uuid REFERENCES beta_credit_policies(id),
  pending_effective_at timestamptz,
  CHECK ((pending_policy_id IS NULL) = (pending_effective_at IS NULL))
);
INSERT INTO beta_credit_enrollments(user_id,policy_id,effective_at)
SELECT id,'96000000-0000-4000-8000-000000000001',created_at FROM users;

CREATE TABLE beta_credit_periods (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES beta_credit_policies(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  amount integer NOT NULL CHECK (amount BETWEEN 0 AND 100),
  UNIQUE (user_id,policy_id,starts_at),
  UNIQUE (id,user_id)
);
ALTER TABLE credit_transactions ADD COLUMN beta_period_id uuid;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_beta_period_owner_fk
  FOREIGN KEY (beta_period_id,user_id) REFERENCES beta_credit_periods(id,user_id);
ALTER TABLE credit_transactions DROP CONSTRAINT credit_transactions_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check CHECK
  (type IN ('signup_grant','beta_grant','promo_grant','admin_grant','call_reservation','call_charge','call_refund','adjustment'));
ALTER TABLE credit_transactions ADD CONSTRAINT credit_beta_source_check CHECK
  ((type <> 'beta_grant' OR beta_period_id IS NOT NULL) AND
   (beta_period_id IS NULL OR type IN ('beta_grant','call_reservation','call_charge','call_refund')));
CREATE INDEX credit_transactions_period_idx ON credit_transactions(beta_period_id) WHERE beta_period_id IS NOT NULL;
CREATE TRIGGER beta_credit_policies_immutable BEFORE UPDATE OR DELETE ON beta_credit_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_transaction_mutation();
CREATE TRIGGER beta_credit_periods_immutable BEFORE UPDATE OR DELETE ON beta_credit_periods
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_transaction_mutation();
