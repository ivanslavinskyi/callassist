CREATE TABLE plan_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compilation_id uuid NOT NULL UNIQUE REFERENCES call_compilations(id) ON DELETE CASCADE,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  preparation_id uuid REFERENCES call_preparation_requests(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  plan_revision integer NOT NULL CHECK (plan_revision > 0), snapshot_hash text NOT NULL,
  previous_case_id uuid REFERENCES plan_review_cases(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('blocked','needs_clarification')),
  category text NOT NULL CHECK (category IN ('policy_signal','clarification','unsupported_task','technical_failure')),
  reasons text[] NOT NULL, risk_level text NOT NULL CHECK (risk_level IN ('low','high')),
  call_locale text NOT NULL, compiler_version text NOT NULL, policy_version text NOT NULL, model text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','resolved')),
  resolution text CHECK (resolution IN ('benign','policy_violation','false_positive','technical_issue')),
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note_ciphertext text, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  historical boolean NOT NULL DEFAULT false, occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='resolved') = (resolution IS NOT NULL))
);
CREATE INDEX plan_review_cases_recent ON plan_review_cases(occurred_at DESC,id DESC);
CREATE INDEX plan_review_cases_queue ON plan_review_cases(status,occurred_at DESC);
CREATE INDEX plan_review_cases_user ON plan_review_cases(user_id,occurred_at DESC);
CREATE INDEX plan_review_cases_call ON plan_review_cases(call_brief_id,plan_revision);
CREATE TABLE plan_review_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES plan_review_cases(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL, reason_ciphertext text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_review_audit_case ON plan_review_audit(case_id,created_at);

ALTER TABLE superadmin_notifications DROP CONSTRAINT superadmin_notifications_kind_check;
ALTER TABLE superadmin_notifications ADD CONSTRAINT superadmin_notifications_kind_check
  CHECK (kind IN ('registration','call','plan_review'));
ALTER TABLE superadmin_notifications DROP CONSTRAINT superadmin_notifications_check;
ALTER TABLE superadmin_notifications ADD CONSTRAINT superadmin_notifications_check CHECK (
  (kind='registration' AND call_attempt_id IS NULL AND call_brief_id IS NULL AND source_user_id IS NOT NULL)
  OR (kind='call' AND call_attempt_id IS NOT NULL AND call_brief_id IS NOT NULL)
  OR (kind='plan_review' AND call_attempt_id IS NULL AND call_brief_id IS NOT NULL)
);
ALTER TABLE superadmin_notifications ADD COLUMN delivery_generation integer NOT NULL DEFAULT 1 CHECK (delivery_generation > 0);
UPDATE superadmin_notification_settings SET settings=settings || '{"planReviews":true,"planReviewSignalsOnly":false}'::jsonb,
  revision=revision+1;
ALTER TABLE superadmin_notification_settings ALTER COLUMN settings SET DEFAULT
  '{"enabled":false,"registrations":true,"calls":true,"planReviews":true,"planReviewSignalsOnly":false,"recipientUserIds":[]}';

CREATE OR REPLACE FUNCTION enqueue_superadmin_notification(event_kind text, event_id uuid, owner_id uuid,
  brief_id uuid, attempt_id uuid, event_time timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE config jsonb;
BEGIN
  SELECT settings INTO config FROM superadmin_notification_settings WHERE id=true FOR SHARE;
  IF NOT COALESCE((config->>'enabled')::boolean,false) THEN RETURN; END IF;
  IF event_kind='plan_review' THEN
    IF NOT COALESCE((config->>'planReviews')::boolean,true) THEN RETURN; END IF;
    IF COALESCE((config->>'planReviewSignalsOnly')::boolean,false)
      AND NOT EXISTS(SELECT 1 FROM plan_review_cases WHERE id=event_id AND category='policy_signal') THEN RETURN; END IF;
  ELSIF NOT COALESCE((config->>CASE WHEN event_kind='call' THEN 'calls' ELSE 'registrations' END)::boolean,false) THEN RETURN;
  END IF;
  INSERT INTO superadmin_notifications(kind,source_id,source_user_id,call_brief_id,call_attempt_id,recipient_user_id,occurred_at)
    SELECT event_kind,event_id,owner_id,brief_id,attempt_id,u.id,event_time FROM users u
    WHERE u.id::text IN (SELECT jsonb_array_elements_text(config->'recipientUserIds'))
      AND u.role='superadmin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.phone_verified_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed')
    ON CONFLICT DO NOTHING;
END; $$;

CREATE FUNCTION redact_plan_review_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_TABLE_NAME='call_briefs' AND NEW.data_deleted_at IS NOT NULL) THEN
    UPDATE plan_review_cases SET note_ciphertext=NULL WHERE call_brief_id=NEW.id;
    UPDATE plan_review_audit SET reason_ciphertext=NULL WHERE case_id IN (SELECT id FROM plan_review_cases WHERE call_brief_id=NEW.id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER plan_review_evidence_redaction AFTER UPDATE OF data_deleted_at ON call_briefs
  FOR EACH ROW EXECUTE FUNCTION redact_plan_review_evidence();

CREATE FUNCTION redact_plan_review_account_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='deleted' THEN
    UPDATE plan_review_cases SET note_ciphertext=NULL WHERE user_id=NEW.id;
    UPDATE plan_review_audit SET reason_ciphertext=NULL WHERE case_id IN (SELECT id FROM plan_review_cases WHERE user_id=NEW.id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER plan_review_account_redaction AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION redact_plan_review_account_evidence();

-- Historical cases require the application's encryption key. The separate
-- dry-run/apply backfill reads immutable compilations and NEVER enqueues email.
