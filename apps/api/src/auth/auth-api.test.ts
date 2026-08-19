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
  const authService = new AuthService({
    repository,
    verificationProvider: new MockVerificationProvider("123456")
  });
  const app = buildApp({
    service: new CallService(new InMemoryCallRepository()),
    authService,
    logger: false,
    secureCookies: false
  });
  apps.push(app);
  return { app, repository };
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
});
