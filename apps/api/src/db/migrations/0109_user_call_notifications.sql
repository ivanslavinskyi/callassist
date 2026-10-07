-- Freeze interface copy language independently of generated text and call language.
ALTER TABLE call_briefs ADD COLUMN creation_ui_locale text;
UPDATE call_briefs b SET creation_ui_locale=COALESCE(
  (SELECT split_part(lower(l.preferences->>'uiLocaleHint'),'-',1)
   FROM call_preparation_requests p JOIN call_preparation_language_contexts l ON l.preparation_id=p.id
   WHERE p.call_brief_id=b.id AND p.target_call_brief_id IS NULL
     AND split_part(lower(l.preferences->>'uiLocaleHint'),'-',1) IN ('de','fr','it','rm','en','ru','uk')
   ORDER BY p.created_at LIMIT 1),
  (SELECT ui_locale FROM users WHERE id=b.user_id), 'en');
ALTER TABLE call_briefs ALTER COLUMN creation_ui_locale SET DEFAULT 'en';
ALTER TABLE call_briefs ALTER COLUMN creation_ui_locale SET NOT NULL;
ALTER TABLE call_briefs ADD CONSTRAINT call_creation_ui_locale CHECK (creation_ui_locale IN ('de','fr','it','rm','en','ru','uk'));
CREATE FUNCTION freeze_call_creation_locale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.creation_ui_locale IS DISTINCT FROM OLD.creation_ui_locale THEN RAISE EXCEPTION 'call creation locale is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER call_creation_locale_immutable BEFORE UPDATE OF creation_ui_locale ON call_briefs
  FOR EACH ROW EXECUTE FUNCTION freeze_call_creation_locale();

CREATE TABLE user_call_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  call_attempt_id uuid NOT NULL UNIQUE REFERENCES call_attempts(id) ON DELETE CASCADE,
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
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_call_notifications_due ON user_call_notifications(run_after) WHERE status IN ('queued','processing');
CREATE INDEX user_call_notifications_owner ON user_call_notifications(recipient_user_id);
CREATE INDEX user_call_notifications_call ON user_call_notifications(call_brief_id);

-- No historical backfill. Creation participates in the attempt completion transaction.
CREATE FUNCTION notify_call_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
    INSERT INTO user_call_notifications(call_brief_id,call_attempt_id,recipient_user_id,occurred_at)
      SELECT b.id,NEW.id,b.user_id,NEW.ended_at FROM call_briefs b JOIN users u ON u.id=b.user_id
      WHERE b.id=NEW.call_brief_id AND b.data_deleted_at IS NULL AND u.status='active' AND u.email_verified_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER owner_call_ended AFTER UPDATE OF ended_at ON call_attempts
  FOR EACH ROW EXECUTE FUNCTION notify_call_owner();

CREATE FUNCTION redact_user_call_notifications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='call_briefs' THEN
    IF NEW.data_deleted_at IS NULL THEN RETURN NEW; END IF;
    UPDATE user_call_notifications SET payload_ciphertext=NULL,
      status=CASE WHEN status IN ('queued','processing') THEN 'cancelled' ELSE status END,
      lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE call_brief_id=NEW.id;
  ELSIF TG_TABLE_NAME='account_deletion_requests' THEN
    UPDATE user_call_notifications SET payload_ciphertext=NULL,
      status=CASE WHEN status IN ('queued','processing') THEN 'cancelled' ELSE status END,
      lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE recipient_user_id=NEW.user_id;
  ELSE
    IF NEW.status='active' AND NEW.email_verified_at IS NOT NULL AND NEW.email IS NOT DISTINCT FROM OLD.email THEN RETURN NEW; END IF;
    UPDATE user_call_notifications SET payload_ciphertext=NULL,
      status=CASE WHEN status IN ('queued','processing') THEN 'cancelled' ELSE status END,
      lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE recipient_user_id=NEW.id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER owner_notification_call_redaction AFTER UPDATE OF data_deleted_at ON call_briefs
  FOR EACH ROW EXECUTE FUNCTION redact_user_call_notifications();
CREATE TRIGGER owner_notification_user_redaction AFTER UPDATE OF status,email,email_verified_at ON users
  FOR EACH ROW EXECUTE FUNCTION redact_user_call_notifications();
CREATE TRIGGER owner_notification_deletion_request AFTER INSERT ON account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION redact_user_call_notifications();
