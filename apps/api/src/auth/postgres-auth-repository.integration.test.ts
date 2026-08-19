import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runMigrations } from "../db/migrate";
import { AuthRepositoryError } from "./auth-repository";
import { hashSessionToken } from "./auth-service";
import { PostgresAuthRepository } from "./postgres-auth-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresAuthRepository", () => {
  let repository: PostgresAuthRepository;
  let inspection: postgres.Sql;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    repository = new PostgresAuthRepository(databaseUrl!);
    inspection = postgres(databaseUrl!, { max: 1 });
  });

  afterAll(async () => {
    await Promise.all([repository?.close(), inspection?.end()]);
  });

  it("persists explicit names, phone verification, and revocable sessions", async () => {
    const suffix = randomUUID();
    const user = await repository.createUser({
      email: `nina.${suffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: `+417${suffix.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
      firstName: "Nina",
      lastName: "Keller",
      uiLocale: "de"
    });
    expect(user).toMatchObject({ firstName: "Nina", lastName: "Keller" });
    expect(user.phoneVerifiedAt).toBeNull();

    const verified = await repository.markPhoneVerified(
      user.id,
      new Date().toISOString()
    );
    expect(verified.phoneVerifiedAt).not.toBeNull();

    const tokenHash = hashSessionToken(`test-${suffix}`);
    const now = new Date();
    await repository.createSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent: "integration-test"
    });
    expect(
      await repository.findUserBySessionTokenHash(tokenHash, now.toISOString())
    ).toMatchObject({ user: { id: user.id }, session: { userId: user.id } });

    await repository.revokeSession(tokenHash, new Date().toISOString());
    expect(
      await repository.findUserBySessionTokenHash(
        tokenHash,
        new Date().toISOString()
      )
    ).toBeNull();
  });

  it("atomically audits account suspension and revokes every session", async () => {
    const actorSuffix = randomUUID();
    const targetSuffix = randomUUID();
    const actor = await repository.createUser({
      email: `admin.${actorSuffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(actorSuffix, "76"),
      firstName: "Ada",
      lastName: "Admin",
      uiLocale: "en"
    });
    const target = await repository.createUser({
      email: `target.${targetSuffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(targetSuffix, "77"),
      firstName: "Tara",
      lastName: "Target",
      uiLocale: "en"
    });
    await Promise.all([
      repository.markPhoneVerified(actor.id, new Date().toISOString()),
      repository.markPhoneVerified(target.id, new Date().toISOString())
    ]);
    await inspection`
      UPDATE users SET role = 'admin' WHERE id = ${actor.id}
    `;

    const now = new Date();
    const tokenHashes = [
      hashSessionToken(`target-a-${targetSuffix}`),
      hashSessionToken(`target-b-${targetSuffix}`)
    ];
    for (const [index, tokenHash] of tokenHashes.entries()) {
      await repository.createSession({
        id: randomUUID(),
        userId: target.id,
        tokenHash,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        revokedAt: null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        userAgent: `integration-test-${index}`
      });
    }

    const suspended = await repository.changeAccountStatus({
      actorUserId: actor.id,
      targetUserId: target.id,
      status: "suspended",
      reason: "Repeated abuse reports"
    });
    expect(suspended.status).toBe("suspended");
    for (const tokenHash of tokenHashes) {
      await expect(repository.findUserBySessionTokenHash(
        tokenHash,
        new Date().toISOString()
      )).resolves.toBeNull();
    }
    await expect(repository.createSession({
      id: randomUUID(),
      userId: target.id,
      tokenHash: hashSessionToken(`late-${targetSuffix}`),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent: "late-session-test"
    })).rejects.toEqual(expect.objectContaining<Partial<AuthRepositoryError>>({
      code: "SESSION_CREATION_DENIED"
    }));

    const revokedRows = await inspection<{ revoked: boolean }[]>`
      SELECT bool_and(revoked_at IS NOT NULL) AS revoked
      FROM sessions
      WHERE user_id = ${target.id}
    `;
    expect(revokedRows[0]?.revoked).toBe(true);
    const suspensionEvents = await inspection<{
      eventType: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string;
    }[]>`
      SELECT
        event_type AS "eventType",
        previous_status AS "previousStatus",
        new_status AS "newStatus",
        reason
      FROM account_admin_events
      WHERE actor_user_id = ${actor.id} AND target_user_id = ${target.id}
      ORDER BY created_at
    `;
    expect(suspensionEvents).toEqual([{
      eventType: "account.suspended",
      previousStatus: "active",
      newStatus: "suspended",
      reason: "Repeated abuse reports"
    }]);

    await repository.changeAccountStatus({
      actorUserId: actor.id,
      targetUserId: target.id,
      status: "active",
      reason: "Manual review completed"
    });
    for (const tokenHash of tokenHashes) {
      await expect(repository.findUserBySessionTokenHash(
        tokenHash,
        new Date().toISOString()
      )).resolves.toBeNull();
    }

    const freshTokenHash = hashSessionToken(`fresh-${targetSuffix}`);
    await repository.createSession({
      id: randomUUID(),
      userId: target.id,
      tokenHash: freshTokenHash,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent: "fresh-session-test"
    });
    await repository.revokeUserSessionsByAdmin({
      actorUserId: actor.id,
      targetUserId: target.id,
      reason: "Credential reset requested"
    });
    await expect(repository.findUserBySessionTokenHash(
      freshTokenHash,
      new Date().toISOString()
    )).resolves.toBeNull();

    const racingTokenHash = hashSessionToken(`racing-${targetSuffix}`);
    let racingSession!: Promise<void>;
    let racingSuspension!: ReturnType<
      PostgresAuthRepository["changeAccountStatus"]
    >;
    await inspection.begin(async (transaction) => {
      await transaction`
        SELECT id FROM users WHERE id = ${target.id} FOR UPDATE
      `;
      racingSession = repository.createSession({
        id: randomUUID(),
        userId: target.id,
        tokenHash: racingTokenHash,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        revokedAt: null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        userAgent: "suspension-race-test"
      });
      racingSuspension = repository.changeAccountStatus({
        actorUserId: actor.id,
        targetUserId: target.id,
        status: "suspended",
        reason: "Concurrent suspension test"
      });
      await new Promise((resolve) => setImmediate(resolve));
    });
    const [sessionResult, suspensionResult] = await Promise.allSettled([
      racingSession,
      racingSuspension
    ]);
    expect(suspensionResult.status).toBe("fulfilled");
    if (sessionResult.status === "rejected") {
      expect(sessionResult.reason).toEqual(
        expect.objectContaining({ code: "SESSION_CREATION_DENIED" })
      );
    }
    await expect(repository.findUserBySessionTokenHash(
      racingTokenHash,
      new Date().toISOString()
    )).resolves.toBeNull();

    await expect(repository.changeAccountStatus({
      actorUserId: target.id,
      targetUserId: actor.id,
      status: "suspended",
      reason: "Unauthorized action"
    })).rejects.toEqual(expect.objectContaining<Partial<AuthRepositoryError>>({
      code: "ADMIN_ACTION_FORBIDDEN"
    }));
    await expect(inspection`
      UPDATE account_admin_events
      SET reason = 'tampered'
      WHERE actor_user_id = ${actor.id}
    `).rejects.toThrow("immutable");
  });
});

function phoneFromUuid(value: string, prefix: string) {
  const digits = [...value.replaceAll("-", "").slice(0, 7)]
    .map((digit) => Number.parseInt(digit, 16) % 10)
    .join("");
  return `+41${prefix}${digits}`;
}
