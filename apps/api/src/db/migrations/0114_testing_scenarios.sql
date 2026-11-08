CREATE TABLE testing_access (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE test_scenarios (
  id uuid PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('draft','active','archived')),
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE test_scenario_revisions (
  id uuid PRIMARY KEY, scenario_id uuid NOT NULL REFERENCES test_scenarios(id),
  revision integer NOT NULL CHECK (revision > 0), payload_ciphertext text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, revision)
);
CREATE TABLE testing_audit (
  id uuid PRIMARY KEY, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  scenario_id uuid REFERENCES test_scenarios(id), revision integer NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke','scenario_saved')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE testing_preparation_attribution (
  preparation_id uuid PRIMARY KEY REFERENCES call_preparation_requests(id) ON DELETE CASCADE,
  tester boolean NOT NULL, by_role boolean NOT NULL,
  scenario_id uuid REFERENCES test_scenarios(id), scenario_revision integer,
  objective_modified boolean, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scenario_id IS NULL AND scenario_revision IS NULL AND objective_modified IS NULL)
    OR (scenario_id IS NOT NULL AND scenario_revision > 0 AND objective_modified IS NOT NULL))
);
CREATE FUNCTION purge_deleted_testing_access() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.status='deleted' THEN DELETE FROM testing_access WHERE user_id=NEW.id; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER testing_access_privacy AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION purge_deleted_testing_access();
