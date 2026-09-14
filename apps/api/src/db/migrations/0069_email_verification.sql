-- Existing addresses remain unverified: there is no reliable historical proof
-- that the current address belongs to its account holder.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE email_change_challenges ADD COLUMN purpose text NOT NULL DEFAULT 'change'
  CHECK (purpose IN ('change', 'verify'));
ALTER TABLE email_change_events ADD COLUMN purpose text NOT NULL DEFAULT 'change'
  CHECK (purpose IN ('change', 'verify'));
