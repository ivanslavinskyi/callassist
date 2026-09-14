import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";

const database = isolatedTestDatabase();
let sql: postgres.Sql, repository: PostgresCallRepository;
beforeAll(async () => {
  await database.setup();
  sql = postgres(database.url, { max: 3 });
  repository = new PostgresCallRepository(database.url, Buffer.alloc(32, 9));
}, 30000);
afterAll(async () => { await repository?.close(); await sql?.end(); await database.teardown(); });

it("takes the owner lock before the brief, allowing an owner-first text mutation to finish", async () => {
  const owner = randomUUID();
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${owner},${`${owner}@example.com`},'test-only','+41710000219',now(),'Nina','Keller','user','active','en',now())`;
  const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41523686688",
    objective: "Ask which documents are needed for registration", assistantProfileId: "sebastian",
    representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "de-CH",
    allowLanguageSwitch: false, allowedFacts: [] });
  const compilation = await new DeterministicBriefCompiler().compile(input);
  const brief = await repository.create(input, compilation, owner);
  let pending: Promise<unknown> = Promise.resolve();
  await sql.begin(async tx => {
    const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx`SELECT id FROM users WHERE id=${owner} FOR UPDATE`;
    pending = repository.enqueueCallRecompilation({ input, userId: owner, callBriefId: brief.id,
      idempotencyKey: randomUUID(), inputFingerprint: "a".repeat(64), now: new Date().toISOString() });
    // Attach immediately so a pre-fix deadlock is reported as the test failure.
    void pending.catch(() => undefined);
    await vi.waitFor(async () => {
      const [waiting] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND ${pid}=ANY(pg_blocking_pids(pid))`;
      expect(waiting.count).toBeGreaterThan(0);
    }, { timeout: 5000 });
    // Text generation and deletion use this owner -> brief order. Before the fix,
    // enqueue held the brief and needed a users FK lock: these two statements deadlocked.
    await tx`SELECT id FROM call_briefs WHERE id=${brief.id} FOR UPDATE`;
  });
  await expect(pending).resolves.toMatchObject({ status: "queued" });
});
