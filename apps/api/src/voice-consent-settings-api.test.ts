import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { voiceConsentSettingsViewSchema, type UserRole } from "@callassist/contracts";
import { buildApp } from "./app";
import { AuthService } from "./auth/auth-service";
import { InMemoryAuthRepository } from "./auth/in-memory-auth-repository";
import { hashPassword } from "./auth/password";
import { MockVerificationProvider } from "./auth/verification-provider";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import { VoiceConsentPolicyError } from "./storage/voice-consent-policy-store";

const url = "/api/admin/system/voice-consent";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const auth = new InMemoryAuthRepository();
  const user = await auth.createUser({ email: `${randomUUID()}@example.com`, passwordHash: await hashPassword("consent-settings-password"),
    phoneE164: "+41710000991", firstName: "Consent", lastName: "Admin", uiLocale: "en" });
  await auth.markPhoneVerified(user.id, new Date().toISOString());
  await auth.setUserRoleForTest(user.id, "admin");
  const repository = new InMemoryCallRepository();
  const service = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  const authService = new AuthService({ repository: auth, verificationProvider: new MockVerificationProvider(), signupCreditGranter: service });
  const app = buildApp({ service, authService, logger: false, secureCookies: false });
  cleanup.push(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.email, password: "consent-settings-password" } });
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers["set-cookie"]);
  const input = { mode: "hybrid_deterministic_v1", expectedRevision: 1, reason: "Approved latency pilot" };
  return { auth, user, repository, service, app, cookie, input };
}

it("allows staff reads but protects consent changes with superadmin and origin checks", async () => {
  const f = await fixture();
  const writes = vi.spyOn(f.service, "updateVoiceConsentSettings");
  expect((await f.app.inject({ method: "GET", url })).statusCode).toBe(401);
  expect((await f.app.inject({ method: "PUT", url, payload: f.input })).statusCode).toBe(401);
  for (const role of ["user", "support", "content_editor"] as UserRole[]) {
    await f.auth.setUserRoleForTest(f.user.id, role);
    expect((await f.app.inject({ method: "GET", url, headers: { cookie: f.cookie } })).statusCode).toBe(403);
    expect((await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie }, payload: f.input })).statusCode).toBe(403);
  }
  await f.auth.setUserRoleForTest(f.user.id, "admin");
  const read = await f.app.inject({ method: "GET", url, headers: { cookie: f.cookie } });
  expect(read.statusCode).toBe(200);
  expect(read.headers["cache-control"]).toBe("private, no-store");
  expect(voiceConsentSettingsViewSchema.parse(read.json()).policy.mode).toBe("semantic_native");
  expect((await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie }, payload: f.input })).statusCode).toBe(403);
  await f.auth.setUserRoleForTest(f.user.id, "superadmin");
  expect((await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie, origin: "https://untrusted.example" }, payload: f.input })).statusCode).toBe(403);
  expect(writes).not.toHaveBeenCalled();
});

it("revision-checks a saved selection and restores native mode through the same audited action", async () => {
  const f = await fixture();
  await f.auth.setUserRoleForTest(f.user.id, "superadmin");
  const write = vi.spyOn(f.repository, "updateVoiceConsentSettings");
  const result = await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie }, payload: f.input });
  expect(result.statusCode).toBe(200);
  expect(result.headers["cache-control"]).toBe("private, no-store");
  expect(voiceConsentSettingsViewSchema.parse(result.json())).toMatchObject({ policy: { mode: "hybrid_deterministic_v1", revision: 2 },
    updatedByUserId: f.user.id, reason: f.input.reason, updatedAt: expect.any(String) });
  expect(write).toHaveBeenCalledWith(f.input, f.user.id);
  const stale = await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie }, payload: f.input });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: "VOICE_CONSENT_REVISION_CONFLICT" });
  expect((await f.service.getVoiceConsentSettings()).policy.revision).toBe(2);
  const rollback = await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie }, payload: {
    mode: "semantic_native", expectedRevision: 2, reason: "Return new attempts to native recognition"
  } });
  expect(rollback.statusCode).toBe(200);
  expect(rollback.json()).toMatchObject({ policy: { mode: "semantic_native", revision: 3 } });
});

it("rejects unsupported policy controls and preserves transactional permission failures", async () => {
  const f = await fixture();
  await f.auth.setUserRoleForTest(f.user.id, "superadmin");
  const writes = vi.spyOn(f.service, "updateVoiceConsentSettings");
  for (const change of [{ mode: "legacy_hybrid" }, { expectedRevision: 0 }, { reason: "  " }, { fastSettleMs: 0 }]) {
    const response = await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie }, payload: { ...f.input, ...change } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_VOICE_CONSENT_SETTINGS" });
  }
  expect(writes).not.toHaveBeenCalled();
  writes.mockRejectedValueOnce(new VoiceConsentPolicyError("VOICE_CONSENT_FORBIDDEN"));
  const forbidden = await f.app.inject({ method: "PUT", url, headers: { cookie: f.cookie }, payload: f.input });
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.json()).toEqual({ error: "VOICE_CONSENT_FORBIDDEN" });
  expect((await f.service.getVoiceConsentSettings()).policy.mode).toBe("semantic_native");
});
