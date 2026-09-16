-- Capture the original destination before a brief can be edited or deleted.
ALTER TABLE call_attempts ADD COLUMN recipient_contact_hash char(64);

-- Minimal contact evidence survives deletion of the owner's call data.
CREATE TABLE recipient_contact_evidence (
  recipient_hash char(64) PRIMARY KEY,
  last_contact_at timestamptz NOT NULL
);

-- Application backfill computes keyed hashes; SQL never receives the HMAC key.
CREATE TABLE recipient_contact_backfill (
  attempt_id uuid PRIMARY KEY REFERENCES call_attempts(id) ON DELETE CASCADE
);
INSERT INTO recipient_contact_backfill SELECT id FROM call_attempts WHERE provider = 'twilio';

CREATE TABLE recipient_opt_out_challenges (
  token_hash char(64) PRIMARY KEY,
  recipient_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  sent boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  claim_id uuid,
  claim_until timestamptz,
  consumed_at timestamptz
);
CREATE INDEX recipient_opt_out_challenges_phone_idx ON recipient_opt_out_challenges(recipient_hash, created_at);
CREATE INDEX recipient_opt_out_challenges_expiry_idx ON recipient_opt_out_challenges(expires_at);
