import { afterEach, expect, it, vi } from "vitest";
import { defaultAnalyticsSettings, type AnalyticsSettings, type UserRole } from "@callassist/contracts";
import { buildApp } from "./app";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import { InMemoryAuthRepository } from "./auth/in-memory-auth-repository";
import { AuthService } from "./auth/auth-service";
import { MockVerificationProvider } from "./auth/verification-provider";
import { CallService } from "./call-service";
import { hashPassword } from "./auth/password";
import { BetaControlError } from "./beta/beta-controls";

afterEach(() => vi.restoreAllMocks());
it("protects analytics settings, validates writes, rejects stale updates and exposes only public configuration", async () => {
  const auth = new InMemoryAuthRepository();
  const user = await auth.createUser({ email: "analytics@example.test", passwordHash: await hashPassword("analytics-test-password"), phoneE164: "+41710000191", firstName: "Analytics", lastName: "Test", uiLocale: "fr" });
  await auth.markPhoneVerified(user.id, new Date().toISOString());
  let settings: AnalyticsSettings = { ...defaultAnalyticsSettings }; let revision = 1;
  const repository = new InMemoryCallRepository();
  Object.assign(repository, { betaControls: {
    getAnalytics: async () => ({ settings, revision }),
    updateAnalytics: vi.fn(async (next: AnalyticsSettings, expected: number) => {
      if (expected !== revision) throw new BetaControlError("BETA_SETTINGS_STALE");
      settings = next; revision++;
    })
  } });
  const service = new CallService(repository);
  const app = buildApp({ service, authService: new AuthService({ repository: auth, verificationProvider: new MockVerificationProvider(), signupCreditGranter: service }), logger: false, secureCookies: false });
  try {
    expect((await app.inject({ method: "GET", url: "/api/analytics" })).json()).toEqual(defaultAnalyticsSettings);
    const url = "/api/admin/system/analytics";
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.email, password: "analytics-test-password" } });
    expect(login.statusCode).toBe(200);
    const headers = { cookie: String(login.headers["set-cookie"]), origin: "http://localhost:3000" };
    for (const role of ["user", "support", "content_editor"] as UserRole[]) {
      await auth.setUserRoleForTest(user.id, role);
      expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url, headers, payload: { settings, expectedRevision: revision } })).statusCode).toBe(403);
    }
    for (const role of ["admin", "superadmin"] as UserRole[]) {
      await auth.setUserRoleForTest(user.id, role);
      expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "PUT", url, headers, payload: { settings: { enabled: true, measurementId: "invalid" }, expectedRevision: revision } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url, headers, payload: { settings: { enabled: true, measurementId: "G-TEST1234" }, expectedRevision: revision } })).statusCode).toBe(200);
    }
    const stale = await app.inject({ method: "PUT", url, headers, payload: { settings, expectedRevision: 1 } });
    expect(stale.statusCode).toBe(409);
    const publicView = await app.inject({ method: "GET", url: "/api/analytics" });
    expect(publicView.headers["cache-control"]).toBe("no-store");
    expect(publicView.json()).toEqual({ enabled: true, measurementId: "G-TEST1234" });
  } finally { await app.close(); }
});
