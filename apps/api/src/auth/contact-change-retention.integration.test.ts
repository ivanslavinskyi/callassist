import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { AccountDeletionService } from "./account-deletion-service";
import { PostgresAuthRepository } from "./postgres-auth-repository";

const database = isolatedTestDatabase();
const databaseUrl = database.url;
describe("contact challenge erasure", () => {
  const repository = new PostgresAuthRepository(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  beforeAll(() => database.setup(), 15_000);
  afterAll(async () => { await repository.close(); await sql.end(); await database.teardown(); });

  async function fixture() {
    const now = new Date();
    const user = await repository.createUser({
      email: `${randomUUID()}@example.test`, passwordHash: "fixture",
      phoneE164: `+417${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
      firstName: "Private", lastName: "Fixture", uiLocale: "en"
    });
    await repository.markPhoneVerified(user.id, now.toISOString());
    const sessionId = randomUUID();
    await repository.createSession({ id: sessionId, userId: user.id, tokenHash: randomUUID(),
      createdAt: now.toISOString(), lastSeenAt: now.toISOString(), revokedAt: null,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(), userAgent: "test" });
    const ids: string[] = [];
    for (const state of ["pending", "completed", "expired", "invalidated"]) {
      const id = randomUUID(); ids.push(id);
      const created = new Date(now.getTime() - 31 * 24 * 60 * 60_000);
      const expires = state === "pending" ? new Date(now.getTime() + 60_000) : new Date(created.getTime() + 60_000);
      const completed = state === "completed" ? new Date(created.getTime() + 1_000) : null;
      const invalidated = state === "invalidated" ? new Date(created.getTime() + 1_000) : null;
      // Direct fixtures cover historical states without sending provider messages.
      await sql`INSERT INTO phone_change_challenges
        (id,user_id,initiating_session_id,new_phone_e164,created_at,expires_at,completed_at,invalidated_at)
        VALUES (${id},${user.id},${sessionId},'+41710000002',${created},${expires},${completed},${invalidated})`;
      await sql`INSERT INTO email_change_challenges
        (id,user_id,initiating_session_id,new_email,code_hash,created_at,expires_at,completed_at,invalidated_at)
        VALUES (${id},${user.id},${sessionId},'private-contact@example.test',${"a".repeat(64)},${created},${expires},${completed},${invalidated})`;
      if (state === "completed") {
        for (const table of ["phone_change_events", "email_change_events"]) {
          await sql.unsafe(`INSERT INTO ${table}
            (id,user_id,challenge_id,revoked_session_count,invalidated_recovery_challenge_count,invalidated_recovery_grant_count,created_at)
            VALUES ($1,$2,$3,0,0,0,$4)`, [randomUUID(), user.id, id, now]);
        }
      }
    }
    return { user, sessionId, now, ids };
  }

  async function assertErased(userId: string) {
    for (const table of ["phone_change_challenges", "email_change_challenges"]) {
      expect(await sql.unsafe(`SELECT id FROM ${table} WHERE user_id = $1`, [userId])).toHaveLength(0);
    }
    for (const table of ["phone_change_events", "email_change_events"]) {
      expect(await sql.unsafe(`SELECT id FROM ${table} WHERE user_id = $1`, [userId])).toHaveLength(1);
      await expect(sql.unsafe(`DELETE FROM ${table} WHERE user_id = $1`, [userId])).rejects.toThrow("immutable");
    }
  }

  it("erases every challenge state atomically and rejects a racing contact change", async () => {
    const { user, sessionId, now } = await fixture();
    const requestId = randomUUID();
    await repository.requestAccountDeletion({ requestId, userId: user.id, now: now.toISOString(), maxAttempts: 5 });
    // Claim this fixture explicitly, without competing with other worker suites.
    await sql`UPDATE account_deletion_requests SET status='processing', lease_owner='retention-test',
      leased_at=${now}, lease_expires_at=${new Date(now.getTime() + 60_000)}, attempt_count=1
      WHERE id=${requestId}`;
    const [completed, raced] = await Promise.all([
      repository.completeAccountDeletion({ requestId, workerId: "retention-test", now: now.toISOString() }),
      repository.createEmailChangeChallenge({ id: randomUUID(), userId: user.id, initiatingSessionId: sessionId,
        expectedPasswordHash: "fixture", newEmail: "race@example.test", codeHash: "b".repeat(64),
        now: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() })
    ]);
    expect(completed).toBe(true); expect(raced).toBe(false);
    await assertErased(user.id);
  });

  it("cleans an idle account on the worker timer while preserving recent challenges", async () => {
    const { user, ids, now } = await fixture();
    const freshId = ids[0]!;
    await sql`UPDATE phone_change_challenges SET created_at=${now} WHERE id=${freshId}`;
    await sql`UPDATE email_change_challenges SET created_at=${now} WHERE id=${freshId}`;
    const service = new CallService(new InMemoryCallRepository());
    const worker = new AccountDeletionService({ authRepository: repository, callService: service,
      workerEnabled: true, pollIntervalMs: 10, now: () => now });
    worker.start();
    try {
      await expect.poll(async () => (await sql`SELECT id FROM email_change_challenges WHERE user_id=${user.id}`).length)
        .toBe(1);
      expect(await sql`SELECT id FROM phone_change_challenges WHERE user_id=${user.id}`).toHaveLength(1);
      now.setTime(now.getTime() + 31 * 24 * 60 * 60_000);
      await expect.poll(async () => (await sql`SELECT id FROM email_change_challenges WHERE user_id=${user.id}`).length)
        .toBe(0);
      await assertErased(user.id);
    } finally { await worker.close(); await service.close(); }
  });
});
