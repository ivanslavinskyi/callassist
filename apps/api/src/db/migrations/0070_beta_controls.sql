CREATE TABLE beta_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  settings jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  public_accounts integer NOT NULL DEFAULT 0 CHECK (public_accounts >= 0),
  invited_accounts integer NOT NULL DEFAULT 0 CHECK (invited_accounts >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'Initial beta configuration'
);
INSERT INTO beta_controls (settings, public_accounts) SELECT
  '{"publicAccountLimit":30,"maxDurationSeconds":420,"maxConcurrentCalls":2,"maxStartsPerHour":3,"maxStartsPerDay":10,"maxStartsPerRecipientPerDay":2,"spendingEnabled":true,"currency":"USD","rollingDayBudgetMicros":null,"callMinuteReserveMicros":2000000,"textRequestReserveMicros":500000,"transcriptionRequestReserveMicros":1000000,"smsReserveMicros":500000,"emailReserveMicros":10000}'::jsonb,
  count(*)::integer FROM users WHERE role='user';

CREATE TABLE beta_invitations (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE TABLE beta_control_audit (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target_id uuid,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  previous_settings jsonb,
  next_settings jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE beta_spend_reservations (
  reservation_key varchar(160) PRIMARY KEY,
  kind varchar(32) NOT NULL,
  amount_micros bigint NOT NULL CHECK (amount_micros > 0),
  currency char(3) NOT NULL CHECK (currency = 'USD'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX beta_spend_reservations_time_idx ON beta_spend_reservations(created_at);
ALTER TABLE call_attempts ADD COLUMN max_duration_seconds integer CHECK (max_duration_seconds BETWEEN 60 AND 900);
-- Short-lived, keyed fingerprints survive owner deletion so it cannot reset an
-- address's 24-hour abuse limit. No raw destination is stored here.
CREATE TABLE beta_recipient_starts (
  attempt_id uuid PRIMARY KEY,
  recipient_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX beta_recipient_starts_hash_time_idx ON beta_recipient_starts(recipient_hash,created_at);
