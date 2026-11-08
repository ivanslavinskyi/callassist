import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { defaultPreparationCapacity, defaultPreparationRuntimePolicy } from "@callassist/contracts";
import { isolatedTestDatabase } from "./isolated-test-database";
import { configureRuntimeProfile } from "./configure-runtime-profile";
import { PostgresPreparationPolicyStore } from "../storage/preparation-policy-store";
import { assertRuntimeProfileReady } from "../runtime/runtime-profile-readiness";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { approvedCall } from "../voice/voice-test-helpers";

const db = isolatedTestDatabase(), owner = randomUUID();
const env = { STORAGE_DRIVER: "postgres", DATABASE_URL: db.url, CALL_RUNTIME_PROFILE: "native_v2" };
const policy = { ...defaultPreparationRuntimePolicy, revision: 7, promptVersion: "preparation-2026-10-05",
  generation: { model: "gpt-6-luna", serviceTier: "fast" }, maxProviderRequests: 9 };
const capacity = { ...defaultPreparationCapacity, generationSlots: 3 };
let sql: postgres.Sql;
beforeAll(async () => {
  await db.setup(); sql = postgres(db.url, { max: 2, onnotice: () => undefined });
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,created_at)
    VALUES(${owner},${`${owner}@example.test`},'synthetic','+41710000121','Test','Owner',now())`;
});
beforeEach(async () => {
  await sql`UPDATE preparation_settings SET policy=${sql.json(policy)},capacity=${sql.json(capacity)},approved_profiles='["gpt-5.6:default"]' WHERE id=true`;
});
afterAll(async () => { await sql?.end(); await db.teardown(); });
async function request(status: "cancelled" | "queued") {
  const id = randomUUID();
  await sql`INSERT INTO call_preparation_requests(id,user_id,idempotency_key,input_fingerprint,status,input_ciphertext,completed_at)
    VALUES(${id},${owner},${randomUUID()},${"a".repeat(64)},${status},${status === "queued" ? "synthetic" : null},${status === "cancelled" ? new Date() : null})`;
  return id;
}
async function settings() { return (await sql`SELECT policy,capacity,approved_profiles FROM preparation_settings WHERE id=true`)[0]!; }

it("previews without writes, atomically applies once under concurrency and preserves models, limits and pinned work", async () => {
  const id = await request("cancelled");
  const beforeRequest = await sql`SELECT * FROM call_preparation_requests WHERE id=${id}`;
  const before = await settings(), audit = await sql`SELECT * FROM preparation_settings_audit`;
  expect(await configureRuntimeProfile([], env)).toMatchObject({ mode: "preview", changeRequired: true, changed: false, ready: false });
  expect(await configureRuntimeProfile(["--check"], env)).toMatchObject({ mode: "check", ready: false });
  expect(await settings()).toEqual(before);
  expect(await sql`SELECT * FROM preparation_settings_audit`).toEqual(audit);
  const results = await Promise.all([configureRuntimeProfile(["--apply"], env), configureRuntimeProfile(["--apply"], env)]);
  expect(results.filter(result => result.changed)).toHaveLength(1);
  expect(results.every(result => result.ready)).toBe(true);
  expect(await settings()).toEqual({ ...before, policy: { ...before.policy, revision: 8, promptVersion: "preparation-live-native-integrity-2026-11-08" } });
  expect(await sql`SELECT * FROM call_preparation_requests WHERE id=${id}`).toEqual(beforeRequest);
  const rows = await sql`SELECT * FROM preparation_settings_audit ORDER BY created_at`;
  expect(rows).toHaveLength(audit.length + 1);
  expect(rows.at(-1)!.next_settings).toMatchObject({ runtimeProfile: "native_v2", runtimeRelease: "native-v2-2026-11-08" });
  const repository = { getPreparationSettings: () => new PostgresPreparationPolicyStore(sql).get() };
  expect(await assertRuntimeProfileReady(repository, env)).toMatchObject({ ready: true });
  await expect(assertRuntimeProfileReady(repository, { ...env, CALL_RUNTIME_PROFILE: "managed" })).rejects.toThrow("RUNTIME_PROFILE_MISMATCH");
  const fresh = await request("cancelled");
  expect((await sql`SELECT runtime_policy FROM call_preparation_requests WHERE id=${fresh}`)[0]!.runtime_policy.promptVersion)
    .toBe("preparation-live-native-integrity-2026-11-08");
  expect(await configureRuntimeProfile(["--apply"], { ...env, CALL_RUNTIME_PROFILE: "managed" })).toMatchObject({ changed: true, ready: true });
  expect((await settings()).policy).toEqual({ ...before.policy, revision: 9 });
  expect(await sql`SELECT * FROM call_preparation_requests WHERE id=${id}`).toEqual(beforeRequest);
});

it("refuses a policy transition while preparation work remains queued", async () => {
  const id = await request("queued"), before = await settings();
  try {
    await expect(configureRuntimeProfile(["--apply"], env)).rejects.toThrow("RUNTIME_PROFILE_BUSY");
    expect(await settings()).toEqual(before);
  } finally {
    await sql`UPDATE call_preparation_requests SET status='cancelled',input_ciphertext=NULL,completed_at=now() WHERE id=${id}`;
  }
});

it("refuses a transition during an active call and preserves its approval", async () => {
  const calls = new PostgresCallRepository(db.url, Buffer.alloc(32, 12));
  const h = await approvedCall(undefined, calls);
  try {
    const before = await sql`SELECT * FROM call_compilation_approvals WHERE call_brief_id=${h.brief.id}`;
    await expect(configureRuntimeProfile(["--apply"], env)).rejects.toThrow("RUNTIME_PROFILE_BUSY");
    expect(await sql`SELECT * FROM call_compilation_approvals WHERE call_brief_id=${h.brief.id}`).toEqual(before);
  } finally {
    await sql`UPDATE call_attempts SET status='completed',ended_at=now() WHERE id=${h.attempt.id}`;
    await h.service.close();
  }
});

it("rejects a changed migration checksum before any policy write", async () => {
  const [migration] = await sql`SELECT * FROM schema_migrations ORDER BY name DESC LIMIT 1`;
  const before = await settings();
  try {
    await sql`UPDATE schema_migrations SET checksum_sha256=${"0".repeat(64)} WHERE name=${migration!.name}`;
    await expect(configureRuntimeProfile(["--apply"], env)).rejects.toThrow("RUNTIME_PROFILE_SCHEMA_MISMATCH");
    expect(await settings()).toEqual(before);
  } finally { await sql`UPDATE schema_migrations SET checksum_sha256=${migration!.checksum_sha256} WHERE name=${migration!.name}`; }
});
