CREATE TABLE superadmin_notification_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  settings jsonb NOT NULL DEFAULT '{"enabled":false,"registrations":true,"calls":true,"recipientUserIds":[]}',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO superadmin_notification_settings(id) VALUES (true);

CREATE TABLE superadmin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('registration','call')),
  source_id uuid NOT NULL,
  source_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  call_brief_id uuid REFERENCES call_briefs(id) ON DELETE CASCADE,
  call_attempt_id uuid REFERENCES call_attempts(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','accepted','failed','cancelled')),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid, lease_until timestamptz,
  send_attempts integer NOT NULL DEFAULT 0,
  first_send_at timestamptz,
  payload_ciphertext text,
  provider_id text,
  last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,source_id,recipient_user_id),
  CHECK ((kind='registration' AND call_attempt_id IS NULL AND call_brief_id IS NULL AND source_user_id IS NOT NULL)
    OR (kind='call' AND call_attempt_id IS NOT NULL AND call_brief_id IS NOT NULL))
);
CREATE INDEX superadmin_notifications_due ON superadmin_notifications(run_after) WHERE status IN ('queued','processing');
CREATE INDEX superadmin_notifications_recent ON superadmin_notifications(created_at DESC);
CREATE INDEX superadmin_notifications_source_user ON superadmin_notifications(source_user_id);
CREATE INDEX superadmin_notifications_call ON superadmin_notifications(call_brief_id);
CREATE INDEX superadmin_notifications_recipient ON superadmin_notifications(recipient_user_id);

CREATE TABLE superadmin_notification_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  notification_id uuid REFERENCES superadmin_notifications(id) ON DELETE SET NULL,
  action text NOT NULL, reason text, previous_settings jsonb, next_settings jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A separate marker prevents a later phone change from becoming another signup.
-- Existing registrations are deliberately not emailed by this migration.
ALTER TABLE users ADD COLUMN registration_completed_at timestamptz;
UPDATE users SET registration_completed_at=phone_verified_at WHERE phone_verified_at IS NOT NULL;

CREATE FUNCTION enqueue_superadmin_notification(event_kind text, event_id uuid, owner_id uuid,
  brief_id uuid, attempt_id uuid, event_time timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE config jsonb;
BEGIN
  -- Same lock order as settings changes and dispatch. Turning a category off
  -- cancels pending messages, including concurrent event creation.
  SELECT settings INTO config FROM superadmin_notification_settings WHERE id=true FOR SHARE;
  IF NOT (config->>'enabled')::boolean OR NOT (config->>CASE WHEN event_kind='call' THEN 'calls' ELSE 'registrations' END)::boolean THEN RETURN; END IF;
  INSERT INTO superadmin_notifications(kind,source_id,source_user_id,call_brief_id,call_attempt_id,recipient_user_id,occurred_at)
    SELECT event_kind,event_id,owner_id,brief_id,attempt_id,u.id,event_time FROM users u
    WHERE u.id::text IN (SELECT jsonb_array_elements_text(config->'recipientUserIds'))
      AND u.role='superadmin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.phone_verified_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed')
    ON CONFLICT DO NOTHING;
END; $$;

CREATE FUNCTION notify_superadmin_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.registration_completed_at IS NULL AND OLD.phone_verified_at IS NULL AND NEW.phone_verified_at IS NOT NULL AND NEW.status='active' THEN
    NEW.registration_completed_at := NEW.phone_verified_at;
    PERFORM enqueue_superadmin_notification('registration',NEW.id,NEW.id,NULL,NULL,NEW.phone_verified_at);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER superadmin_registration BEFORE UPDATE OF phone_verified_at ON users
  FOR EACH ROW EXECUTE FUNCTION notify_superadmin_registration();

CREATE FUNCTION notify_superadmin_call() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
    SELECT user_id INTO owner_id FROM call_briefs WHERE id=NEW.call_brief_id AND data_deleted_at IS NULL;
    IF FOUND THEN
      PERFORM enqueue_superadmin_notification('call',NEW.id,owner_id,NEW.call_brief_id,NEW.id,NEW.ended_at);
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER superadmin_call AFTER UPDATE OF ended_at ON call_attempts
  FOR EACH ROW EXECUTE FUNCTION notify_superadmin_call();

CREATE FUNCTION redact_superadmin_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='call_briefs' THEN
    IF NEW.data_deleted_at IS NOT NULL THEN
      UPDATE superadmin_notifications SET payload_ciphertext=NULL,
        status=CASE WHEN status IN ('queued','processing') THEN 'cancelled' ELSE status END,updated_at=now()
        WHERE call_brief_id=NEW.id;
    END IF;
  ELSE
    IF NEW.status='deleted' THEN
      UPDATE superadmin_notifications SET payload_ciphertext=NULL,
        status=CASE WHEN status IN ('queued','processing') THEN 'cancelled' ELSE status END,updated_at=now()
        WHERE source_user_id=NEW.id;
    END IF;
    IF NEW.status<>'active' OR NEW.role<>'superadmin' OR NEW.email_verified_at IS NULL OR NEW.phone_verified_at IS NULL OR NEW.email IS DISTINCT FROM OLD.email THEN
      UPDATE superadmin_notifications SET payload_ciphertext=NULL,
        status=CASE WHEN status IN ('queued','processing') THEN 'cancelled' ELSE status END,updated_at=now()
        WHERE recipient_user_id=NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER superadmin_notification_call_redaction AFTER UPDATE OF data_deleted_at ON call_briefs
  FOR EACH ROW EXECUTE FUNCTION redact_superadmin_notifications();
CREATE TRIGGER superadmin_notification_user_redaction AFTER UPDATE OF status,role,email,email_verified_at,phone_verified_at ON users
  FOR EACH ROW EXECUTE FUNCTION redact_superadmin_notifications();
