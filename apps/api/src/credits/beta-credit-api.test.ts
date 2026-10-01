import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { InMemoryAuthRepository } from "../auth/in-memory-auth-repository";
import { AuthService } from "../auth/auth-service";
import { MockVerificationProvider } from "../auth/verification-provider";
import { BetaControlError } from "../beta/beta-controls";
import { defaultRegistrationPolicy, defaultBetaSettings } from "@callassist/contracts";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const policy = { amount: 2, period: "week" as const };
const preview = { policyId: "96000000-0000-4000-8000-000000000001", revision: 1, policy, previewToken: "a".repeat(64), accounts: 1, immediate: 1, atNextBoundary: 0, persistentCredits: 3, activeReservations: 0 };
const transition = { policyId: preview.policyId, expectedRevision: 1, previewToken: preview.previewToken, reason: "Reviewed cohort" };
async function fixture() {
  const repository = new InMemoryAuthRepository(), callRepository = new InMemoryCallRepository(), service = new CallService(callRepository);
  const controls = { getRegistrationPolicy: vi.fn(async () => defaultRegistrationPolicy), getPublicRegistration: vi.fn(async () => ({ state: "full", remaining: null, allowance: policy, timeZone: "UTC" })),
    update: vi.fn(async () => {}), updateCreditPolicy: vi.fn(async () => {}), previewCreditTransition: vi.fn(async () => preview), applyCreditTransition: vi.fn(async () => ({ updated: 1 })) };
  Object.assign(callRepository, { betaControls: controls });
  const authService = new AuthService({ repository, verificationProvider: new MockVerificationProvider("123456"), signupCreditGranter: service });
  const app = buildApp({ service, authService, logger: false, secureCookies: false, webOrigin: "http://localhost:3000" }); apps.push(app);
  const email = "credit-admin@example.test";
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "fixture-password-2026", phoneE164: "+41790000011", firstName: "Nina", lastName: "Example", uiLocale: "en" } });
  const verified = await app.inject({ method: "POST", url: "/api/auth/verify-phone", payload: { email, code: "123456" } });
  expect(verified.statusCode).toBe(200);
  return { app, controls, repository, id: verified.json().user.id as string, cookie: String(verified.headers["set-cookie"]) };
}
describe("beta credit API", () => {
  it("requires a superadmin for policy updates, cohort previews and application", async () => {
    const f = await fixture();
    for (const [method, url, payload] of [["PUT", "/api/admin/system/beta/credit-policy", { policy, expectedRevision: 1, reason: "New default policy" }],
      ["GET", "/api/admin/system/beta/credits/preview", undefined], ["POST", "/api/admin/system/beta/credits/apply", transition]] as const) {
      expect((await f.app.inject({ method, url, payload })).statusCode).toBe(401);
      for (const role of ["user", "support", "content_editor", "admin"] as const) {
        await f.repository.setUserRoleForTest(f.id, role);
        expect((await f.app.inject({ method, url, payload, headers: { cookie: f.cookie, origin: "http://localhost:3000" } })).statusCode).toBe(403);
      }
    }
    expect(f.controls.applyCreditTransition).not.toHaveBeenCalled();
    expect(f.controls.updateCreditPolicy).not.toHaveBeenCalled();
    expect(f.controls.previewCreditTransition).not.toHaveBeenCalled();
  });
  it("protects writes from foreign origins, validates bounded quantities and surfaces stale preview conflicts", async () => {
    const f = await fixture(); await f.repository.setUserRoleForTest(f.id, "superadmin");
    const headers = { cookie: f.cookie, origin: "http://localhost:3000" }, url = "/api/admin/system/beta/credit-policy";
    expect((await f.app.inject({ method: "PUT", url, headers: { ...headers, origin: "https://other.example" }, payload: { policy, expectedRevision: 1, reason: "New default policy" } })).statusCode).toBe(403);
    expect((await f.app.inject({ method: "PUT", url, headers, payload: { policy: { amount: 101, period: "week" }, expectedRevision: 1, reason: "Invalid amount" } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "PUT", url, headers, payload: { policy, expectedRevision: 1, reason: "New default policy" } })).statusCode).toBe(200);
    const read = await f.app.inject({ url: "/api/admin/system/beta/credits/preview", headers });
    expect(read.json()).toEqual(preview); expect(read.headers["cache-control"]).toBe("private, no-store");
    f.controls.applyCreditTransition.mockRejectedValueOnce(new BetaControlError("BETA_SETTINGS_STALE"));
    expect((await f.app.inject({ method: "POST", url: "/api/admin/system/beta/credits/apply", headers, payload: transition })).statusCode).toBe(409);
  });
  it("publishes policy in every registration locale without exposing hidden counter operands", async () => {
    const f = await fixture();
    for (const locale of ["en", "de", "fr", "it", "rm", "ru", "uk"]) {
      const result = await f.app.inject(`/api/auth/registration-options?locale=${locale}`);
      expect(result.statusCode).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.json().beta).toEqual({ state: "full", remaining: null, allowance: policy, timeZone: "UTC" });
      expect(result.body).not.toMatch(/publicAccountLimit|publicAccounts|invitedAccounts/);
    }
  });
  it("preserves omitted registration visibility across API parsing while accepting explicit values", async () => {
    const f = await fixture(); await f.repository.setUserRoleForTest(f.id, "superadmin");
    const { showRegistrationRemaining: _visibility, ...legacySettings } = defaultBetaSettings;
    const headers = { cookie: f.cookie, origin: "http://localhost:3000" };
    for (const visibility of [undefined, true, false]) {
      const settings = visibility === undefined ? legacySettings : { ...legacySettings, showRegistrationRemaining: visibility };
      const response = await f.app.inject({ method: "PUT", url: "/api/admin/system/beta", headers,
        payload: { settings, expectedRevision: 1, reason: "Update only admission budget" } });
      expect(response.statusCode).toBe(200);
      expect(f.controls.update).toHaveBeenLastCalledWith(settings, 1, f.id, "Update only admission budget");
    }
  });
});
