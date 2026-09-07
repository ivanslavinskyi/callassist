import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { requireTestDatabaseUrl } from "./require-test-database";

// Rotation/retention tests mutate all rows and need their own database, never a
// concurrent suite's fixtures. The test role needs CREATEDB (as in CI).
export function isolatedTestDatabase() {
  const base = new URL(requireTestDatabaseUrl());
  const name = `callassist_fixture_${randomUUID().replaceAll("-", "")}_test`;
  const target = new URL(base); target.pathname = `/${name}`;
  base.pathname = "/postgres";
  let created = false;
  const admin = postgres(base.toString(), { max: 1, onnotice: () => undefined });
  return {
    url: target.toString(),
    async setup() {
      await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
      created = true;
      await runMigrations(target.toString());
    },
    async teardown() {
      try {
        if (created && /^callassist_fixture_[a-f0-9]{32}_test$/.test(name)) {
          await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
        }
      } finally { await admin.end(); }
    }
  };
}
