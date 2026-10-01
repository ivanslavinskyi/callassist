-- Additive: original transcript hashes, approvals and settled billing evidence stay intact.
ALTER TABLE call_text_artifacts ADD COLUMN context_hash text;
ALTER TABLE call_text_artifacts ADD COLUMN context_ciphertext text;
ALTER TABLE call_text_artifacts ADD CONSTRAINT call_text_context_hash_format
  CHECK (context_hash IS NULL OR context_hash ~ '^[a-f0-9]{64}$');

CREATE TABLE call_assessment_revisions (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  artifact_id uuid PRIMARY KEY REFERENCES call_text_artifacts(id),
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id),
  call_attempt_id uuid NOT NULL REFERENCES call_attempts(id),
  transcript_revision_id uuid NOT NULL REFERENCES final_transcript_revisions(id),
  context_hash text NOT NULL,
  evaluator_version text NOT NULL,
  payload_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_assessment_revisions_call_idx ON call_assessment_revisions(call_brief_id, created_at);

CREATE TABLE call_terminal_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id),
  call_attempt_id uuid NOT NULL REFERENCES call_attempts(id),
  revision integer NOT NULL CHECK (revision > 0),
  payload_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(call_attempt_id, revision)
);
