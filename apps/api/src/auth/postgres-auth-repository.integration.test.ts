import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrate";
import { hashSessionToken } from "./auth-service";
import { PostgresAuthRepository } from "./postgres-auth-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresAuthRepository", () => {
  let repository: PostgresAuthRepository;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    repository = new PostgresAuthRepository(databaseUrl!);
  });

  afterAll(async () => {
    await repository?.close();
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
});
