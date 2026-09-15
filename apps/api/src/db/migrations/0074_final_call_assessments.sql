CREATE TABLE call_assessments (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  call_attempt_id uuid PRIMARY KEY REFERENCES call_attempts(id) ON DELETE RESTRICT,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE RESTRICT,
  compilation_id uuid NOT NULL REFERENCES call_compilations(id) ON DELETE RESTRICT,
  transcript_revision_id uuid REFERENCES final_transcript_revisions(id) ON DELETE RESTRICT,
  source_hash varchar(64), plan_hash varchar(64), evaluator_version varchar(200),
  status varchar(20) NOT NULL CHECK (status IN ('pending','ready','unavailable')),
  conversation varchar(20) CHECK (conversation IN ('confirmed','absent','uncertain')),
  goal varchar(20) CHECK (goal IN ('achieved','partial','not_achieved','uncertain')),
  reason varchar(40) CHECK (reason IN ('deadline','generation_failed','evidence_uncertain')),
  payload_ciphertext text,
  deadline_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ready' OR (transcript_revision_id IS NOT NULL AND source_hash IS NOT NULL
    AND plan_hash IS NOT NULL AND evaluator_version IS NOT NULL AND conversation IS NOT NULL AND goal IS NOT NULL))
);
CREATE INDEX call_assessments_call_idx ON call_assessments(call_brief_id);
CREATE INDEX call_assessments_due_idx ON call_assessments(deadline_at) WHERE status='pending';
ALTER TABLE credit_transactions DROP CONSTRAINT credit_qualification_shape;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_qualification_shape CHECK (
  qualification IS NULL OR COALESCE((type='call_charge' AND jsonb_typeof(qualification)='object' AND (
    (qualification->>'version'='1' AND qualification ? 'questionSegmentId' AND qualification ? 'answerSegmentId'
      AND qualification->>'category' IN ('task_answer','cannot_answer','referral','message_acknowledged'))
    OR (qualification->>'version'='2' AND qualification ? 'transcriptRevisionId' AND qualification ? 'sourceHash'
      AND qualification ? 'evaluatorVersion' AND qualification->>'category' IN ('task_answer','cannot_answer','referral','message_acknowledged'))
  )),false)
);
