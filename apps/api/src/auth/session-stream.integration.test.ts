import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { runMigrations } from "../db/migrate";
import { requireTestDatabaseUrl } from "../db/require-test-database";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { AuthService, hashSessionToken } from "./auth-service";
import { PostgresAuthRepository } from "./postgres-auth-repository";
import { MockVerificationProvider } from "./verification-provider";

const databaseUrl = requireTestDatabaseUrl();

describe("durable SSE authorization across API instances", () => {
  const writer = new PostgresAuthRepository(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  beforeAll(() => runMigrations(databaseUrl));
  afterAll(async () => { await writer.close(); await sql.end(); });

  it.each(["logout", "revoke-all", "password-reset", "suspension", "expiry", "idle-revocation"])(
    "closes an existing HTTP stream after %s on another connection",
    async (action) => {
      let now = new Date();
      const user = await writer.createUser({
        email: `${randomUUID()}@example.test`, passwordHash: "test-only",
        phoneE164: `+417${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
        firstName: "Session", lastName: "Fixture", uiLocale: "en"
      });
      await writer.markPhoneVerified(user.id, now.toISOString());
      const token = randomUUID();
      await writer.createSession({
        id: randomUUID(), userId: user.id, tokenHash: hashSessionToken(token),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(), revokedAt: null,
        createdAt: now.toISOString(), lastSeenAt: now.toISOString(), userAgent: "test"
      });
      const service = new CallService(new InMemoryCallRepository());
      const auth = new AuthService({
        repository: new PostgresAuthRepository(databaseUrl),
        verificationProvider: new MockVerificationProvider("000000"),
        signupCreditGranter: { grantSignupCredits: async () => undefined },
        now: () => now
      });
      const brief = await service.create({
        recipientName: "Office", phoneNumber: "+41710000001", objective: "Ask opening hours",
        assistantProfileId: "sebastian", representedPersonFirstName: "Session",
        representedPersonLastName: "Fixture", assistanceReason: "none",
        locale: "en-GB", allowLanguageSwitch: false, allowedFacts: []
      }, user.id);
      const app = buildApp({ service, authService: auth, secureCookies: false, logger: false });
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const controller = new AbortController();
      const cookie = `callassist_session=${token}`;
      try {
        const response = await fetch(`${origin}/api/call-briefs/${brief.id}/events`, {
          headers: { cookie }, signal: controller.signal
        });
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        let frames = "";
        while (!frames.includes('"type":"call.updated"')) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Missing initial event");
          frames += new TextDecoder().decode(chunk.value);
        }
        if (action === "logout") await writer.revokeSession(hashSessionToken(token), now.toISOString());
        else if (action === "expiry") now = new Date(now.getTime() + 61_000);
        else if (action === "suspension") {
          await sql`UPDATE users SET status = 'suspended' WHERE id = ${user.id}`;
        } else if (action === "password-reset") {
          const recoveryId = randomUUID();
          const grantHash = createHash("sha256").update(randomUUID()).digest("hex");
          const expiresAt = new Date(now.getTime() + 60_000).toISOString();
          await writer.createPasswordRecoveryChallenge({ id: recoveryId, userId: user.id, now: now.toISOString(), expiresAt });
          await writer.createPasswordRecoveryGrant({ id: randomUUID(), recoveryId, userId: user.id, tokenHash: grantHash, now: now.toISOString(), expiresAt });
          expect(await writer.resetPasswordWithRecoveryGrant({ tokenHash: grantHash, passwordHash: "changed", now: now.toISOString() })).toBe(true);
        } else await writer.revokeUserSessions(user.id, now.toISOString());
        expect((await app.inject({ method: "GET", url: `/api/call-briefs/${brief.id}`, headers: { cookie } })).statusCode).toBe(401);
        if (action !== "idle-revocation") {
          service.publishTranscriptDelta(brief.id, "secret:1", "recipient", "AFTER_REVOCATION", "en-GB");
        }
        let received = "";
        let closed = false;
        const timeout = setTimeout(() => controller.abort(), 7_500);
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) { closed = true; break; }
            received += new TextDecoder().decode(chunk.value);
          }
        } catch {
          closed = !controller.signal.aborted;
        } finally { clearTimeout(timeout); }
        expect(closed).toBe(true);
        expect(received).not.toContain("AFTER_REVOCATION");
      } finally {
        controller.abort();
        await app.close();
      }
    }, 12_000
  );
});
