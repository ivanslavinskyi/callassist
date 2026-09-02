import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runMigrations } from "../db/migrate";
import {
  AuthRepositoryError,
  decodeAdminUserCursor
} from "./auth-repository";
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
    await expect(repository.updateOwnName({
      userId: user.id,
      firstName: "Nina-Maria",
      lastName: "Keller"
    })).resolves.toMatchObject({
      firstName: "Nina-Maria",
      lastName: "Keller"
    });

    const verified = await repository.markPhoneVerified(
      user.id,
      new Date().toISOString()
    );
    expect(verified.phoneVerifiedAt).not.toBeNull();

    const exportId = randomUUID();
    await repository.recordAccountDataExport({
      exportId,
      userId: user.id,
      schemaVersion: "1",
      callCount: 2,
      byteCount: 4096,
      createdAt: new Date().toISOString()
    });
    const exportEvents = await inspection<{
      id: string;
      schemaVersion: string;
      callCount: number;
      byteCount: number;
    }[]>`
      SELECT
        id::text,
        schema_version AS "schemaVersion",
        call_count AS "callCount",
        byte_count AS "byteCount"
      FROM account_data_export_events
      WHERE user_id = ${user.id}
    `;
    expect(exportEvents).toEqual([{
      id: exportId,
      schemaVersion: "1",
      callCount: 2,
      byteCount: 4096
    }]);
    await expect(inspection`
      DELETE FROM account_data_export_events WHERE id = ${exportId}
    `).rejects.toThrow("immutable");

    const tokenHash = hashSessionToken(`test-${suffix}`);
    const now = new Date();
    const sessionId = randomUUID();
    await repository.createSession({
      id: sessionId,
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

    const secondSessionId = randomUUID();
    await repository.createSession({
      id: secondSessionId,
      userId: user.id,
      tokenHash: hashSessionToken(`second-${suffix}`),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: now.toISOString(),
      lastSeenAt: new Date(now.getTime() + 1).toISOString(),
      userAgent: "Mozilla/5.0 Firefox/141.0"
    });
    await expect(repository.listActiveSessions(
      user.id,
      now.toISOString(),
      50,
      sessionId
    )).resolves.toMatchObject({
      totalActive: 2,
      sessions: [
        { id: sessionId },
        { id: secondSessionId, userAgent: "Mozilla/5.0 Firefox/141.0" }
      ]
    });
    await expect(repository.revokeSessionById(
      user.id,
      secondSessionId,
      new Date().toISOString()
    )).resolves.toBe(true);
    await expect(repository.revokeSessionById(
      user.id,
      secondSessionId,
      new Date().toISOString()
    )).resolves.toBe(false);
    const sessionEvents = await inspection<{
      eventType: string;
      targetSessionId: string | null;
      revokedSessionCount: number;
    }[]>`
      SELECT
        event_type AS "eventType",
        target_session_id::text AS "targetSessionId",
        revoked_session_count AS "revokedSessionCount"
      FROM account_session_events
      WHERE actor_user_id = ${user.id}
    `;
    expect(sessionEvents).toEqual([{
      eventType: "session.revoked",
      targetSessionId: secondSessionId,
      revokedSessionCount: 1
    }]);
    await expect(inspection`
      DELETE FROM account_session_events WHERE actor_user_id = ${user.id}
    `).rejects.toThrow("immutable");

    await repository.revokeUserSessions(user.id, new Date().toISOString());
    const allRevokedEvents = await inspection<{
      revokedSessionCount: number;
    }[]>`
      SELECT revoked_session_count AS "revokedSessionCount"
      FROM account_session_events
      WHERE actor_user_id = ${user.id}
        AND event_type = 'session.all_revoked'
    `;
    expect(allRevokedEvents).toEqual([{ revokedSessionCount: 1 }]);

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

  it("caps recovery attempts and atomically consumes a grant with immutable evidence", async () => {
    const suffix = randomUUID();
    const user = await repository.createUser({
      email: `recover.${suffix}@example.com`,
      passwordHash: "old-password-hash",
      phoneE164: phoneFromUuid(suffix, "69"),
      firstName: "Recovery",
      lastName: "Test",
      uiLocale: "en"
    });
    const now = new Date();
    await repository.markPhoneVerified(user.id, now.toISOString());
    const sessionTokenHash = hashSessionToken(`recovery-session-${suffix}`);
    await repository.createSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: sessionTokenHash,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent: "recovery-integration-test"
    });

    const exhaustedChallengeId = randomUUID();
    await expect(repository.createPasswordRecoveryChallenge({
      id: exhaustedChallengeId,
      userId: user.id,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString()
    })).resolves.toBe(true);
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await expect(repository.consumePasswordRecoveryChallengeAttempt(
        exhaustedChallengeId,
        now.toISOString()
      )).resolves.toMatchObject({ attemptCount: attempt });
    }
    await expect(repository.consumePasswordRecoveryChallengeAttempt(
      exhaustedChallengeId,
      now.toISOString()
    )).resolves.toBeNull();

    const recoveryId = randomUUID();
    await expect(repository.createPasswordRecoveryChallenge({
      id: recoveryId,
      userId: user.id,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString()
    })).resolves.toBe(true);
    await expect(repository.consumePasswordRecoveryChallengeAttempt(
      recoveryId,
      now.toISOString()
    )).resolves.toMatchObject({ id: recoveryId, user: { id: user.id } });
    const tokenHash = suffix.replaceAll("-", "").repeat(2);
    await expect(repository.createPasswordRecoveryGrant({
      id: randomUUID(),
      recoveryId,
      userId: user.id,
      tokenHash,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString()
    })).resolves.toBe(true);
    await expect(repository.createPasswordRecoveryGrant({
      id: randomUUID(),
      recoveryId,
      userId: user.id,
      tokenHash: "f".repeat(64),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString()
    })).resolves.toBe(false);

    const completedAt = new Date(now.getTime() + 1_000).toISOString();
    await expect(repository.resetPasswordWithRecoveryGrant({
      tokenHash,
      passwordHash: "new-password-hash",
      now: completedAt
    })).resolves.toBe(true);
    await expect(repository.resetPasswordWithRecoveryGrant({
      tokenHash,
      passwordHash: "replayed-password-hash",
      now: completedAt
    })).resolves.toBe(false);
    await expect(repository.findUserBySessionTokenHash(
      sessionTokenHash,
      completedAt
    )).resolves.toBeNull();
    await expect(repository.findUserByEmail(user.email)).resolves.toMatchObject({
      passwordHash: "new-password-hash",
      lastLoginAt: null
    });
    await expect(repository.createSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionToken(`stale-login-${suffix}`),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: completedAt,
      lastSeenAt: completedAt,
      userAgent: "stale-login-integration-test",
      expectedPasswordHash: "old-password-hash"
    })).rejects.toEqual(expect.objectContaining<Partial<AuthRepositoryError>>({
      code: "SESSION_CREATION_DENIED"
    }));
    const events = await inspection<{
      challengeId: string;
      revokedSessionCount: number;
    }[]>`
      SELECT
        challenge_id::text AS "challengeId",
        revoked_session_count AS "revokedSessionCount"
      FROM password_recovery_events
      WHERE user_id = ${user.id}
    `;
    expect(events).toEqual([{
      challengeId: recoveryId,
      revokedSessionCount: 1
    }]);
    await expect(inspection`
      UPDATE password_recovery_events SET revoked_session_count = 99
      WHERE user_id = ${user.id}
    `).rejects.toThrow("immutable");
  });

  it("atomically changes a verified phone and invalidates old access capabilities", async () => {
    const suffix = randomUUID();
    const user = await repository.createUser({
      email: `phone-change.${suffix}@example.com`,
      passwordHash: "phone-change-password-hash",
      phoneE164: phoneFromUuid(suffix, "58"),
      firstName: "Phone",
      lastName: "Change",
      uiLocale: "en"
    });
    const now = new Date();
    await repository.markPhoneVerified(user.id, now.toISOString());
    const currentSessionId = randomUUID();
    const currentTokenHash = hashSessionToken(`phone-current-${suffix}`);
    const otherTokenHash = hashSessionToken(`phone-other-${suffix}`);
    for (const [id, tokenHash] of [
      [currentSessionId, currentTokenHash],
      [randomUUID(), otherTokenHash]
    ]) {
      await repository.createSession({
        id,
        userId: user.id,
        tokenHash,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        revokedAt: null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        userAgent: "phone-change-integration-test"
      });
    }

    const recoveryId = randomUUID();
    await repository.createPasswordRecoveryChallenge({
      id: recoveryId,
      userId: user.id,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString()
    });
    await repository.consumePasswordRecoveryChallengeAttempt(
      recoveryId,
      now.toISOString()
    );
    const recoveryTokenHash = suffix.replaceAll("-", "").repeat(2);
    await repository.createPasswordRecoveryGrant({
      id: randomUUID(),
      recoveryId,
      userId: user.id,
      tokenHash: recoveryTokenHash,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString()
    });

    const phoneChangeId = randomUUID();
    const newPhoneE164 = phoneFromUuid(randomUUID(), "59");
    await expect(repository.createPhoneChangeChallenge({
      id: phoneChangeId,
      userId: user.id,
      initiatingSessionId: currentSessionId,
      expectedPasswordHash: "phone-change-password-hash",
      newPhoneE164,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString()
    })).resolves.toBe(true);
    await expect(repository.consumePhoneChangeChallengeAttempt({
      phoneChangeId,
      userId: user.id,
      sessionId: randomUUID(),
      now: now.toISOString()
    })).resolves.toBeNull();
    await expect(repository.consumePhoneChangeChallengeAttempt({
      phoneChangeId,
      userId: user.id,
      sessionId: currentSessionId,
      now: now.toISOString()
    })).resolves.toMatchObject({
      id: phoneChangeId,
      newPhoneE164,
      attemptCount: 1
    });

    const completedAt = new Date(now.getTime() + 1_000).toISOString();
    await expect(repository.completePhoneChange({
      phoneChangeId,
      userId: user.id,
      sessionId: currentSessionId,
      now: completedAt
    })).resolves.toMatchObject({
      user: { phoneE164: newPhoneE164, phoneVerifiedAt: completedAt },
      revokedSessionCount: 1,
      invalidatedRecoveryChallengeCount: 1,
      invalidatedRecoveryGrantCount: 1
    });
    await expect(repository.completePhoneChange({
      phoneChangeId,
      userId: user.id,
      sessionId: currentSessionId,
      now: completedAt
    })).resolves.toBeNull();
    await expect(repository.findUserBySessionTokenHash(
      currentTokenHash,
      completedAt
    )).resolves.toMatchObject({ user: { phoneE164: newPhoneE164 } });
    await expect(repository.findUserBySessionTokenHash(
      otherTokenHash,
      completedAt
    )).resolves.toBeNull();
    await expect(repository.resetPasswordWithRecoveryGrant({
      tokenHash: recoveryTokenHash,
      passwordHash: "must-not-apply",
      now: completedAt
    })).resolves.toBe(false);

    const exhaustedPhoneChangeId = randomUUID();
    await expect(repository.createPhoneChangeChallenge({
      id: exhaustedPhoneChangeId,
      userId: user.id,
      initiatingSessionId: currentSessionId,
      expectedPasswordHash: "phone-change-password-hash",
      newPhoneE164: phoneFromUuid(randomUUID(), "54"),
      now: completedAt,
      expiresAt: new Date(
        new Date(completedAt).getTime() + 10 * 60_000
      ).toISOString()
    })).resolves.toBe(true);
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await expect(repository.consumePhoneChangeChallengeAttempt({
        phoneChangeId: exhaustedPhoneChangeId,
        userId: user.id,
        sessionId: currentSessionId,
        now: completedAt
      })).resolves.toMatchObject({ attemptCount: attempt });
    }
    await expect(repository.consumePhoneChangeChallengeAttempt({
      phoneChangeId: exhaustedPhoneChangeId,
      userId: user.id,
      sessionId: currentSessionId,
      now: completedAt
    })).resolves.toBeNull();

    const events = await inspection<{
      challengeId: string;
      revokedSessionCount: number;
      invalidatedRecoveryChallengeCount: number;
      invalidatedRecoveryGrantCount: number;
    }[]>`
      SELECT
        challenge_id::text AS "challengeId",
        revoked_session_count AS "revokedSessionCount",
        invalidated_recovery_challenge_count AS "invalidatedRecoveryChallengeCount",
        invalidated_recovery_grant_count AS "invalidatedRecoveryGrantCount"
      FROM phone_change_events
      WHERE user_id = ${user.id}
    `;
    expect(events).toEqual([{
      challengeId: phoneChangeId,
      revokedSessionCount: 1,
      invalidatedRecoveryChallengeCount: 1,
      invalidatedRecoveryGrantCount: 1
    }]);
    await inspection`
      UPDATE phone_change_challenges
      SET created_at = ${new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000)}
      WHERE id = ${phoneChangeId}
    `;
    await repository.createPhoneChangeChallenge({
      id: randomUUID(),
      userId: user.id,
      initiatingSessionId: currentSessionId,
      expectedPasswordHash: "phone-change-password-hash",
      newPhoneE164: phoneFromUuid(randomUUID(), "53"),
      now: completedAt,
      expiresAt: new Date(
        new Date(completedAt).getTime() + 10 * 60_000
      ).toISOString()
    });
    const [retention] = await inspection<{
      challengeExists: boolean;
      eventExists: boolean;
    }[]>`
      SELECT
        EXISTS(
          SELECT 1 FROM phone_change_challenges WHERE id = ${phoneChangeId}
        ) AS "challengeExists",
        EXISTS(
          SELECT 1 FROM phone_change_events WHERE challenge_id = ${phoneChangeId}
        ) AS "eventExists"
    `;
    expect(retention).toEqual({ challengeExists: false, eventExists: true });
    await expect(inspection`
      DELETE FROM phone_change_events WHERE challenge_id = ${phoneChangeId}
    `).rejects.toThrow("immutable");
  });

  it("atomically changes a verified email and retains minimized evidence", async () => {
    const suffix = randomUUID();
    const originalEmail = `email-change.${suffix}@example.com`;
    const newEmail = `email-changed.${suffix}@example.com`;
    const passwordHash = "email-change-password-hash";
    const user = await repository.createUser({
      email: originalEmail,
      passwordHash,
      phoneE164: phoneFromUuid(suffix, "52"),
      firstName: "Email",
      lastName: "Change",
      uiLocale: "en"
    });
    const now = new Date();
    await repository.markPhoneVerified(user.id, now.toISOString());
    const currentSessionId = randomUUID();
    const currentTokenHash = hashSessionToken(`email-current-${suffix}`);
    const otherTokenHash = hashSessionToken(`email-other-${suffix}`);
    for (const [id, tokenHash] of [
      [currentSessionId, currentTokenHash],
      [randomUUID(), otherTokenHash]
    ]) {
      await repository.createSession({
        id,
        userId: user.id,
        tokenHash,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        revokedAt: null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        userAgent: "email-change-integration-test"
      });
    }

    const emailChangeId = randomUUID();
    await expect(repository.createEmailChangeChallenge({
      id: emailChangeId,
      userId: user.id,
      initiatingSessionId: currentSessionId,
      expectedPasswordHash: passwordHash,
      newEmail,
      codeHash: "a".repeat(64),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString()
    })).resolves.toBe(true);
    await expect(repository.consumeEmailChangeChallengeAttempt({
      emailChangeId,
      userId: user.id,
      sessionId: currentSessionId,
      now: now.toISOString()
    })).resolves.toMatchObject({
      id: emailChangeId,
      newEmail,
      codeHash: "a".repeat(64),
      attemptCount: 1
    });

    const completedAt = new Date(now.getTime() + 1_000).toISOString();
    await expect(repository.completeEmailChange({
      emailChangeId,
      userId: user.id,
      sessionId: currentSessionId,
      now: completedAt
    })).resolves.toMatchObject({
      user: { email: newEmail },
      previousEmail: originalEmail,
      revokedSessionCount: 1
    });
    await expect(repository.findUserByEmail(originalEmail)).resolves.toBeNull();
    await expect(repository.findUserBySessionTokenHash(
      currentTokenHash,
      completedAt
    )).resolves.toMatchObject({ user: { email: newEmail } });
    await expect(repository.findUserBySessionTokenHash(
      otherTokenHash,
      completedAt
    )).resolves.toBeNull();

    const events = await inspection<{
      challengeId: string;
      revokedSessionCount: number;
    }[]>`
      SELECT
        challenge_id::text AS "challengeId",
        revoked_session_count AS "revokedSessionCount"
      FROM email_change_events
      WHERE user_id = ${user.id}
    `;
    expect(events).toEqual([{
      challengeId: emailChangeId,
      revokedSessionCount: 1
    }]);
    await expect(inspection`
      DELETE FROM email_change_events WHERE challenge_id = ${emailChangeId}
    `).rejects.toThrow("immutable");
  });

  it("lets only one concurrent account claim the same verified phone", async () => {
    const now = new Date();
    const targetPhone = phoneFromUuid(randomUUID(), "57");
    const contenders = await Promise.all(["first", "second"].map(async (label) => {
      const suffix = randomUUID();
      const user = await repository.createUser({
        email: `phone-race-${label}.${suffix}@example.com`,
        passwordHash: "phone-race-password-hash",
        phoneE164: phoneFromUuid(suffix, label === "first" ? "55" : "56"),
        firstName: "Phone",
        lastName: label,
        uiLocale: "en"
      });
      await repository.markPhoneVerified(user.id, now.toISOString());
      const sessionId = randomUUID();
      await repository.createSession({
        id: sessionId,
        userId: user.id,
        tokenHash: hashSessionToken(`phone-race-${suffix}`),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        revokedAt: null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        userAgent: "phone-race-integration-test"
      });
      const phoneChangeId = randomUUID();
      await repository.createPhoneChangeChallenge({
        id: phoneChangeId,
        userId: user.id,
        initiatingSessionId: sessionId,
        expectedPasswordHash: "phone-race-password-hash",
        newPhoneE164: targetPhone,
        now: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString()
      });
      await repository.consumePhoneChangeChallengeAttempt({
        phoneChangeId,
        userId: user.id,
        sessionId,
        now: now.toISOString()
      });
      return { user, sessionId, phoneChangeId };
    }));

    const results = await Promise.all(contenders.map((contender) =>
      repository.completePhoneChange({
        phoneChangeId: contender.phoneChangeId,
        userId: contender.user.id,
        sessionId: contender.sessionId,
        now: new Date(now.getTime() + 1_000).toISOString()
      })
    ));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [row] = await inspection<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM users
      WHERE phone_e164 = ${targetPhone}
    `;
    expect(row?.count).toBe(1);
  });

  it("paginates admin user search and hides privileged targets from ordinary admins", async () => {
    const actorSuffix = randomUUID();
    const firstSuffix = randomUUID();
    const secondSuffix = randomUUID();
    const staffSuffix = randomUUID();
    const actor = await repository.createUser({
      email: `lookup-admin.${actorSuffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(actorSuffix, "61"),
      firstName: "Lookup",
      lastName: "Admin",
      uiLocale: "en"
    });
    const first = await repository.createUser({
      email: `lookup-first.${firstSuffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(firstSuffix, "62"),
      firstName: "Searchable",
      lastName: "Customer",
      uiLocale: "en"
    });
    const second = await repository.createUser({
      email: `lookup-second.${secondSuffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(secondSuffix, "63"),
      firstName: "Searchable",
      lastName: "Customer",
      uiLocale: "de"
    });
    const staff = await repository.createUser({
      email: `lookup-support.${staffSuffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(staffSuffix, "64"),
      firstName: "Hidden",
      lastName: "Support",
      uiLocale: "en"
    });
    await Promise.all([actor, first, second, staff].map((user) =>
      repository.markPhoneVerified(user.id, new Date().toISOString())
    ));
    await inspection`UPDATE users SET role = 'admin' WHERE id = ${actor.id}`;
    await inspection`UPDATE users SET role = 'support' WHERE id = ${staff.id}`;

    const pageOne = await repository.listUsersForAdmin({
      actorUserId: actor.id,
      limit: 1,
      search: "Searchable Customer",
      role: "user",
      status: "active"
    });
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.nextCursor).toBeTypeOf("string");
    expect(pageOne.items[0]).not.toHaveProperty("phoneE164");
    expect(pageOne.items[0]).not.toHaveProperty("passwordHash");
    const pageTwo = await repository.listUsersForAdmin({
      actorUserId: actor.id,
      limit: 1,
      search: "Searchable Customer",
      cursor: decodeAdminUserCursor(pageOne.nextCursor!)!
    });
    expect(pageTwo.items).toHaveLength(1);
    expect(pageTwo.items[0]?.id).not.toBe(pageOne.items[0]?.id);
    expect([first.id, second.id]).toContain(pageTwo.items[0]?.id);
    await expect(
      repository.findUserByIdForAdmin(actor.id, staff.id)
    ).rejects.toEqual(expect.objectContaining<Partial<AuthRepositoryError>>({
      code: "USER_NOT_FOUND"
    }));

    await inspection`UPDATE users SET role = 'superadmin' WHERE id = ${actor.id}`;
    await expect(
      repository.findUserByIdForAdmin(actor.id, staff.id)
    ).resolves.toMatchObject({ id: staff.id, role: "support" });
  });

  it("leases and atomically finalizes account anonymization with immutable evidence", async () => {
    const suffix = randomUUID();
    const originalEmail = `delete-me.${suffix}@example.com`;
    const user = await repository.createUser({
      email: originalEmail,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(suffix, "65"),
      firstName: "Private",
      lastName: "Person",
      uiLocale: "de"
    });
    await repository.markPhoneVerified(user.id, new Date().toISOString());
    const tokenHash = hashSessionToken(`delete-session-${suffix}`);
    const requestedAt = new Date();
    await repository.createSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: new Date(requestedAt.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: requestedAt.toISOString(),
      lastSeenAt: requestedAt.toISOString(),
      userAgent: "account-deletion-integration-test"
    });
    const requestId = randomUUID();
    await expect(repository.requestAccountDeletion({
      requestId,
      userId: user.id,
      now: requestedAt.toISOString(),
      maxAttempts: 5
    })).resolves.toMatchObject({ status: "queued", generation: 1 });
    const claimed = await repository.claimAccountDeletion({
      workerId: "integration-worker",
      now: requestedAt.toISOString(),
      leaseExpiresAt: new Date(requestedAt.getTime() + 60_000).toISOString()
    });
    expect(claimed).toMatchObject({
      requestId,
      status: "processing",
      attemptCount: 1
    });
    const completedAt = new Date(requestedAt.getTime() + 1_000).toISOString();
    await expect(repository.completeAccountDeletion({
      requestId,
      workerId: "integration-worker",
      now: completedAt
    })).resolves.toBe(true);

    expect(await repository.findUserByEmail(originalEmail)).toBeNull();
    expect(await repository.findAccountDeletionByUser(user.id)).toMatchObject({
      status: "completed",
      completedAt
    });
    await expect(repository.findUserBySessionTokenHash(
      tokenHash,
      completedAt
    )).resolves.toBeNull();
    const [tombstone] = await inspection<{
      email: string;
      phone: string;
      firstName: string;
      lastName: string;
      status: string;
      verified: boolean;
    }[]>`
      SELECT
        email,
        phone_e164 AS phone,
        first_name AS "firstName",
        last_name AS "lastName",
        status,
        phone_verified_at IS NOT NULL AS verified
      FROM users
      WHERE id = ${user.id}
    `;
    expect(tombstone).toEqual({
      email: `deleted+${user.id}@invalid.callassist.local`,
      phone: `deleted:${user.id}`,
      firstName: "Deleted",
      lastName: "Account",
      status: "deleted",
      verified: false
    });
    const attempts = await inspection<{ outcome: string }[]>`
      SELECT outcome FROM account_deletion_attempts WHERE request_id = ${requestId}
    `;
    expect(attempts).toEqual([{ outcome: "succeeded" }]);
    await expect(inspection`
      UPDATE account_deletion_attempts SET error_code = 'tampered'
      WHERE request_id = ${requestId}
    `).rejects.toThrow("immutable");
    await expect(inspection`
      DELETE FROM account_deletion_events WHERE request_id = ${requestId}
    `).rejects.toThrow("immutable");
  });
});

function phoneFromUuid(value: string, prefix: string) {
  const digits = [...value.replaceAll("-", "").slice(0, 7)]
    .map((digit) => Number.parseInt(digit, 16) % 10)
    .join("");
  return `+41${prefix}${digits}`;
}
