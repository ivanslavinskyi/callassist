import "../src/config/load-env";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { isolatedTestDatabase } from "../src/db/isolated-test-database";

const fixture = isolatedTestDatabase();
const cli = fileURLToPath(new URL("../dist/db/configure-runtime-profile.js", import.meta.url));
let sql: postgres.Sql | undefined;
try {
  await fixture.setup(); sql = postgres(fixture.url, { max: 1, onnotice: () => undefined });
  function run(profile: "native_v2" | "managed", args: string[], expectedExit = 0) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000,
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: fixture.url, STORAGE_DRIVER: "postgres",
        CALL_RUNTIME_PROFILE: profile, VOICE_RUNTIME_DRIVER: "", VOICE_RUNTIME_LIVE_FALLBACK: "",
        VOICE_RUNTIME_LIVE_EXPERIMENT: "", REALTIME_AGENT_HANGUP_ENABLED: "" } });
    assert.equal(result.status, expectedExit, "Built runtime-profile command returned an unexpected exit code");
    return result;
  }
  // A read-only check must neither invoke the bundled migrator nor repair its ledger.
  const [migration] = await sql`SELECT * FROM schema_migrations ORDER BY name DESC LIMIT 1`;
  await sql`DELETE FROM schema_migrations WHERE name=${migration!.name}`;
  for (const args of [[], ["--check"], ["--apply"]]) {
    const mismatch = run("native_v2", args, 1);
    assert.match(mismatch.stderr, /RUNTIME_PROFILE_SCHEMA_MISMATCH/);
    assert.equal(mismatch.stdout.trim(), "");
    assert.equal((await sql`SELECT name FROM schema_migrations WHERE name=${migration!.name}`).length, 0);
  }
  await sql`INSERT INTO schema_migrations(name,checksum_sha256,applied_at)
    VALUES(${migration!.name},${migration!.checksum_sha256},${migration!.applied_at})`;
  const inspect = (profile: "native_v2" | "managed", args: string[], expectedExit = 0) => JSON.parse(run(profile, args, expectedExit).stdout);
  assert.equal(inspect("native_v2", ["--check"], 1).ready, false);
  assert.equal(inspect("native_v2", []).changed, false);
  assert.equal(inspect("native_v2", ["--apply"]).changed, true);
  assert.equal(inspect("native_v2", ["--apply"]).changed, false);
  assert.equal(inspect("native_v2", ["--check"]).ready, true);
  assert.equal(inspect("managed", ["--apply"]).changed, true);
  assert.equal(inspect("managed", ["--check"]).ready, true);
  assert.equal((await sql`SELECT count(*)::int AS count FROM preparation_settings_audit`)[0]!.count, 2);
  console.log(JSON.stringify({ event: "built_runtime_profiles_verified", migrationOnCheck: false,
    nativeActivation: true, idempotent: true, managedRollback: true, providerTraffic: false }));
} finally { await sql?.end(); await fixture.teardown(); }
