CREATE TABLE call_outcome_revisions (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id),
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  outcome varchar(32) CHECK (outcome IS NULL OR outcome IN (
    'resolved',
    'partially_resolved',
    'unresolved',
    'wrong_recipient',
    'voicemail',
    'declined',
    'technical_failure'
  )),
  provenance varchar(16) NOT NULL CHECK (
    provenance IN ('system', 'user', 'staff')
  ),
  actor_user_id uuid REFERENCES users(id),
  reason varchar(32) NOT NULL CHECK (
    reason IN ('technical_state_changed', 'owner_feedback', 'staff_review')
  ),
  technical jsonb NOT NULL CHECK (
    jsonb_typeof(technical) = 'object'
    AND octet_length(technical::text) <= 4096
  ),
  idempotency_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (provenance = 'system' AND actor_user_id IS NULL AND outcome IS NULL)
    OR (provenance <> 'system' AND actor_user_id IS NOT NULL)
  ),
  UNIQUE (call_brief_id, revision),
  UNIQUE (call_brief_id, idempotency_key)
);

CREATE INDEX call_outcome_revisions_latest_idx
  ON call_outcome_revisions(call_brief_id, revision DESC);

CREATE INDEX call_outcome_revisions_metrics_idx
  ON call_outcome_revisions(outcome, provenance, created_at DESC);

CREATE TABLE call_feedback_revisions (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id),
  user_id uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  goal_result varchar(16) NOT NULL CHECK (
    goal_result IN ('yes', 'partly', 'no')
  ),
  transcript_quality varchar(24) CHECK (
    transcript_quality IS NULL
    OR transcript_quality IN ('good', 'some_errors', 'poor')
  ),
  comment_ciphertext text,
  payload_fingerprint char(64) NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_brief_id, revision),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX call_feedback_revisions_latest_idx
  ON call_feedback_revisions(call_brief_id, revision DESC);

CREATE INDEX call_feedback_revisions_metrics_idx
  ON call_feedback_revisions(goal_result, transcript_quality, created_at DESC);

CREATE FUNCTION prevent_call_outcome_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'call outcome and feedback revisions are immutable';
END;
$$;

CREATE TRIGGER call_outcome_revisions_immutable
BEFORE UPDATE OR DELETE ON call_outcome_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_call_outcome_revision_mutation();

CREATE TRIGGER call_feedback_revisions_immutable
BEFORE UPDATE OR DELETE ON call_feedback_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_call_outcome_revision_mutation();
