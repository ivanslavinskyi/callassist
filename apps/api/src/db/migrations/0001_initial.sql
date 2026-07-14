CREATE TABLE call_briefs (
  id uuid PRIMARY KEY,
  recipient_name text NOT NULL,
  phone_number text NOT NULL,
  objective text NOT NULL,
  locale varchar(16) NOT NULL,
  allow_language_switch boolean NOT NULL DEFAULT false,
  fallback_locale varchar(16),
  allowed_facts_ciphertext text NOT NULL,
  status varchar(32) NOT NULL CHECK (
    status IN (
      'ready',
      'dialing',
      'in_progress',
      'awaiting_approval',
      'completed',
      'stopped',
      'failed'
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (allow_language_switch = false AND fallback_locale IS NULL)
    OR
    (allow_language_switch = true AND fallback_locale IS NOT NULL AND fallback_locale <> locale)
  )
);

CREATE TABLE call_attempts (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  provider_call_id text,
  status varchar(32) NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL
);

CREATE INDEX call_attempts_call_brief_id_idx
  ON call_attempts(call_brief_id, created_at DESC);

CREATE TABLE transcript_segments (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL CHECK (role IN ('assistant', 'recipient', 'system')),
  text text NOT NULL,
  locale varchar(16) NOT NULL,
  final boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX transcript_segments_call_brief_id_idx
  ON transcript_segments(call_brief_id, created_at ASC);

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  category varchar(32) NOT NULL CHECK (
    category IN ('contact_email', 'postal_address', 'date_of_birth', 'legal_commitment')
  ),
  title text NOT NULL,
  reason text NOT NULL,
  proposed_speech text NOT NULL,
  status varchar(16) NOT NULL CHECK (
    status IN ('pending', 'approved', 'declined', 'expired')
  ),
  created_at timestamptz NOT NULL,
  decided_at timestamptz
);

CREATE UNIQUE INDEX approval_requests_one_pending_idx
  ON approval_requests(call_brief_id)
  WHERE status = 'pending';

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id),
  event_type varchar(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX audit_events_call_brief_id_idx
  ON audit_events(call_brief_id, created_at ASC);

CREATE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable';
END;
$$;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
