import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  accountDataExportSchema,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { CreditService } from "../credits/credit-service";
import { ContentService } from "../content/content-service";
import { InMemoryContentRepository } from "../content/in-memory-content-repository";
import { seededContentPages } from "../content/seed-content";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { AuthService } from "./auth-service";
import { AccountDeletionService } from "./account-deletion-service";
import { InMemoryAuthRepository } from "./in-memory-auth-repository";
import {
  RateLimiterUnavailableError,
  type RateLimiter
} from "./rate-limiter";
import {
  MockVerificationProvider,
  type VerificationProvider
} from "./verification-provider";
import { MockEmailProvider, type EmailProvider } from "./email-provider";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createAuthApp(
  contentService?: ContentService,
  options: {
    production?: boolean;
    secureCookies?: boolean;
    verificationProvider?: VerificationProvider;
    emailProvider?: EmailProvider;
    rateLimiter?: RateLimiter;
    endpointRateLimiter?: RateLimiter;
  } = {}
) {
  const repository = new InMemoryAuthRepository();
  const callRepository = new InMemoryCallRepository();
  const callService = new CallService(callRepository);
  const authService = new AuthService({
    repository,
    verificationProvider: options.verificationProvider ??
      new MockVerificationProvider("123456"),
    emailProvider: options.emailProvider ?? new MockEmailProvider(),
    emailVerificationHashKey: Buffer.alloc(32, 12),
    emailVerificationCode: () => "654321",
    signupCreditGranter: callService,
    rateLimiter: options.rateLimiter
  });
  const accountDeletionService = new AccountDeletionService({
    authRepository: repository,
    callService
  });
  const creditService = new CreditService({
    repository: callRepository,
    authRepository: repository,
    hashKey: Buffer.alloc(32, 7)
  });
  const app = buildApp({
    service: callService,
    authService,
    creditService,
    contentService,
    accountDeletionService,
    logger: false,
    production: options.production,
    secureCookies: options.secureCookies ?? false,
    endpointRateLimiter: options.endpointRateLimiter ?? options.rateLimiter
  });
  apps.push(app);
  return {
    app,
    repository,
    callRepository,
    callService,
    accountDeletionService
  };
}

function unavailableRateLimiter(): RateLimiter {
  const unavailable = async () => {
    throw new RateLimiterUnavailableError();
  };
  return {
    mode: "postgres",
    shared: true,
    consume: unavailable,
    consumeMany: unavailable,
    getStatus: unavailable,
    async close() {}
  };
}

const registration = {
  email: "nina.keller@example.com",
  password: "a-long-test-password",
  phoneE164: "+41710000000",
  firstName: "Nina",
  lastName: "Keller",
  uiLocale: "de"
};

async function registerAndVerify(
  app: ReturnType<typeof buildApp>,
  input: typeof registration
) {
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: input
  });
  expect(registered.statusCode).toBe(202);
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/verify-phone",
    payload: { email: input.email, code: "123456" }
  });
  expect(verified.statusCode).toBe(200);
  return String(verified.headers["set-cookie"]);
}

async function acceptCurrentOnboarding(
  app: ReturnType<typeof buildApp>,
  cookie: string,
  locale: "en" | "de"
) {
  const status = await app.inject({
    method: "GET",
    url: `/api/onboarding/status?locale=${locale}`,
    headers: { cookie }
  });
  const current = status.json().current;
  const accepted = await app.inject({
    method: "POST",
    url: "/api/onboarding/accept",
    headers: { cookie },
    payload: {
      locale,
      termsRevisionId: current.terms.id,
      acceptableUseRevisionId: current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    }
  });
  expect(accepted.statusCode).toBe(200);
}

async function createPreparedCall(
  app: ReturnType<typeof buildApp>,
  cookie: string,
  payload: CreateCallBriefInput = callBrief
) {
  const accepted = await app.inject({
    method: "POST",
    url: "/api/call-preparations",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload
  });
  expect(accepted.statusCode).toBe(202);
  const preparationId = accepted.json<{ id: string }>().id;
  let preparation = accepted.json<{
    status: string;
    callBriefId: string | null;
  }>();
  for (let index = 0; index < 30 && preparation.status !== "succeeded"; index++) {
    await new Promise((resolve) => setImmediate(resolve));
    const status = await app.inject({
      method: "GET",
      url: `/api/call-preparations/${preparationId}`,
      headers: { cookie }
    });
    expect(status.statusCode).toBe(200);
    preparation = status.json();
  }
  expect(preparation.status).toBe("succeeded");
  const snapshot = await app.inject({
    method: "GET",
    url: `/api/call-briefs/${preparation.callBriefId}`,
    headers: { cookie }
  });
  expect(snapshot.statusCode).toBe(200);
  const brief = snapshot.json().brief;
  return {
    statusCode: 201,
    json<T = typeof brief>() {
      return brief as T;
    }
  };
}

const callBrief = {
  recipientName: "Beta Clinic",
  phoneNumber: "+41710000002",
  objective: "Ask for the clinic's opening hours next Monday",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Nina",
  representedPersonLastName: "Keller",
  assistanceReason: "speech_impairment",
  locale: "de-CH",
  allowLanguageSwitch: false,
  allowedFacts: []
} satisfies CreateCallBriefInput;

describe("auth API", () => {
  it("fails closed before registration when the shared limiter is unavailable", async () => {
    const { app, repository } = createAuthApp(undefined, {
      rateLimiter: unavailableRateLimiter()
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: registration
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json()).toEqual({ error: "RATE_LIMIT_UNAVAILABLE" });
    expect(await repository.findUserByEmail(registration.email)).toBeNull();
  });

  it("keeps admin system status available when limiter telemetry is unavailable", async () => {
    const { app, repository } = createAuthApp(undefined, {
      endpointRateLimiter: unavailableRateLimiter()
    });
    const adminRegistration = {
      ...registration,
      email: "limiter-admin@example.com",
      phoneE164: "+41710000041"
    };
    const cookie = await registerAndVerify(app, adminRegistration);
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    await repository.setUserRoleForTest(me.json().user.id, "admin");

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/system",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().rateLimits).toEqual({
      state: "unavailable",
      mode: "postgres",
      shared: true,
      activeBuckets: null,
      metricsSince: null,
      allowed: null,
      denied: null,
      topDeniedScopes: []
    });
  });

  it("step-up deletes only an owned terminal call and remains idempotent", async () => {
    const { app, callRepository } = createAuthApp();
    const ownerCookie = await registerAndVerify(app, registration);
    const created = await createPreparedCall(app, ownerCookie);
    expect(created.statusCode).toBe(201);
    const callId = created.json().id as string;
    await callRepository.updateStatus(callId, "completed");
    const requestId = randomUUID();

    const malformed = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/data-deletion`,
      headers: { cookie: ownerCookie },
      payload: {
        requestId,
        password: registration.password,
        confirmation: "delete"
      }
    });
    expect(malformed.statusCode).toBe(400);

    const wrongPassword = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/data-deletion`,
      headers: { cookie: ownerCookie },
      payload: {
        requestId,
        password: "wrong-password",
        confirmation: "DELETE"
      }
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect((await callRepository.get(callId))?.brief.recipientName)
      .toBe(callBrief.recipientName);

    const foreignCookie = await registerAndVerify(app, {
      ...registration,
      email: "foreign-delete@example.com",
      phoneE164: "+41710000009",
      firstName: "Alex",
      lastName: "Meier"
    });
    const foreign = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/data-deletion`,
      headers: { cookie: foreignCookie },
      payload: {
        requestId,
        password: registration.password,
        confirmation: "DELETE"
      }
    });
    expect(foreign.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/data-deletion`,
      headers: { cookie: ownerCookie },
      payload: {
        requestId,
        password: registration.password,
        confirmation: "DELETE"
      }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ requestId });
    expect(deleted.headers["cache-control"]).toBe("private, no-store");

    const replay = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/data-deletion`,
      headers: { cookie: ownerCookie },
      payload: {
        requestId,
        password: registration.password,
        confirmation: "DELETE"
      }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(deleted.json());
    expect((await app.inject({
      method: "GET",
      url: `/api/call-briefs/${callId}`,
      headers: { cookie: ownerCookie }
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie: ownerCookie }
    })).json().items).toEqual([]);
  });

  it("downloads a rate-limited versioned export containing only the owner's data", async () => {
    const contentService = new ContentService(new InMemoryContentRepository());
    await contentService.initialize();
    const { app, repository } = createAuthApp(contentService);
    const ownerCookie = await registerAndVerify(app, registration);
    await acceptCurrentOnboarding(app, ownerCookie, "de");
    const ownerCall = await createPreparedCall(app, ownerCookie, {
      ...callBrief,
      recipientName: "Owner Clinic",
      objective: "Ask the owner clinic for private appointment availability",
      allowedFacts: ["Private member number A-149"]
    });
    expect(ownerCall.statusCode).toBe(201);

    const foreignRegistration = {
      ...registration,
      email: "alex.meier@example.com",
      phoneE164: "+41710000009",
      firstName: "Alex",
      lastName: "Meier",
      uiLocale: "en"
    };
    const foreignCookie = await registerAndVerify(app, foreignRegistration);
    await acceptCurrentOnboarding(app, foreignCookie, "en");
    const foreignCall = await createPreparedCall(app, foreignCookie, {
      ...callBrief,
      recipientName: "Foreign Council",
      objective: "Ask the foreign council for private document availability",
      representedPersonFirstName: "Alex",
      representedPersonLastName: "Meier",
      allowedFacts: ["Foreign secret B-882"]
    });
    expect(foreignCall.statusCode).toBe(201);

    const anonymous = await app.inject({
      method: "POST",
      url: "/api/account/data-export"
    });
    expect(anonymous.statusCode).toBe(401);

    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/api/account/data-export",
      headers: { cookie: ownerCookie, origin: "https://attacker.example" }
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const response = await app.inject({
      method: "POST",
      url: "/api/account/data-export",
      headers: { cookie: ownerCookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="shprohli-data-\d{4}-\d{2}-\d{2}\.json"$/
    );
    const exported = accountDataExportSchema.parse(response.json());
    expect(exported).toMatchObject({
      schemaVersion: "1",
      account: {
        email: registration.email,
        firstName: registration.firstName,
        lastName: registration.lastName
      },
      activeSessions: { totalActive: 1 },
      credits: { balance: 3 },
      onboardingAcceptances: [{ acceptedLocale: "de" }]
    });
    expect(exported.calls).toHaveLength(1);
    expect(exported.calls[0].snapshot.brief).toMatchObject({
      recipientName: "Owner Clinic",
      allowedFacts: ["Private member number A-149"]
    });
    expect(exported.calls[0]!.snapshot.compilation).not.toBeNull();
    expect(
      exported.calls[0]!.snapshot.compilation!.compilerResponseId
    ).toBeNull();
    expect(response.body).not.toContain("Foreign Council");
    expect(response.body).not.toContain("Foreign secret B-882");
    expect(response.body).not.toContain("passwordHash");
    expect(response.body).not.toContain("tokenHash");
    expect(repository.accountDataExportEventsForTest()).toEqual([
      expect.objectContaining({
        exportId: exported.exportId,
        userId: exported.account.id,
        schemaVersion: "1",
        callCount: 1,
        byteCount: expect.any(Number)
      })
    ]);

    const second = await app.inject({
      method: "POST",
      url: "/api/account/data-export",
      headers: { cookie: ownerCookie }
    });
    expect(second.statusCode).toBe(200);
    const limited = await app.inject({
      method: "POST",
      url: "/api/account/data-export",
      headers: { cookie: ownerCookie }
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(repository.accountDataExportEventsForTest()).toHaveLength(2);
  });

  it("registers, verifies, creates a server-side session, and logs out", async () => {
    const { app } = createAuthApp();
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: registration
    });
    expect(registered.statusCode).toBe(202);
    expect(registered.json()).toEqual({ status: "verification_required" });

    const beforeVerification = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    expect(beforeVerification.statusCode).toBe(403);
    expect(beforeVerification.json()).toEqual({
      error: "PHONE_VERIFICATION_REQUIRED"
    });

    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "123456" }
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user).toMatchObject({
      email: registration.email,
      firstName: "Nina",
      lastName: "Keller",
      phoneE164: "+41710000000",
      phoneVerifiedAt: expect.any(String)
    });
    expect(verified.json().user).not.toHaveProperty("passwordHash");
    const cookie = verified.headers["set-cookie"];
    expect(cookie).toContain("callassist_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const current = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().user.email).toBe(registration.email);

    const invalidNameUpdate = await app.inject({
      method: "PATCH",
      url: "/api/account/profile/name",
      headers: { cookie },
      payload: { firstName: "", lastName: "Keller", role: "superadmin" }
    });
    expect(invalidNameUpdate.statusCode).toBe(400);

    const nameUpdated = await app.inject({
      method: "PATCH",
      url: "/api/account/profile/name",
      headers: { cookie },
      payload: { firstName: "  Nina-Maria ", lastName: " Keller " }
    });
    expect(nameUpdated.statusCode).toBe(200);
    expect(nameUpdated.json()).toMatchObject({
      status: "profile_updated",
      user: { firstName: "Nina-Maria", lastName: "Keller" }
    });
    const currentAfterNameUpdate = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(currentAfterNameUpdate.json().user).toMatchObject({
      firstName: "Nina-Maria",
      lastName: "Keller"
    });

    const usage = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie }
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({
      balance: 3,
      activeCallBriefId: null,
      transactions: [{ amount: 3, type: "signup_grant" }]
    });

    const verifiedAgain = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "123456" }
    });
    expect(verifiedAgain.statusCode).toBe(200);
    const usageAfterRetry = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie: verifiedAgain.headers["set-cookie"] }
    });
    expect(usageAfterRetry.json()).toMatchObject({ balance: 3 });
    expect(usageAfterRetry.json<{ transactions: unknown[] }>().transactions)
      .toHaveLength(1);

    const loggedOut = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie }
    });
    expect(loggedOut.statusCode).toBe(204);
    expect(loggedOut.headers["set-cookie"]).toContain("Max-Age=0");

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(afterLogout.statusCode).toBe(401);

    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.headers["set-cookie"]).toContain("callassist_session=");
  });

  it("lets an authenticated user revoke every active session", async () => {
    const { app, repository } = createAuthApp();
    const firstCookie = await registerAndVerify(app, registration);
    const secondSession = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    const secondCookie = String(secondSession.headers["set-cookie"]);

    const anonymous = await app.inject({
      method: "POST",
      url: "/api/auth/sessions/revoke"
    });
    expect(anonymous.statusCode).toBe(401);

    const revoked = await app.inject({
      method: "POST",
      url: "/api/auth/sessions/revoke",
      headers: { cookie: firstCookie }
    });
    expect(revoked.statusCode).toBe(204);
    expect(revoked.headers["set-cookie"]).toContain("Max-Age=0");

    for (const cookie of [firstCookie, secondCookie]) {
      const current = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie }
      });
      expect(current.statusCode).toBe(401);
    }
    expect(repository.accountSessionEventsForTest()).toMatchObject([{
      eventType: "session.all_revoked",
      revokedSessionCount: 2,
      targetSessionId: null
    }]);
  });

  it("lists bounded client categories and selectively revokes only owned sessions", async () => {
    const { app, repository } = createAuthApp();
    const firstCookie = await registerAndVerify(app, registration);
    const secondSession = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"
      },
      payload: { email: registration.email, password: registration.password }
    });
    const secondCookie = String(secondSession.headers["set-cookie"]);

    const listed = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { cookie: firstCookie }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("private, no-store");
    const inventory = listed.json<{
      sessions: Array<{
        id: string;
        browser: string;
        platform: string;
        current: boolean;
      }>;
      totalActive: number;
      truncated: boolean;
    }>();
    expect(inventory).toMatchObject({ totalActive: 2, truncated: false });
    expect(inventory.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ browser: "chrome", platform: "windows" }),
      expect.objectContaining({ current: true })
    ]));
    expect(inventory.sessions[0]).not.toHaveProperty("tokenHash");
    expect(inventory.sessions[0]).not.toHaveProperty("userAgent");

    const foreignCookie = await registerAndVerify(app, {
      ...registration,
      email: "foreign-session@example.com",
      phoneE164: "+41710000009"
    });
    const foreignInventory = (await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { cookie: foreignCookie }
    })).json<{ sessions: Array<{ id: string }> }>();
    const foreignSessionId = foreignInventory.sessions[0]!.id;
    const foreignRevoke = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${foreignSessionId}`,
      headers: { cookie: firstCookie }
    });
    expect(foreignRevoke.statusCode).toBe(404);
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: foreignCookie }
    })).statusCode).toBe(200);

    const otherSession = inventory.sessions.find(({ current }) => !current)!;
    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${otherSession.id}`,
      headers: { cookie: firstCookie }
    });
    expect(revoked.statusCode).toBe(204);
    expect(revoked.headers["set-cookie"]).toBeUndefined();
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: secondCookie }
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: firstCookie }
    })).statusCode).toBe(200);
    expect(repository.accountSessionEventsForTest()).toMatchObject([{
      eventType: "session.revoked",
      targetSessionId: otherSession.id,
      revokedSessionCount: 1
    }]);

    const currentSession = inventory.sessions.find(({ current }) => current)!;
    const currentRevoked = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${currentSession.id}`,
      headers: { cookie: firstCookie }
    });
    expect(currentRevoked.statusCode).toBe(204);
    expect(currentRevoked.headers["set-cookie"]).toContain("Max-Age=0");
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: firstCookie }
    })).statusCode).toBe(401);
  });

  it("uses a host-only high-priority secure cookie in production", async () => {
    const { app } = createAuthApp(undefined, {
      production: true,
      secureCookies: true
    });
    const cookie = await registerAndVerify(app, {
      ...registration,
      email: "secure-cookie@example.com"
    });

    expect(cookie).toContain("__Host-callassist_session=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Priority=High");
    expect(cookie).toContain("Secure");
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    })).statusCode).toBe(200);
  });

  it("serves localized policy pages and enforces current onboarding acceptance", async () => {
    const contentRepository = new InMemoryContentRepository();
    const contentService = new ContentService(
      contentRepository,
      () => new Date("2026-08-22T12:00:00.000Z")
    );
    await contentService.initialize();
    const { app } = createAuthApp(contentService);

    const privacy = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=de"
    });
    expect(privacy.statusCode).toBe(200);
    expect(privacy.json().page).toMatchObject({
      key: "privacy",
      locale: "de",
      revision: { number: 1 }
    });
    const wrongLocale = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=en"
    });
    expect(wrongLocale.statusCode).toBe(404);
    const contentIndex = await app.inject({
      method: "GET",
      url: "/api/content/index"
    });
    expect(contentIndex.statusCode).toBe(200);
    expect(contentIndex.headers["cache-control"]).toContain("max-age=60");
    expect(contentIndex.json()).toMatchObject({
      landing: {
        revision: { number: 2 },
        localizations: expect.arrayContaining([
          expect.objectContaining({ locale: "de", translationStale: false })
        ])
      },
      pages: expect.arrayContaining([expect.objectContaining({
        key: "privacy",
        localizations: expect.arrayContaining([
          expect.objectContaining({
            locale: "de",
            slug: "datenschutz",
            translationStale: false
          })
        ])
      })])
    });
    const faq = await app.inject({
      method: "GET",
      url: "/api/content/faq?locale=de"
    });
    expect(faq.statusCode).toBe(200);
    expect(faq.json()).toMatchObject({
      faq: {
        revision: { number: 2 },
        items: expect.arrayContaining([
          expect.objectContaining({ question: expect.stringContaining("KI-Assistent") })
        ])
      }
    });
    const landing = await app.inject({
      method: "GET",
      url: "/api/content/landing?locale=de"
    });
    expect(landing.statusCode).toBe(200);
    expect(landing.headers["cache-control"]).toContain("max-age=60");
    expect(landing.json()).toMatchObject({
      landing: {
        locale: "de",
        revision: { number: 2 },
        blocks: [
          { blockType: "hero" },
          { blockType: "problem" },
          { blockType: "use_cases" },
          { blockType: "example" },
          { blockType: "how_it_works" },
          { blockType: "safety_privacy" },
          { blockType: "languages" },
          { blockType: "faq", itemLimit: 7 },
          { blockType: "cta" }
        ]
      }
    });
    const navigation = await app.inject({
      method: "GET",
      url: "/api/content/navigation?locale=de"
    });
    expect(navigation.statusCode).toBe(200);
    expect(navigation.json()).toMatchObject({
      navigation: {
        items: expect.arrayContaining([
          expect.objectContaining({
            destination: "privacy",
            href: "/de/datenschutz"
          })
        ])
      }
    });

    const cookie = await registerAndVerify(app, registration);
    const blockedBeforeAcceptance = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(blockedBeforeAcceptance.statusCode).toBe(403);
    expect(blockedBeforeAcceptance.json()).toEqual({
      error: "ONBOARDING_REQUIRED"
    });

    const status = await app.inject({
      method: "GET",
      url: "/api/onboarding/status?locale=de",
      headers: { cookie }
    });
    expect(status.statusCode).toBe(200);
    const current = status.json().current;
    expect(status.json()).toMatchObject({ required: true, accepted: null });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/onboarding/accept",
      headers: { cookie },
      payload: {
        locale: "de",
        termsRevisionId: current.terms.id,
        acceptableUseRevisionId: current.acceptableUse.id,
        acceptTerms: true,
        acceptAcceptableUse: true,
        acknowledgeConsent: false,
        acknowledgeRetention: true,
        acknowledgeUseLimits: true,
        acknowledgeCredits: true
      }
    });
    expect(invalid.statusCode).toBe(400);

    const stale = await app.inject({
      method: "POST",
      url: "/api/onboarding/accept",
      headers: { cookie },
      payload: {
        locale: "de",
        termsRevisionId: randomUUID(),
        acceptableUseRevisionId: current.acceptableUse.id,
        acceptTerms: true,
        acceptAcceptableUse: true,
        acknowledgeConsent: true,
        acknowledgeRetention: true,
        acknowledgeUseLimits: true,
        acknowledgeCredits: true
      }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "LEGAL_REVISION_CHANGED" });

    const acceptance = {
      locale: "de",
      termsRevisionId: current.terms.id,
      acceptableUseRevisionId: current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accepted = await app.inject({
        method: "POST",
        url: "/api/onboarding/accept",
        headers: { cookie },
        payload: acceptance
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ required: false });
    }
    expect(contentRepository.acceptancesForTest()).toHaveLength(1);

    const allowedAfterAcceptance = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(allowedAfterAcceptance.statusCode).toBe(200);

    const revisionTwo = seededContentPages
      .filter(({ key }) => key === "acceptable_use")
      .map((page, index) => ({
        ...page,
        revisionLocalizationId: `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        revision: {
          ...page.revision,
          id: "72000000-0000-4000-8000-000000000002",
          number: 2,
          publishedAt: "2026-08-23T00:00:00.000Z"
        }
      }));
    await contentRepository.initializeSeedContent(revisionTwo);

    const blockedAfterChange = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(blockedAfterChange.statusCode).toBe(403);
    const changedStatus = await app.inject({
      method: "GET",
      url: "/api/onboarding/status?locale=de",
      headers: { cookie }
    });
    expect(changedStatus.json()).toMatchObject({
      required: true,
      current: { acceptableUse: { revisionNumber: 2 } }
    });
  });

  it("scopes content editors to audited CMS drafts and excludes call operations", async () => {
    const contentRepository = new InMemoryContentRepository();
    const contentService = new ContentService(
      contentRepository,
      () => new Date("2026-08-25T12:00:00.000Z")
    );
    await contentService.initialize();
    const { app, repository } = createAuthApp(contentService);
    const cookie = await registerAndVerify(app, registration);

    const onboarding = await app.inject({
      method: "GET",
      url: "/api/onboarding/status?locale=de",
      headers: { cookie }
    });
    const current = onboarding.json().current;
    await app.inject({
      method: "POST",
      url: "/api/onboarding/accept",
      headers: { cookie },
      payload: {
        locale: "de",
        termsRevisionId: current.terms.id,
        acceptableUseRevisionId: current.acceptableUse.id,
        acceptTerms: true,
        acceptAcceptableUse: true,
        acknowledgeConsent: true,
        acknowledgeRetention: true,
        acknowledgeUseLimits: true,
        acknowledgeCredits: true
      }
    });

    const forbiddenUser = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages",
      headers: { cookie }
    });
    expect(forbiddenUser.statusCode).toBe(403);
    expect(forbiddenUser.json()).toEqual({ error: "CONTENT_ACTION_FORBIDDEN" });

    const editor = await repository.findUserByEmail(registration.email);
    await repository.setUserRoleForTest(editor!.id, "content_editor");
    const pages = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages",
      headers: { cookie }
    });
    expect(pages.statusCode).toBe(200);
    expect(pages.json<{ pages: unknown[] }>().pages).toHaveLength(5);

    const blockedCalls = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(blockedCalls.statusCode).toBe(403);
    expect(blockedCalls.json()).toEqual({ error: "CALL_ACCESS_FORBIDDEN" });
    const blockedUsers = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie }
    });
    expect(blockedUsers.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/content/pages/privacy/drafts",
      headers: { cookie }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ draft: { number: 2, status: "draft" } });
    const detail = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages/privacy?locale=de",
      headers: { cookie }
    });
    const draft = detail.json().draft;
    const saved = await app.inject({
      method: "PUT",
      url: "/api/admin/content/pages/privacy/draft",
      headers: { cookie },
      payload: {
        locale: "de",
        title: "Datenschutz für die kontrollierte Beta",
        summary: draft.summary,
        sections: draft.sections,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        sourceRevisionNumber: draft.revision.sourceRevisionNumber,
        requiresReacceptance: false
      }
    });
    expect(saved.statusCode).toBe(200);
    const preview = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages/privacy/preview?locale=de",
      headers: { cookie }
    });
    expect(preview.json()).toMatchObject({
      page: { title: "Datenschutz für die kontrollierte Beta" }
    });
    const publishedBefore = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=de"
    });
    expect(publishedBefore.json().page.title).toBe("Datenschutzhinweise");

    const published = await app.inject({
      method: "POST",
      url: "/api/admin/content/pages/privacy/publish",
      headers: { cookie },
      payload: { reason: "Publish reviewed German privacy copy" }
    });
    expect(published.statusCode).toBe(200);
    const publishedAfter = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=de"
    });
    expect(publishedAfter.json()).toMatchObject({
      page: {
        title: "Datenschutz für die kontrollierte Beta",
        revision: { number: 2 }
      }
    });
    const history = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages/privacy/revisions",
      headers: { cookie }
    });
    expect(history.json()).toMatchObject({
      revisions: [
        { number: 2, status: "published" },
        { number: 1, status: "published" }
      ]
    });
    expect(contentRepository.adminEventsForTest().map(({ eventType }) => eventType))
      .toEqual([
        "content.draft_created",
        "content.draft_updated",
        "content.revision_published"
      ]);

    const editorialCreated = await app.inject({
      method: "POST",
      url: "/api/admin/content/editorial/faq/drafts",
      headers: { cookie }
    });
    expect(editorialCreated.statusCode).toBe(201);
    const editorialDetail = await app.inject({
      method: "GET",
      url: "/api/admin/content/editorial/faq",
      headers: { cookie }
    });
    const faqDraft = editorialDetail.json().draft;
    faqDraft.items[0].question.de = "Ist der KI-Anruf offengelegt?";
    const editorialSaved = await app.inject({
      method: "PUT",
      url: "/api/admin/content/editorial/faq/draft",
      headers: { cookie },
      payload: { key: "faq", items: faqDraft.items }
    });
    expect(editorialSaved.statusCode).toBe(200);
    const editorialPublished = await app.inject({
      method: "POST",
      url: "/api/admin/content/editorial/faq/publish",
      headers: { cookie },
      payload: { reason: "Publish reviewed FAQ wording" }
    });
    expect(editorialPublished.statusCode).toBe(200);
    const faqAfter = await app.inject({
      method: "GET",
      url: "/api/content/faq?locale=de"
    });
    expect(faqAfter.json()).toMatchObject({
      faq: {
        revision: { number: 3 },
        items: expect.arrayContaining([
          expect.objectContaining({ question: "Ist der KI-Anruf offengelegt?" })
        ])
      }
    });

    const landingCreated = await app.inject({
      method: "POST",
      url: "/api/admin/content/editorial/landing/drafts",
      headers: { cookie }
    });
    expect(landingCreated.statusCode).toBe(201);
    const landingPreview = await app.inject({
      method: "GET",
      url: "/api/admin/content/editorial/landing/preview",
      headers: { cookie }
    });
    expect(landingPreview.statusCode).toBe(200);
    expect(landingPreview.headers["cache-control"]).toBe("private, no-store");
    expect(landingPreview.json()).toMatchObject({
      draft: {
        key: "landing",
        number: 3,
        items: expect.arrayContaining([
          expect.objectContaining({ blockType: "hero" })
        ])
      }
    });
    const anonymousLandingPreview = await app.inject({
      method: "GET",
      url: "/api/admin/content/editorial/landing/preview"
    });
    expect(anonymousLandingPreview.statusCode).toBe(401);
    const publicLanding = await app.inject({
      method: "GET",
      url: "/api/content/landing?locale=de"
    });
    expect(publicLanding.json()).toMatchObject({
      landing: { revision: { number: 2 } }
    });
  });

  it("requires a session and hides every call resource from other users", async () => {
    const { app, callRepository } = createAuthApp();
    const userACookie = await registerAndVerify(app, registration);
    const userBCookie = await registerAndVerify(app, {
      ...registration,
      email: "leo.meier@example.com",
      phoneE164: "+41710000001",
      firstName: "Leo",
      lastName: "Meier"
    });

    const anonymousList = await app.inject({ method: "GET", url: "/api/call-briefs" });
    expect(anonymousList.statusCode).toBe(401);
    const anonymousRecipients = await app.inject({
      method: "GET",
      url: "/api/recipient-suggestions"
    });
    expect(anonymousRecipients.statusCode).toBe(401);
    const anonymousUsage = await app.inject({ method: "GET", url: "/api/usage" });
    expect(anonymousUsage.statusCode).toBe(401);

    const invalidOrigin = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      headers: {
        cookie: userACookie,
        origin: "https://attacker.example",
        "idempotency-key": randomUUID()
      },
      payload: callBrief
    });
    expect(invalidOrigin.statusCode).toBe(403);
    expect(invalidOrigin.json()).toEqual({ error: "INVALID_ORIGIN" });

    const created = await createPreparedCall(app, userACookie);
    expect(created.statusCode).toBe(201);
    const callId = created.json<{ id: string }>().id;

    const [userAList, userBList] = await Promise.all([
      app.inject({ method: "GET", url: "/api/call-briefs", headers: { cookie: userACookie } }),
      app.inject({ method: "GET", url: "/api/call-briefs", headers: { cookie: userBCookie } })
    ]);
    expect(userAList.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(userBList.json<{ items: unknown[] }>().items).toHaveLength(0);

    const [userARecipients, userBRecipients] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/recipient-suggestions?query=Clinic&limit=10",
        headers: { cookie: userACookie }
      }),
      app.inject({
        method: "GET",
        url: "/api/recipient-suggestions?query=Clinic&limit=10",
        headers: { cookie: userBCookie }
      })
    ]);
    expect(userARecipients.statusCode).toBe(200);
    expect(userARecipients.headers["cache-control"]).toBe("private, no-store");
    expect(userARecipients.json<{ items: Array<{ recipientName: string }> }>().items)
      .toEqual([expect.objectContaining({ recipientName: "Beta Clinic" })]);
    expect(userBRecipients.json<{ items: unknown[] }>().items).toHaveLength(0);

    const invalidRecipients = await app.inject({
      method: "GET",
      url: "/api/recipient-suggestions?limit=21",
      headers: { cookie: userACookie }
    });
    expect(invalidRecipients.statusCode).toBe(400);
    expect(invalidRecipients.json()).toEqual({
      error: "INVALID_RECIPIENT_SUGGESTION_QUERY"
    });

    const crossUserRequests = [
      { method: "GET", url: `/api/call-briefs/${callId}` },
      { method: "PUT", url: `/api/call-briefs/${callId}` },
      { method: "POST", url: `/api/call-briefs/${callId}/approve` },
      { method: "POST", url: `/api/call-briefs/${callId}/approve-and-start` },
      { method: "POST", url: `/api/call-briefs/${callId}/start` },
      { method: "POST", url: `/api/call-briefs/${callId}/stop` },
      { method: "GET", url: `/api/call-briefs/${callId}/recording` },
      { method: "DELETE", url: `/api/call-briefs/${callId}/recording` },
      { method: "POST", url: `/api/call-briefs/${callId}/final-transcript/retry` },
      { method: "GET", url: `/api/call-briefs/${callId}/outcome` },
      { method: "PUT", url: `/api/call-briefs/${callId}/feedback` },
      { method: "POST", url: `/api/call-briefs/${callId}/approvals/00000000-0000-4000-8000-000000000001` },
      { method: "GET", url: `/api/call-briefs/${callId}/events` }
    ] as const;
    for (const request of crossUserRequests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { cookie: userBCookie }
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(404);
      expect(response.json()).toEqual({ error: "CALL_NOT_FOUND" });
    }

    const malformedId = await app.inject({
      method: "GET",
      url: "/api/call-briefs/not-a-uuid",
      headers: { cookie: userACookie }
    });
    expect(malformedId.statusCode).toBe(404);
    expect(malformedId.json()).toEqual({ error: "CALL_NOT_FOUND" });

    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/call-briefs/${callId}`,
      headers: { cookie: userACookie }
    });
    expect(ownerRead.statusCode).toBe(200);

    const approved = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie: userACookie }
    });
    expect(approved.statusCode).toBe(200);
    const started = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie: userACookie }
    });
    expect(started.statusCode).toBe(200);
    const ownerUsage = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie: userACookie }
    });
    expect(ownerUsage.json()).toMatchObject({
      balance: 2,
      activeCallBriefId: callId
    });
    await callRepository.updateStatus(callId, "completed");

    const beforeFeedback = await app.inject({
      method: "GET",
      url: `/api/call-briefs/${callId}/outcome`,
      headers: { cookie: userACookie }
    });
    expect(beforeFeedback.statusCode).toBe(200);
    expect(beforeFeedback.json()).toMatchObject({
      technical: {
        connection: "not_confirmed",
        terminalStatus: "completed"
      },
      latestOutcome: null,
      latestFeedback: null
    });
    const feedback = await app.inject({
      method: "PUT",
      url: `/api/call-briefs/${callId}/feedback`,
      headers: { cookie: userACookie },
      payload: {
        idempotencyKey: randomUUID(),
        goalResult: "yes",
        transcriptQuality: null,
        comment: "Explicit owner assessment"
      }
    });
    expect(feedback.statusCode).toBe(200);
    expect(feedback.json()).toMatchObject({
      latestOutcome: {
        outcome: "resolved",
        provenance: "user"
      },
      latestFeedback: {
        goalResult: "yes",
        comment: "Explicit owner assessment"
      }
    });
    const userMetrics = await app.inject({
      method: "GET",
      url: "/api/admin/call-outcome-metrics",
      headers: { cookie: userACookie }
    });
    expect(userMetrics.statusCode).toBe(403);
    for (const request of [
      { method: "GET", url: "/api/admin/calls" },
      { method: "GET", url: `/api/admin/calls/${callId}` },
      {
        method: "POST",
        url: `/api/admin/calls/${callId}/sensitive-access`,
        payload: { reason: "Unauthorized access test" }
      }
    ] as const) {
      const response = await app.inject({
        ...request,
        headers: { cookie: userACookie }
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("changes the login email only after password proof and new-address verification", async () => {
    const emailProvider = new MockEmailProvider();
    const { app, repository } = createAuthApp(undefined, { emailProvider });
    const cookie = await registerAndVerify(app, registration);
    const secondSession = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    const secondCookie = String(secondSession.headers["set-cookie"]);
    const newEmail = `changed-${randomUUID()}@example.com`;

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/email-change/start",
      headers: { cookie },
      payload: { newEmail, currentPassword: "wrong-password" }
    });
    expect(wrongPassword.statusCode).toBe(401);

    const started = await app.inject({
      method: "POST",
      url: "/api/auth/email-change/start",
      headers: { cookie },
      payload: { newEmail: ` ${newEmail.toUpperCase()} `, currentPassword: registration.password }
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({
      status: "verification_required",
      emailChangeId: expect.any(String),
      expiresAt: expect.any(String)
    });
    expect(emailProvider.verificationMessages).toEqual([
      expect.objectContaining({ to: newEmail, code: "654321" })
    ]);
    expect(emailProvider.noticeMessages).toEqual([
      expect.objectContaining({ to: registration.email, proposedEmail: newEmail })
    ]);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/email-change/confirm",
      headers: { cookie },
      payload: { emailChangeId: started.json().emailChangeId, code: "111111" }
    });
    expect(rejected.statusCode).toBe(401);

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/auth/email-change/confirm",
      headers: { cookie },
      payload: { emailChangeId: started.json().emailChangeId, code: "654321" }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      status: "email_changed",
      user: { email: newEmail },
      revokedSessionCount: 1
    });
    await expect(repository.findUserByEmail(registration.email)).resolves.toBeNull();
    await expect(repository.findUserByEmail(newEmail)).resolves.toMatchObject({
      email: newEmail
    });

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: secondCookie }
    });
    expect(oldSession.statusCode).toBe(401);
    const currentSession = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(currentSession.json().user.email).toBe(newEmail);

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/email-change/confirm",
      headers: { cookie },
      payload: { emailChangeId: started.json().emailChangeId, code: "654321" }
    });
    expect(replay.statusCode).toBe(401);
  });

  it("accepts call preparation quickly and exposes only its durable owner state", async () => {
    const { app } = createAuthApp();
    const ownerCookie = await registerAndVerify(app, registration);
    const otherCookie = await registerAndVerify(app, {
      ...registration,
      email: "preparation-other@example.com",
      phoneE164: "+41710000006",
      firstName: "Leo",
      lastName: "Meier"
    });
    const idempotencyKey = randomUUID();
    const request = {
      method: "POST" as const,
      url: "/api/call-preparations",
      headers: {
        cookie: ownerCookie,
        "idempotency-key": idempotencyKey
      },
      payload: callBrief
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    const preparationId = first.json<{ id: string }>().id;
    expect(replay.json<{ id: string }>().id).toBe(preparationId);
    expect(first.headers.location).toBe(
      `/api/call-preparations/${preparationId}`
    );

    const hidden = await app.inject({
      method: "GET",
      url: `/api/call-preparations/${preparationId}`,
      headers: { cookie: otherCookie }
    });
    expect(hidden.statusCode).toBe(404);

    let status = first;
    for (let index = 0; index < 20; index++) {
      status = await app.inject({
        method: "GET",
        url: `/api/call-preparations/${preparationId}`,
        headers: { cookie: ownerCookie }
      });
      if (status.json().status === "succeeded") break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      id: preparationId,
      status: "succeeded",
      attemptCount: 1,
      failureCode: null
    });
    const list = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie: ownerCookie }
    });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("keeps call preparation validation and idempotency conflicts explicit", async () => {
    const { app } = createAuthApp();
    const cookie = await registerAndVerify(app, registration);

    const legacy = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie },
      payload: callBrief
    });
    expect(legacy.statusCode).toBe(404);

    const invalidKey = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      headers: { cookie, "idempotency-key": "not-a-uuid" },
      payload: callBrief
    });
    expect(invalidKey.statusCode).toBe(400);
    expect(invalidKey.json()).toEqual({ error: "INVALID_IDEMPOTENCY_KEY" });

    const foreignNumber = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      headers: { cookie, "idempotency-key": randomUUID() },
      payload: { ...callBrief, phoneNumber: "+442079460000" }
    });
    expect(foreignNumber.statusCode).toBe(400);
    expect(foreignNumber.json()).toMatchObject({
      error: "INVALID_CALL_BRIEF",
      issues: {
        fieldErrors: {
          phoneNumber: [
            "During the public beta SHPROHLI can only call Swiss phone numbers."
          ]
        }
      }
    });

    const idempotencyKey = randomUUID();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload: callBrief
    });
    expect(accepted.statusCode).toBe(202);
    const conflict = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload: { ...callBrief, objective: `${callBrief.objective} tomorrow` }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: "CALL_PREPARATION_IDEMPOTENCY_CONFLICT"
    });
  });

  it("fails closed before call preparation when abuse control is unavailable", async () => {
    const { app, callRepository } = createAuthApp(undefined, {
      endpointRateLimiter: unavailableRateLimiter()
    });
    const cookie = await registerAndVerify(app, registration);
    const response = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      headers: { cookie, "idempotency-key": randomUUID() },
      payload: callBrief
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json()).toEqual({ error: "RATE_LIMIT_UNAVAILABLE" });
    expect((await callRepository.list({ limit: 1, userId: null })).items).toEqual([]);
  });

  it("separates minimized Admin Calls from audited superadmin content access", async () => {
    const { app, repository, callRepository } = createAuthApp();
    const ownerCookie = await registerAndVerify(app, registration);
    const adminRegistration = {
      ...registration,
      email: "call-inspector-admin@example.com",
      phoneE164: "+41710000031",
      firstName: "Ari",
      lastName: "Inspector"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const adminMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    const adminId = adminMe.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");

    const created = await createPreparedCall(app, ownerCookie);
    const callId = created.json<{ id: string }>().id;
    await callRepository.updateStatus(callId, "failed");
    await callRepository.recordSystemCallOutcome(callId);

    const invalidQuery = await app.inject({
      method: "GET",
      url: "/api/admin/calls?limit=0",
      headers: { cookie: adminCookie }
    });
    expect(invalidQuery.statusCode).toBe(400);

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/calls?status=failed&locale=de-CH",
      headers: { cookie: adminCookie }
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.json().items).toEqual([
      expect.objectContaining({ id: callId, status: "failed" })
    ]);
    expect(JSON.stringify(list.json())).not.toContain(callBrief.phoneNumber);
    expect(JSON.stringify(list.json())).not.toContain(callBrief.objective);

    const inspector = await app.inject({
      method: "GET",
      url: `/api/admin/calls/${callId}`,
      headers: { cookie: adminCookie }
    });
    expect(inspector.statusCode).toBe(200);
    expect(inspector.json()).toMatchObject({
      summary: { id: callId },
      timeline: expect.any(Array),
      outcomeHistory: expect.any(Array)
    });
    expect(JSON.stringify(inspector.json())).not.toContain(callBrief.phoneNumber);

    const adminSensitive = await app.inject({
      method: "POST",
      url: `/api/admin/calls/${callId}/sensitive-access`,
      headers: { cookie: adminCookie },
      payload: { reason: "Investigating support ticket 123" }
    });
    expect(adminSensitive.statusCode).toBe(403);
    expect(callRepository.sensitiveCallAccessEventsForTest()).toHaveLength(0);

    await repository.setUserRoleForTest(adminId, "superadmin");
    const invalidReason = await app.inject({
      method: "POST",
      url: `/api/admin/calls/${callId}/sensitive-access`,
      headers: { cookie: adminCookie },
      payload: { reason: "x" }
    });
    expect(invalidReason.statusCode).toBe(400);

    const sensitive = await app.inject({
      method: "POST",
      url: `/api/admin/calls/${callId}/sensitive-access`,
      headers: { cookie: adminCookie },
      payload: { reason: "Investigating support ticket 123" }
    });
    expect(sensitive.statusCode).toBe(200);
    expect(sensitive.json()).toMatchObject({
      callBriefId: callId,
      phoneNumber: callBrief.phoneNumber,
      objective: expect.any(String)
    });
    expect(callRepository.sensitiveCallAccessEventsForTest()).toEqual([
      expect.objectContaining({
        callBriefId: callId,
        actorUserId: adminId,
        reason: "Investigating support ticket 123"
      })
    ]);
  });

  it("protects operational metrics and reasoned outbound-call control", async () => {
    const { app, repository, callRepository } = createAuthApp();
    const userCookie = await registerAndVerify(app, registration);
    const adminRegistration = {
      ...registration,
      email: "operations-admin@example.com",
      phoneE164: "+41710000032",
      firstName: "Ona",
      lastName: "Operations"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const adminMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    const adminId = adminMe.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");

    for (const url of [
      "/api/admin/operations/overview",
      "/api/admin/system"
    ]) {
      const forbidden = await app.inject({
        method: "GET",
        url,
        headers: { cookie: userCookie }
      });
      expect(forbidden.statusCode).toBe(403);
    }
    const invalidWindow = await app.inject({
      method: "GET",
      url: "/api/admin/operations/overview?window=year",
      headers: { cookie: adminCookie }
    });
    expect(invalidWindow.statusCode).toBe(400);

    const overview = await app.inject({
      method: "GET",
      url: "/api/admin/operations/overview?window=7d",
      headers: { cookie: adminCookie }
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.headers["cache-control"]).toBe("private, no-store");
    expect(overview.json()).toMatchObject({
      window: { kind: "7d", cohort: "call_created_at" },
      cost: { status: "unavailable", estimatedUsdMicros: null },
      reliability: {
        realtimeReconnects: { status: "not_supported", count: null }
      }
    });

    const disabled = await app.inject({
      method: "PUT",
      url: "/api/admin/system/outbound-calls",
      headers: { cookie: adminCookie },
      payload: {
        enabled: false,
        reason: "Investigating elevated provider failures"
      }
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({
      outboundCalls: {
        enabled: false,
        reason: "Investigating elevated provider failures"
      },
      rateLimits: {
        state: "healthy",
        mode: "memory",
        shared: false,
        activeBuckets: expect.any(Number),
        allowed: expect.any(Number),
        denied: expect.any(Number),
        topDeniedScopes: expect.any(Array)
      },
      jobs: {
        queued: 0,
        running: 0,
        deadLetter: 0,
        recent: []
      }
    });

    const adminRetry = await app.inject({
      method: "POST",
      url: `/api/admin/system/jobs/${randomUUID()}/retry`,
      headers: { cookie: adminCookie },
      payload: { reason: "Provider incident has cleared" }
    });
    expect(adminRetry.statusCode).toBe(403);
    expect(adminRetry.json()).toEqual({
      error: "DURABLE_JOB_RETRY_FORBIDDEN"
    });

    const adminEnable = await app.inject({
      method: "PUT",
      url: "/api/admin/system/outbound-calls",
      headers: { cookie: adminCookie },
      payload: {
        enabled: true,
        reason: "Provider has recovered"
      }
    });
    expect(adminEnable.statusCode).toBe(403);
    expect(adminEnable.json()).toEqual({
      error: "OUTBOUND_CALL_ENABLE_FORBIDDEN"
    });

    await repository.setUserRoleForTest(adminId, "superadmin");
    const missingJobRetry = await app.inject({
      method: "POST",
      url: `/api/admin/system/jobs/${randomUUID()}/retry`,
      headers: { cookie: adminCookie },
      payload: { reason: "Provider incident has cleared" }
    });
    expect(missingJobRetry.statusCode).toBe(404);
    expect(missingJobRetry.json()).toEqual({
      error: "DURABLE_JOB_NOT_FOUND"
    });

    const enabled = await app.inject({
      method: "PUT",
      url: "/api/admin/system/outbound-calls",
      headers: { cookie: adminCookie },
      payload: {
        enabled: true,
        reason: "Provider has recovered"
      }
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({
      outboundCalls: { enabled: true, reason: "Provider has recovered" }
    });
    expect(callRepository.safetyEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "outbound_calls.disabled",
          actorUserId: adminId
        }),
        expect.objectContaining({
          eventType: "outbound_calls.enabled",
          actorUserId: adminId
        })
      ])
    );
  });

  it("uses a generic response for duplicate registration and generic login errors", async () => {
    const { app } = createAuthApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: registration
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: registration
    });
    expect(duplicate.statusCode).toBe(first.statusCode);
    expect(duplicate.json()).toEqual(first.json());

    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: "wrong-password" }
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ error: "INVALID_CREDENTIALS" });
  });

  it("requires both registration name fields and rejects foreign browser origins", async () => {
    const { app } = createAuthApp();
    const { lastName: _lastName, ...withoutLastName } = registration;
    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: withoutLastName
    });
    expect(invalid.statusCode).toBe(400);

    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: "https://attacker.example" },
      payload: registration
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json()).toEqual({ error: "INVALID_ORIGIN" });
  });

  it("returns explicit API errors for recipient suppression and the global kill switch", async () => {
    const { app, callRepository } = createAuthApp();
    const cookie = await registerAndVerify(app, registration);
    const created = await createPreparedCall(app, cookie);
    const callId = created.json<{ id: string }>().id;
    await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie }
    });

    await callRepository.suppressRecipient({
      phoneE164: callBrief.phoneNumber,
      source: "recipient_request",
      reason: "Recipient requested no further calls"
    });
    const suppressed = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(suppressed.statusCode).toBe(403);
    expect(suppressed.json()).toEqual({ error: "RECIPIENT_SUPPRESSED" });

    await callRepository.liftRecipientSuppression(callBrief.phoneNumber, {
      reason: "Recipient withdrew the suppression request"
    });
    await callRepository.setOutboundCallsEnabled(false, {
      reason: "Emergency pause test"
    });
    const disabled = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json()).toEqual({ error: "OUTBOUND_CALLS_DISABLED" });

    await callRepository.setOutboundCallsEnabled(true, {
      reason: "Emergency pause cleared"
    });
    const started = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(started.statusCode).toBe(200);
  });

  it("accepts a public opt-out only after SMS proof and blocks future calls", async () => {
    const { app, callRepository } = createAuthApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/verification",
      payload: { phoneE164: "not-a-phone" }
    });
    expect(invalid.statusCode).toBe(400);

    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/verification",
      headers: { origin: "https://attacker.example" },
      payload: { phoneE164: callBrief.phoneNumber }
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const requested = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/verification",
      payload: { phoneE164: callBrief.phoneNumber }
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toEqual({ status: "verification_required" });

    const rejected = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/confirm",
      payload: { phoneE164: callBrief.phoneNumber, code: "999999" }
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toEqual({ error: "INVALID_OPT_OUT_VERIFICATION" });

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/confirm",
      payload: { phoneE164: callBrief.phoneNumber, code: "123456" }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ status: "suppressed" });
    expect(callRepository.safetyEventsForTest()).toContainEqual({
      eventType: "recipient.suppressed",
      actorUserId: null,
      phoneE164: callBrief.phoneNumber,
      source: "recipient_request",
      reason: "Recipient confirmed public opt-out by SMS"
    });

    const cookie = await registerAndVerify(app, registration);
    const created = await createPreparedCall(app, cookie);
    const callId = created.json<{ id: string }>().id;
    await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie }
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: "RECIPIENT_SUPPRESSED" });
  });

  it("allows only administrators to suppress or lift recipients as staff", async () => {
    const { app, repository, callRepository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "safety-admin@example.com",
      phoneE164: "+41710000005"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const userCookie = await registerAndVerify(app, registration);
    const [adminMe, userMe] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: adminCookie }
      }),
      app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: userCookie }
      })
    ]);
    const adminId = adminMe.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");
    await repository.setUserRoleForTest(userMe.json().user.id, "support");

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions",
      headers: { cookie: userCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        source: "staff",
        reason: "Support request received"
      }
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "ADMIN_ACTION_FORBIDDEN" });

    const suppressed = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        source: "complaint",
        reason: "Complaint verified by support"
      }
    });
    expect(suppressed.statusCode).toBe(200);
    expect(suppressed.json()).toEqual({ status: "suppressed" });
    const duplicateSuppression = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        source: "staff",
        reason: "Duplicate operator request"
      }
    });
    expect(duplicateSuppression.json()).toEqual({
      status: "already_suppressed"
    });

    const created = await createPreparedCall(app, userCookie);
    const callId = created.json<{ id: string }>().id;
    await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie: userCookie }
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie: userCookie }
    })).statusCode).toBe(403);

    const lifted = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions/lift",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        reason: "Recipient identity and consent re-verified"
      }
    });
    expect(lifted.statusCode).toBe(200);
    expect(lifted.json()).toEqual({ status: "lifted" });
    const duplicateLift = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions/lift",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        reason: "Duplicate lift request"
      }
    });
    expect(duplicateLift.json()).toEqual({ status: "not_suppressed" });
    expect(callRepository.safetyEventsForTest().slice(-2)).toEqual([
      {
        eventType: "recipient.suppressed",
        actorUserId: adminId,
        phoneE164: callBrief.phoneNumber,
        source: "complaint",
        reason: "Complaint verified by support"
      },
      {
        eventType: "recipient.suppression_lifted",
        actorUserId: adminId,
        phoneE164: callBrief.phoneNumber,
        reason: "Recipient identity and consent re-verified"
      }
    ]);
    expect((await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie: userCookie }
    })).statusCode).toBe(200);
  });

  it("rejects an incorrect SMS verification code without creating a session", async () => {
    const { app } = createAuthApp();
    await app.inject({ method: "POST", url: "/api/auth/register", payload: registration });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "999999" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "INVALID_VERIFICATION" });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("changes a verified phone only for the initiating session and invalidates old recovery", async () => {
    const { app, repository } = createAuthApp();
    const ownerCookie = await registerAndVerify(app, registration);
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    expect(secondLogin.statusCode).toBe(200);
    const secondCookie = String(secondLogin.headers["set-cookie"]);

    const recoveryStart = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/start",
      payload: { email: registration.email }
    });
    const recoveryVerify = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/verify",
      payload: {
        recoveryId: recoveryStart.json().recoveryId,
        code: "123456"
      }
    });
    expect(recoveryVerify.statusCode).toBe(200);
    const staleRecoveryToken = recoveryVerify.json().recoveryToken as string;

    const occupiedRegistration = {
      ...registration,
      email: "occupied-phone@example.com",
      phoneE164: "+41710000042",
      firstName: "Other",
      lastName: "Owner"
    };
    const occupiedCookie = await registerAndVerify(app, occupiedRegistration);
    const occupied = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/start",
      headers: { cookie: ownerCookie },
      payload: {
        newPhoneE164: occupiedRegistration.phoneE164,
        currentPassword: registration.password
      }
    });
    expect(occupied.statusCode).toBe(202);
    const occupiedConfirmation = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/confirm",
      headers: { cookie: ownerCookie },
      payload: {
        phoneChangeId: occupied.json().phoneChangeId,
        code: "123456"
      }
    });
    expect(occupiedConfirmation.statusCode).toBe(401);
    expect(occupiedConfirmation.json()).toEqual({
      error: "INVALID_PHONE_CHANGE"
    });

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/start",
      headers: { cookie: ownerCookie },
      payload: {
        newPhoneE164: "+41710000043",
        currentPassword: "wrong-password"
      }
    });
    expect(wrongPassword.statusCode).toBe(401);

    const started = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/start",
      headers: { cookie: ownerCookie },
      payload: {
        newPhoneE164: "+41710000043",
        currentPassword: registration.password
      }
    });
    expect(started.statusCode).toBe(202);
    expect(started.headers["cache-control"]).toBe("private, no-store");
    const phoneChangeId = started.json().phoneChangeId as string;

    const foreign = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/confirm",
      headers: { cookie: occupiedCookie },
      payload: { phoneChangeId, code: "123456" }
    });
    expect(foreign.statusCode).toBe(401);
    expect(foreign.json()).toEqual({ error: "INVALID_PHONE_CHANGE" });

    const wrongCode = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/confirm",
      headers: { cookie: ownerCookie },
      payload: { phoneChangeId, code: "000000" }
    });
    expect(wrongCode.statusCode).toBe(401);

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/confirm",
      headers: { cookie: ownerCookie },
      payload: { phoneChangeId, code: "123456" }
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers["cache-control"]).toBe("private, no-store");
    expect(changed.json()).toMatchObject({
      status: "phone_changed",
      user: { phoneE164: "+41710000043" },
      revokedSessionCount: 1
    });
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: ownerCookie }
    })).json().user.phoneE164).toBe("+41710000043");
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: secondCookie }
    })).statusCode).toBe(401);

    const staleRecovery = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/complete",
      payload: {
        recoveryToken: staleRecoveryToken,
        newPassword: "a-stale-recovery-password"
      }
    });
    expect(staleRecovery.statusCode).toBe(401);
    expect(staleRecovery.json()).toEqual({ error: "INVALID_RECOVERY" });
    expect(repository.phoneChangeEventsForTest()).toEqual([
      expect.objectContaining({
        challengeId: phoneChangeId,
        revokedSessionCount: 1,
        invalidatedRecoveryChallengeCount: 1,
        invalidatedRecoveryGrantCount: 1
      })
    ]);
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/confirm",
      headers: { cookie: ownerCookie },
      payload: { phoneChangeId, code: "123456" }
    })).statusCode).toBe(401);
  });

  it("invalidates a phone-change challenge when SMS delivery fails", async () => {
    const failingPhone = "+41710000044";
    const requested = new Set<string>();
    const verificationProvider: VerificationProvider = {
      mode: "mock",
      async send(phoneE164) {
        if (phoneE164 === failingPhone) throw new Error("provider unavailable");
        requested.add(phoneE164);
      },
      async check(phoneE164, code) {
        return requested.has(phoneE164) && code === "123456";
      }
    };
    const { app, repository } = createAuthApp(undefined, {
      verificationProvider
    });
    const cookie = await registerAndVerify(app, registration);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/start",
      headers: { cookie },
      payload: {
        newPhoneE164: failingPhone,
        currentPassword: registration.password
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "VERIFICATION_UNAVAILABLE" });
    expect(repository.phoneChangeChallengesForTest()).toEqual([
      expect.objectContaining({
        newPhoneE164: failingPhone,
        completedAt: null,
        invalidatedAt: expect.any(String)
      })
    ]);
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    })).json().user.phoneE164).toBe(registration.phoneE164);
  });

  it("does not create a challenge for the already verified number", async () => {
    const { app, repository } = createAuthApp();
    const cookie = await registerAndVerify(app, registration);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/phone-change/start",
      headers: { cookie },
      payload: {
        newPhoneE164: registration.phoneE164,
        currentPassword: registration.password
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "PHONE_CHANGE_NOT_AVAILABLE" });
    expect(repository.phoneChangeChallengesForTest()).toEqual([]);
  });

  it("recovers a verified account without enumeration and revokes every session", async () => {
    const { app, repository } = createAuthApp();
    const firstCookie = await registerAndVerify(app, registration);
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: registration.email,
        password: registration.password
      }
    });
    expect(secondLogin.statusCode).toBe(200);
    const secondCookie = String(secondLogin.headers["set-cookie"]);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/start",
      payload: { email: "absent@example.com" }
    });
    const known = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/start",
      payload: { email: registration.email }
    });
    expect([unknown.statusCode, known.statusCode]).toEqual([202, 202]);
    expect(unknown.json()).toMatchObject({ status: "verification_required" });
    expect(known.json()).toMatchObject({ status: "verification_required" });
    expect(Object.keys(unknown.json()).sort()).toEqual(
      Object.keys(known.json()).sort()
    );
    expect(unknown.json().recoveryId).not.toBe(known.json().recoveryId);
    expect(known.headers["cache-control"]).toBe("no-store");

    const approved = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/verify",
      payload: { recoveryId: known.json().recoveryId, code: "123456" }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      status: "password_reset_required"
    });
    expect(Object.keys(approved.json()).sort()).toEqual([
      "recoveryToken",
      "status"
    ]);

    const newPassword = "a-new-secure-password";
    const completed = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/complete",
      payload: {
        recoveryToken: approved.json().recoveryToken,
        newPassword
      }
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ status: "password_reset" });
    expect(completed.headers["set-cookie"]).toBeUndefined();

    for (const cookie of [firstCookie, secondCookie]) {
      const current = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie }
      });
      expect(current.statusCode).toBe(401);
    }
    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    expect(oldLogin.statusCode).toBe(401);
    const freshLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: newPassword }
    });
    expect(freshLogin.statusCode).toBe(200);

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/complete",
      payload: {
        recoveryToken: approved.json().recoveryToken,
        newPassword: "another-secure-password"
      }
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: "INVALID_RECOVERY" });
    expect(repository.passwordRecoveryEventsForTest()).toMatchObject([{
      revokedSessionCount: 2
    }]);
  });

  it("keeps recovery generic for suspended and deletion-pending accounts", async () => {
    const { app, repository } = createAuthApp();
    const cookie = await registerAndVerify(app, registration);
    const current = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    const userId = current.json().user.id as string;
    await repository.setUserStatusForTest(userId, "suspended");
    const suspended = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/start",
      payload: { email: registration.email }
    });
    expect(suspended.statusCode).toBe(202);
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/recovery/verify",
      payload: { recoveryId: suspended.json().recoveryId, code: "123456" }
    })).json()).toEqual({ error: "INVALID_RECOVERY" });

    await repository.setUserStatusForTest(userId, "active");
    await repository.requestAccountDeletion({
      requestId: randomUUID(),
      userId,
      now: new Date().toISOString(),
      maxAttempts: 5
    });
    const deletionPending = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/start",
      payload: { email: registration.email }
    });
    expect(deletionPending.statusCode).toBe(202);
    expect((await app.inject({
      method: "POST",
      url: "/api/auth/recovery/verify",
      payload: { recoveryId: deletionPending.json().recoveryId, code: "123456" }
    })).json()).toEqual({ error: "INVALID_RECOVERY" });
  });

  it("does not disclose an eligible account when recovery verification fails upstream", async () => {
    let checks = 0;
    const verificationProvider: VerificationProvider = {
      mode: "mock",
      async send() {},
      async check(_phoneE164, code) {
        checks += 1;
        if (checks === 1) return code === "123456";
        throw new Error("provider details must not escape");
      }
    };
    const { app } = createAuthApp(undefined, { verificationProvider });
    await registerAndVerify(app, registration);
    const started = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/start",
      payload: { email: registration.email }
    });
    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/recovery/verify",
      payload: { recoveryId: started.json().recoveryId, code: "123456" }
    });
    expect(verified.statusCode).toBe(401);
    expect(verified.json()).toEqual({ error: "INVALID_RECOVERY" });
  });

  it("invalidates an existing session when the account is suspended", async () => {
    const { app, repository } = createAuthApp();
    await app.inject({ method: "POST", url: "/api/auth/register", payload: registration });
    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "123456" }
    });
    const userId = verified.json().user.id as string;
    const cookie = verified.headers["set-cookie"];
    await repository.setUserStatusForTest(userId, "suspended");

    const current = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(current.statusCode).toBe(401);
  });

  it("restricts audited suspend, unsuspend, and force logout actions to administrators", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "admin@example.com",
      phoneE164: "+41710000003",
      firstName: "Ada",
      lastName: "Admin"
    };
    const targetRegistration = {
      ...registration,
      email: "target@example.com",
      phoneE164: "+41710000004",
      firstName: "Tara",
      lastName: "Target"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const targetCookie = await registerAndVerify(app, targetRegistration);
    const adminMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    const targetMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: targetCookie }
    });
    const adminId = adminMe.json().user.id as string;
    const targetId = targetMe.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");

    const outcomeMetrics = await app.inject({
      method: "GET",
      url: "/api/admin/call-outcome-metrics",
      headers: { cookie: adminCookie }
    });
    expect(outcomeMetrics.statusCode).toBe(200);
    expect(outcomeMetrics.headers["cache-control"]).toBe("private, no-store");
    expect(outcomeMetrics.json()).toMatchObject({
      terminalCalls: 0,
      feedbackResponses: 0,
      goalResults: { yes: 0, partly: 0, no: 0 }
    });

    await repository.setUserRoleForTest(targetId, "support");
    const privilegedTargetAction = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Privilege boundary test" }
    });
    expect(privilegedTargetAction.statusCode).toBe(403);
    expect(privilegedTargetAction.json()).toEqual({
      error: "ADMIN_ACTION_FORBIDDEN"
    });
    await repository.setUserRoleForTest(targetId, "user");

    const secondTargetLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: targetRegistration.email,
        password: targetRegistration.password
      }
    });
    const secondTargetCookie = String(secondTargetLogin.headers["set-cookie"]);

    const foreignOriginAction = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie, origin: "https://attacker.example" },
      payload: { status: "suspended", reason: "Cross-site action test" }
    });
    expect(foreignOriginAction.statusCode).toBe(403);
    expect(foreignOriginAction.json()).toEqual({ error: "INVALID_ORIGIN" });

    const nonAdminAction = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${adminId}/status`,
      headers: { cookie: targetCookie },
      payload: { status: "suspended", reason: "Unauthorized attempt" }
    });
    expect(nonAdminAction.statusCode).toBe(403);
    expect(nonAdminAction.json()).toEqual({ error: "ADMIN_ACTION_FORBIDDEN" });

    const suspended = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Repeated abuse reports" }
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().user).toMatchObject({
      id: targetId,
      status: "suspended"
    });
    expect(suspended.json().user).not.toHaveProperty("passwordHash");
    for (const cookie of [targetCookie, secondTargetCookie]) {
      const current = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie }
      });
      expect(current.statusCode).toBe(401);
    }
    const suspendedLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: targetRegistration.email,
        password: targetRegistration.password
      }
    });
    expect(suspendedLogin.statusCode).toBe(403);
    expect(suspendedLogin.json()).toEqual({ error: "ACCOUNT_SUSPENDED" });

    const duplicateSuspension = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Duplicate action" }
    });
    expect(duplicateSuspension.statusCode).toBe(409);
    expect(duplicateSuspension.json()).toEqual({
      error: "ACCOUNT_STATUS_UNCHANGED"
    });

    const unsuspended = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "active", reason: "Review completed" }
    });
    expect(unsuspended.statusCode).toBe(200);
    expect(unsuspended.json().user.status).toBe("active");
    const oldSessionAfterUnsuspend = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: targetCookie }
    });
    expect(oldSessionAfterUnsuspend.statusCode).toBe(401);

    const freshLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: targetRegistration.email,
        password: targetRegistration.password
      }
    });
    expect(freshLogin.statusCode).toBe(200);
    const freshCookie = String(freshLogin.headers["set-cookie"]);
    const forceLogout = await app.inject({
      method: "POST",
      url: `/api/admin/users/${targetId}/sessions/revoke`,
      headers: { cookie: adminCookie },
      payload: { reason: "Credential reset requested" }
    });
    expect(forceLogout.statusCode).toBe(204);
    const afterForceLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: freshCookie }
    });
    expect(afterForceLogout.statusCode).toBe(401);

    const selfSuspension = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${adminId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Self action test" }
    });
    expect(selfSuspension.statusCode).toBe(403);
    expect(selfSuspension.json()).toEqual({
      error: "SELF_ADMIN_ACTION_FORBIDDEN"
    });

    expect(repository.accountAdminEventsForTest()).toMatchObject([
      {
        eventType: "account.suspended",
        actorUserId: adminId,
        targetUserId: targetId,
        reason: "Repeated abuse reports"
      },
      {
        eventType: "account.unsuspended",
        actorUserId: adminId,
        targetUserId: targetId,
        reason: "Review completed"
      },
      {
        eventType: "account.sessions_revoked",
        actorUserId: adminId,
        targetUserId: targetId,
        reason: "Credential reset requested"
      }
    ]);
  });

  it("creates and redeems promo codes exactly once without storing the raw code in usage", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "credits-admin@example.com",
      phoneE164: "+41710000008"
    };
    const userRegistration = {
      ...registration,
      email: "promo-user@example.com",
      phoneE164: "+41710000009"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const userCookie = await registerAndVerify(app, userRegistration);
    const admin = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    await repository.setUserRoleForTest(admin.json().user.id, "admin");

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/admin/promo-codes",
      headers: { cookie: userCookie },
      payload: promoCreation("CALLASSIST25")
    });
    expect(forbidden.statusCode).toBe(403);

    const creation = promoCreation("CALLASSIST25");
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/promo-codes",
      headers: { cookie: adminCookie },
      payload: creation
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      created: true,
      promoCode: { credits: 5, campaign: "Beta launch" }
    });
    expect(JSON.stringify(created.json())).not.toContain("CALLASSIST25");

    const idempotencyKey = randomUUID();
    const redeem = () => app.inject({
      method: "POST",
      url: "/api/credits/promo-redemptions",
      headers: { cookie: userCookie },
      payload: { code: "callassist25", idempotencyKey }
    });
    const first = await redeem();
    const replay = await redeem();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ applied: true, usage: { balance: 8 } });
    expect(replay.json()).toMatchObject({ applied: false, usage: { balance: 8 } });
    expect(first.json().usage.transactions).toContainEqual(expect.objectContaining({
      type: "promo_grant",
      amount: 5,
      promoRedemptionId: expect.any(String)
    }));
    expect(JSON.stringify(first.json())).not.toContain("CALLASSIST25");

    const overLimit = await app.inject({
      method: "POST",
      url: "/api/credits/promo-redemptions",
      headers: { cookie: userCookie },
      payload: { code: "CALLASSIST25", idempotencyKey: randomUUID() }
    });
    expect(overLimit.statusCode).toBe(409);
    expect(overLimit.json()).toEqual({ error: "PROMO_USER_LIMIT_REACHED" });
  });

  it("records idempotent administrator credit grants with actor and reason", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "grant-admin@example.com",
      phoneE164: "+41710000010"
    };
    const targetRegistration = {
      ...registration,
      email: "grant-target@example.com",
      phoneE164: "+41710000011"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const targetCookie = await registerAndVerify(app, targetRegistration);
    const admin = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    const adminId = admin.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");
    const idempotencyKey = randomUUID();
    const payload = {
      targetEmail: targetRegistration.email,
      credits: 4,
      reason: "Customer recovery adjustment",
      idempotencyKey
    };
    const grant = () => app.inject({
      method: "POST",
      url: "/api/admin/credit-grants",
      headers: { cookie: adminCookie },
      payload
    });
    const first = await grant();
    const replay = await grant();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ applied: true, usage: { balance: 7 } });
    expect(replay.json()).toMatchObject({ applied: false, usage: { balance: 7 } });

    const usage = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie: targetCookie }
    });
    expect(usage.json().transactions).toContainEqual(expect.objectContaining({
      type: "admin_grant",
      amount: 4,
      adminId,
      reason: payload.reason
    }));

    const selfGrant = await app.inject({
      method: "POST",
      url: "/api/admin/credit-grants",
      headers: { cookie: adminCookie },
      payload: { ...payload, targetEmail: adminRegistration.email, idempotencyKey: randomUUID() }
    });
    expect(selfGrant.statusCode).toBe(403);
    expect(selfGrant.json()).toEqual({ error: "CREDIT_SELF_GRANT_FORBIDDEN" });
  });

  it("lets administrators search eligible users and inspect their credit ledger", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "lookup-admin@example.com",
      phoneE164: "+41710000012"
    };
    const targetRegistration = {
      ...registration,
      email: "ledger-target@example.com",
      phoneE164: "+41710000013",
      firstName: "Ledger",
      lastName: "Target"
    };
    const staffRegistration = {
      ...registration,
      email: "hidden-support@example.com",
      phoneE164: "+41710000014"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const targetCookie = await registerAndVerify(app, targetRegistration);
    const staffCookie = await registerAndVerify(app, staffRegistration);
    const [admin, target, staff] = await Promise.all(
      [adminCookie, targetCookie, staffCookie].map((cookie) => app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie }
      }))
    );
    const adminId = admin.json().user.id as string;
    const targetId = target.json().user.id as string;
    const staffId = staff.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");
    await repository.setUserRoleForTest(staffId, "support");

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: targetCookie }
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/admin/users?limit=500",
      headers: { cookie: adminCookie }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "INVALID_ADMIN_USER_QUERY" });

    const found = await app.inject({
      method: "GET",
      url: "/api/admin/users?search=ledger-target&status=active",
      headers: { cookie: adminCookie }
    });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toBe("private, no-store");
    expect(found.json().items).toEqual([
      expect.objectContaining({
        id: targetId,
        email: targetRegistration.email,
        firstName: "Ledger",
        lastName: "Target",
        phoneVerified: true
      })
    ]);
    expect(found.json().items[0]).not.toHaveProperty("phoneE164");
    expect(found.json().items[0]).not.toHaveProperty("passwordHash");

    const ledger = await app.inject({
      method: "GET",
      url: `/api/admin/users/${targetId}/credits`,
      headers: { cookie: adminCookie }
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json()).toMatchObject({
      user: { id: targetId, email: targetRegistration.email },
      usage: { balance: 3 }
    });
    expect(ledger.json().usage.transactions).toContainEqual(
      expect.objectContaining({ type: "signup_grant", amount: 3 })
    );

    const hiddenStaff = await app.inject({
      method: "GET",
      url: `/api/admin/users/${staffId}/credits`,
      headers: { cookie: adminCookie }
    });
    expect(hiddenStaff.statusCode).toBe(404);
    expect(hiddenStaff.json()).toEqual({ error: "USER_NOT_FOUND" });

    await repository.setUserRoleForTest(adminId, "superadmin");
    const privileged = await app.inject({
      method: "GET",
      url: "/api/admin/users?role=support",
      headers: { cookie: adminCookie }
    });
    expect(privileged.statusCode).toBe(200);
    expect(privileged.json().items).toContainEqual(
      expect.objectContaining({ id: staffId, role: "support" })
    );
  });

  it("queues password-confirmed account deletion and revokes sessions after finalization", async () => {
    const { app, repository, accountDeletionService } = createAuthApp();
    const cookie = await registerAndVerify(app, registration);
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    const userId = me.json().user.id as string;

    const invalid = await app.inject({
      method: "POST",
      url: "/api/account/deletion",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: {
        requestId: randomUUID(),
        password: registration.password,
        confirmation: "DELETE"
      }
    });
    expect(invalid.statusCode).toBe(400);

    const requestId = randomUUID();
    const queued = await app.inject({
      method: "POST",
      url: "/api/account/deletion",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: {
        requestId,
        password: registration.password,
        confirmation: "DELETE MY ACCOUNT"
      }
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json().request).toMatchObject({
      requestId,
      status: "queued",
      attemptCount: 0
    });

    await accountDeletionService.runOnce();
    expect(await repository.findAccountDeletionByUser(userId)).toMatchObject({
      status: "completed",
      completedAt: expect.any(String)
    });
    expect(await repository.findUserByEmail(registration.email)).toBeNull();
    expect(repository.accountDeletionEventsForTest().map(({ eventType }) => eventType))
      .toEqual([
        "account_deletion.requested",
        "account_deletion.completed"
      ]);

    const signedOut = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(signedOut.statusCode).toBe(401);
  });

  it("delays account deletion for active calls and blocks new call mutations", async () => {
    const { app, repository, accountDeletionService } = createAuthApp();
    const input = {
      ...registration,
      email: "active-deletion@example.com",
      phoneE164: "+41710000021"
    };
    const cookie = await registerAndVerify(app, input);
    const created = await createPreparedCall(app, cookie);
    expect(created.statusCode).toBe(201);
    const started = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${created.json().id}/approve-and-start`,
      headers: { cookie, origin: "http://localhost:3000" }
    });
    expect(started.statusCode).toBe(200);

    const queued = await app.inject({
      method: "POST",
      url: "/api/account/deletion",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: {
        requestId: randomUUID(),
        password: input.password,
        confirmation: "DELETE MY ACCOUNT"
      }
    });
    expect(queued.statusCode).toBe(202);

    const blockedMutation = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      headers: {
        cookie,
        origin: "http://localhost:3000",
        "idempotency-key": randomUUID()
      },
      payload: callBrief
    });
    expect(blockedMutation.statusCode).toBe(409);
    expect(blockedMutation.json()).toEqual({ error: "ACCOUNT_DELETION_PENDING" });

    await accountDeletionService.runOnce();
    const user = await repository.findUserByEmail(input.email);
    expect(user).not.toBeNull();
    expect(await repository.findAccountDeletionByUser(user!.id)).toMatchObject({
      status: "waiting_for_calls",
      attemptCount: 0,
      lastErrorCode: "ACTIVE_CALL_IN_PROGRESS"
    });
  });

  it("exposes exhausted deletion to admins and records a reasoned recovery generation", async () => {
    const { app, repository } = createAuthApp();
    const adminInput = {
      ...registration,
      email: "deletion-admin@example.com",
      phoneE164: "+41710000022"
    };
    const targetInput = {
      ...registration,
      email: "deletion-target@example.com",
      phoneE164: "+41710000023"
    };
    const adminCookie = await registerAndVerify(app, adminInput);
    const targetCookie = await registerAndVerify(app, targetInput);
    const adminId = (await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    })).json().user.id as string;
    const targetId = (await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: targetCookie }
    })).json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");
    const requestId = randomUUID();
    await repository.requestAccountDeletion({
      requestId,
      userId: targetId,
      now: "2026-08-23T10:00:00.000Z",
      maxAttempts: 5
    });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const now = `2026-08-23T10:0${attempt}:00.000Z`;
      const claimed = await repository.claimAccountDeletion({
        workerId: "test-worker",
        now,
        leaseExpiresAt: `2026-08-23T10:0${attempt}:30.000Z`
      });
      expect(claimed?.attemptCount).toBe(attempt);
      await repository.failAccountDeletion({
        requestId,
        workerId: "test-worker",
        now,
        retryAt: `2026-08-23T10:0${attempt + 1}:00.000Z`,
        errorCode: "PROVIDER_RECORDING_DELETE_FAILED"
      });
    }
    expect(await repository.findAccountDeletionByUser(targetId)).toMatchObject({
      status: "needs_support",
      attemptCount: 5
    });

    const ledger = await app.inject({
      method: "GET",
      url: `/api/admin/users/${targetId}/credits`,
      headers: { cookie: adminCookie }
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().accountDeletion).toMatchObject({
      requestId,
      status: "needs_support"
    });

    const retried = await app.inject({
      method: "POST",
      url: `/api/admin/users/${targetId}/account-deletion/${requestId}/retry`,
      headers: { cookie: adminCookie, origin: "http://localhost:3000" },
      payload: { reason: "Provider incident resolved in support ticket 123" }
    });
    expect(retried.statusCode).toBe(202);
    expect(await repository.findAccountDeletionByUser(targetId)).toMatchObject({
      status: "queued",
      generation: 2,
      attemptCount: 0,
      lastErrorCode: null
    });
    expect(repository.accountDeletionEventsForTest()).toContainEqual(
      expect.objectContaining({
        eventType: "account_deletion.retry_requested",
        actorUserId: adminId,
        reason: "Provider incident resolved in support ticket 123"
      })
    );
  });
});

function promoCreation(code: string) {
  return {
    code,
    credits: 5,
    globalRedemptionLimit: 10,
    perUserLimit: 1,
    startsAt: null,
    expiresAt: null,
    active: true,
    campaign: "Beta launch",
    reason: "Approved beta campaign",
    idempotencyKey: randomUUID()
  };
}
