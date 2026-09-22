-- A dedicated durable queue keeps archive work outside the sequential call-job consumer.
CREATE TABLE admin_telemetry_privacy_epoch (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), revision bigint NOT NULL DEFAULT 0, worker_seen_at timestamptz
);
INSERT INTO admin_telemetry_privacy_epoch(id) VALUES(true);

CREATE TABLE admin_telemetry_exports (
  id uuid PRIMARY KEY, actor_user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
  input_hash text NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
  from_at timestamptz NOT NULL, to_at timestamptz NOT NULL CHECK(to_at > from_at),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','ready','failed','cancelled','expired','revoked')),
  generation integer NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 3),
  lease_token uuid, lease_until timestamptz, run_after timestamptz NOT NULL DEFAULT now(),
  privacy_revision bigint, snapshot_at timestamptz, expires_at timestamptz,
  phase text NOT NULL DEFAULT 'queued', records integer NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0,
  counts jsonb NOT NULL DEFAULT '{}', sha256 text, failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_user_id,request_id)
);
CREATE UNIQUE INDEX admin_telemetry_export_one_active_actor ON admin_telemetry_exports(actor_user_id)
  WHERE status IN ('queued','running');
CREATE UNIQUE INDEX admin_telemetry_export_one_running ON admin_telemetry_exports((true)) WHERE status='running';
CREATE INDEX admin_telemetry_exports_due ON admin_telemetry_exports(run_after,created_at) WHERE status='queued';
CREATE INDEX admin_telemetry_exports_owner ON admin_telemetry_exports(actor_user_id,created_at DESC,id DESC);

CREATE TABLE admin_telemetry_export_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), export_id uuid NOT NULL REFERENCES admin_telemetry_exports(id) ON DELETE CASCADE,
  generation integer NOT NULL, part integer NOT NULL CHECK(part >= 0),
  payload_ciphertext text NOT NULL, byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND 1048576), sha256 text NOT NULL,
  UNIQUE(export_id,generation,part)
);
CREATE TABLE admin_telemetry_export_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), export_id uuid NOT NULL REFERENCES admin_telemetry_exports(id),
  actor_user_id uuid REFERENCES users(id), action text NOT NULL,
  generation integer NOT NULL, code text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER admin_telemetry_export_audit_immutable BEFORE UPDATE OR DELETE ON admin_telemetry_export_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
CREATE INDEX call_attempts_export_started ON call_attempts(started_at,id);
CREATE INDEX call_preparation_export_created ON call_preparation_requests(created_at,id);

-- Conservative global invalidation is intentional: also closes deletion before
-- scope/membership has been captured. No source-row locks are taken by publishers.
-- Lock order in export code: epoch, export. Never lock users/calls after epoch.
CREATE FUNCTION invalidate_admin_telemetry_exports() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE admin_telemetry_privacy_epoch SET revision=revision+1 WHERE id=true;
  INSERT INTO admin_telemetry_export_events(export_id,action,generation,code)
    SELECT id,'revoked',generation,'EXPORT_PRIVACY_CHANGED' FROM admin_telemetry_exports
    WHERE status IN ('queued','running','ready');
  UPDATE admin_telemetry_exports SET status='revoked',phase='revoked',failure_code='EXPORT_PRIVACY_CHANGED',
    lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status IN ('queued','running','ready');
  DELETE FROM admin_telemetry_export_parts;
  RETURN NEW;
END; $$;
CREATE TRIGGER admin_telemetry_call_deleted AFTER UPDATE OF data_deleted_at ON call_briefs
  FOR EACH ROW WHEN (OLD.data_deleted_at IS NULL AND NEW.data_deleted_at IS NOT NULL)
  EXECUTE FUNCTION invalidate_admin_telemetry_exports();
CREATE TRIGGER admin_telemetry_account_deletion AFTER INSERT ON account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION invalidate_admin_telemetry_exports();
CREATE TRIGGER admin_telemetry_user_access AFTER UPDATE OF role,status ON users
  FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION invalidate_admin_telemetry_exports();
