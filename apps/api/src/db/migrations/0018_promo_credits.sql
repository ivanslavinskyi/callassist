CREATE TABLE promo_codes (
  id uuid PRIMARY KEY,
  code_hash varchar(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 100),
  global_redemption_limit integer CHECK (
    global_redemption_limit IS NULL OR global_redemption_limit BETWEEN 1 AND 100000
  ),
  per_user_limit integer NOT NULL CHECK (per_user_limit BETWEEN 1 AND 10),
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean NOT NULL,
  campaign varchar(120) NOT NULL CHECK (btrim(campaign) <> ''),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  creation_reason text NOT NULL CHECK (
    char_length(btrim(creation_reason)) BETWEEN 3 AND 500
  ),
  creation_idempotency_key uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX promo_codes_campaign_created_at_idx
  ON promo_codes(campaign, created_at DESC);

CREATE TABLE promo_redemptions (
  id uuid PRIMARY KEY,
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  redemption_number integer NOT NULL CHECK (redemption_number > 0),
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 100),
  idempotency_key uuid NOT NULL UNIQUE,
  redeemed_at timestamptz NOT NULL,
  UNIQUE (promo_code_id, user_id, redemption_number)
);

CREATE INDEX promo_redemptions_code_redeemed_at_idx
  ON promo_redemptions(promo_code_id, redeemed_at DESC);

CREATE INDEX promo_redemptions_user_redeemed_at_idx
  ON promo_redemptions(user_id, redeemed_at DESC);

ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_promo_redemption_fk
    FOREIGN KEY (promo_redemption_id)
    REFERENCES promo_redemptions(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT credit_transactions_grant_source_check CHECK (
    (type <> 'promo_grant' OR promo_redemption_id IS NOT NULL)
    AND (type <> 'admin_grant' OR admin_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE credit_transactions
  VALIDATE CONSTRAINT credit_transactions_grant_source_check;

CREATE FUNCTION prevent_promo_redemption_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'promo_redemptions are immutable';
END;
$$;

CREATE TRIGGER promo_redemptions_immutable
BEFORE UPDATE OR DELETE ON promo_redemptions
FOR EACH ROW EXECUTE FUNCTION prevent_promo_redemption_mutation();
