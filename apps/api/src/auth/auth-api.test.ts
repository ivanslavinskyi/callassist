import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { AuthService } from "./auth-service";
import { InMemoryAuthRepository } from "./in-memory-auth-repository";
import { MockVerificationProvider } from "./verification-provider";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createAuthApp() {
  const repository = new InMemoryAuthRepository();
  const callRepository = new InMemoryCallRepository();
  const callService = new CallService(callRepository);
  const authService = new AuthService({
    repository,
    verificationProvider: new MockVerificationProvider("123456"),
    signupCreditGranter: callService
  });
  const app = buildApp({
    service: callService,
    authService,
    logger: false,
    secureCookies: false
  });
  apps.push(app);
  return { app, repository, callRepository };
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
};

describe("auth API", () => {
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

  it("requires a session and hides every call resource from other users", async () => {
    const { app } = createAuthApp();
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
    const anonymousUsage = await app.inject({ method: "GET", url: "/api/usage" });
    expect(anonymousUsage.statusCode).toBe(401);

    const invalidOrigin = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie: userACookie, origin: "https://attacker.example" },
      payload: callBrief
    });
    expect(invalidOrigin.statusCode).toBe(403);
    expect(invalidOrigin.json()).toEqual({ error: "INVALID_ORIGIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie: userACookie },
      payload: callBrief
    });
    expect(created.statusCode).toBe(201);
    const callId = created.json<{ id: string }>().id;

    const [userAList, userBList] = await Promise.all([
      app.inject({ method: "GET", url: "/api/call-briefs", headers: { cookie: userACookie } }),
      app.inject({ method: "GET", url: "/api/call-briefs", headers: { cookie: userBCookie } })
    ]);
    expect(userAList.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(userBList.json<{ items: unknown[] }>().items).toHaveLength(0);

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
    const created = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie },
      payload: callBrief
    });
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
});
