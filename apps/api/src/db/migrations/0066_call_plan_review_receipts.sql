CREATE TABLE call_compilation_review_policies (
  compilation_id uuid PRIMARY KEY REFERENCES call_compilations(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version IN (1,2))
);
-- Only exact approvals which predate this cutover retain v1. Missing/new rows always mean v2.
INSERT INTO call_compilation_review_policies(compilation_id, policy_version)
  SELECT id, CASE WHEN EXISTS (SELECT 1 FROM call_compilation_approvals a WHERE a.compilation_id = c.id) THEN 1 ELSE 2 END
  FROM call_compilations c;
CREATE FUNCTION create_compilation_review_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO call_compilation_review_policies VALUES (NEW.id, 2); RETURN NEW; END; $$;
CREATE TRIGGER call_compilation_review_policy_created AFTER INSERT ON call_compilations
  FOR EACH ROW EXECUTE FUNCTION create_compilation_review_policy();
CREATE FUNCTION prevent_review_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'review policy is immutable'; END; $$;
CREATE TRIGGER call_compilation_review_policy_immutable BEFORE UPDATE OR DELETE ON call_compilation_review_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_review_policy_mutation();

CREATE TABLE call_plan_review_receipts (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE RESTRICT,
  compilation_id uuid NOT NULL UNIQUE REFERENCES call_compilations(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  snapshot_hash varchar(64) NOT NULL,
  mode varchar(16) NOT NULL CHECK (mode IN ('original','translated')),
  language varchar(35) NOT NULL,
  selection_revision integer NOT NULL CHECK (selection_revision > 0),
  artifact_id uuid REFERENCES call_text_artifacts(id) ON DELETE RESTRICT,
  artifact_hash varchar(64),
  payload_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (compilation_id, call_brief_id, revision, snapshot_hash)
    REFERENCES call_compilations(id, call_brief_id, revision, snapshot_hash),
  CHECK ((mode = 'original' AND artifact_id IS NULL AND artifact_hash IS NULL)
    OR (mode = 'translated' AND artifact_id IS NOT NULL AND artifact_hash IS NOT NULL)),
  UNIQUE (id, compilation_id)
);
CREATE TRIGGER call_plan_review_receipts_immutable BEFORE UPDATE OR DELETE ON call_plan_review_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_text_source_mutation();
ALTER TABLE call_attempts ADD COLUMN review_receipt_id uuid, ADD COLUMN content_language varchar(35);
ALTER TABLE call_attempts ADD CONSTRAINT call_attempts_review_receipt_fk FOREIGN KEY (review_receipt_id, compilation_id)
  REFERENCES call_plan_review_receipts(id, compilation_id);
CREATE FUNCTION enforce_attempt_review_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE((SELECT policy_version FROM call_compilation_review_policies WHERE compilation_id = NEW.compilation_id), 2) = 2
    AND NOT EXISTS (SELECT 1 FROM call_plan_review_receipts r WHERE r.id = NEW.review_receipt_id
      AND r.compilation_id = NEW.compilation_id AND r.call_brief_id = NEW.call_brief_id AND r.payload_ciphertext IS NOT NULL)
  THEN RAISE EXCEPTION 'current plan review receipt required' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER call_attempts_require_review_receipt BEFORE INSERT ON call_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_attempt_review_receipt();
