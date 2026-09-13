import "./config/load-env";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { adminOutboundCallControlViewSchema, adminSystemViewSchema, type UserRole } from "@callassist/contracts";
import { buildApp } from "./app";
import { AuthService } from "./auth/auth-service";
import { InMemoryAuthRepository } from "./auth/in-memory-auth-repository";
import { hashPassword } from "./auth/password";
import { MockVerificationProvider } from "./auth/verification-provider";
import { CallService } from "./call-service";
import { isolatedTestDatabase } from "./db/isolated-test-database";
import type { CallRepository } from "./storage/call-repository";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import { PostgresCallRepository } from "./storage/postgres-call-repository";
import { originalPlanReview } from "./test-helpers/original-plan-review";

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
});

const input = {
  recipientName: "System regression fixture",
  phoneNumber: "+41710000999",
  objective: "Ask which documents are needed for a repair estimate.",
  assistantProfileId: "sebastian" as const,
  representedPersonFirstName: "Audit",
  representedPersonLastName: "User",
  locale: "en-GB" as const,
  allowedFacts: []
};

async function fixture(driver: "memory" | "postgres") {
  const authRepository = new InMemoryAuthRepository();
  const user = await authRepository.createUser({
    email: `${randomUUID()}@example.com`,
    passwordHash: await hashPassword("system-regression-password"),
    phoneE164: "+41710000991", firstName: "Audit", lastName: "Admin", uiLocale: "en"
  });
  await authRepository.markPhoneVerified(user.id, new Date().toISOString());
  await authRepository.setUserRoleForTest(user.id, "admin");
  let repository: CallRepository;
  if (driver === "postgres") {
    const database = isolatedTestDatabase();
    closers.push(() => database.teardown());
    await database.setup();
    const sql = postgres(database.url, { max: 1 });
    closers.push(() => sql.end());
    await sql`
      INSERT INTO users (id, email, password_hash, phone_e164, phone_verified_at,
        first_name, last_name, role, status, ui_locale, created_at)
      VALUES (${user.id}, ${user.email}, 'fixture-only', ${user.phoneE164}, now(),
        'Audit', 'Admin', 'admin', 'active', 'en', now())
    `;
    repository = new PostgresCallRepository(database.url, Buffer.alloc(32, 9));
  } else {
    repository = new InMemoryCallRepository();
  }
  const service = new CallService(repository, undefined, undefined, undefined,
    undefined, undefined, undefined, { durableWorkerEnabled: false });
  const authService = new AuthService({
    repository: authRepository, verificationProvider: new MockVerificationProvider(),
    signupCreditGranter: service
  });
  const app = buildApp({ service, authService, logger: false, secureCookies: false });
  closers.push(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: {
    email: user.email, password: "system-regression-password"
  } });
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers["set-cookie"]);
  return { repository, service, authRepository, app, user, cookie };
}

describe.each(["memory", "postgres"] as const)("admin system through %s storage", (driver) => {
  it("returns a strict, minimized system view with queued brief and running/failed text jobs", async () => {
    const { repository, service, app, user, cookie } = await fixture(driver);
    const preparation = await service.prepare(input, user.id);
    const call = await service.create(input, user.id);
    const source = await repository.getPlanSource(call.id);
    await service.textArtifacts.requestPlanReview(call.id, { ...source, targetLanguage: "ru" });
    const now = new Date(Date.now() + 1000).toISOString();
    const workerId = randomUUID();
    const claim = () => repository.claimDueDurableJob({
      types: ["text_artifact_generation"], workerId, now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString()
    });
    const failed = await claim();
    expect(failed?.textArtifactId).toBeTruthy();
    await repository.failDurableJob(failed!.id, workerId, "PROVIDER_UNAVAILABLE", now, now, false);
    await service.textArtifacts.requestPlanReview(call.id, { ...source, targetLanguage: "uk" });
    const running = await claim();
    expect(running?.status).toBe("running");

    const response = await app.inject({ method: "GET", url: "/api/admin/system", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const view = adminSystemViewSchema.parse(response.json());
    expect(view.jobs.recent).toHaveLength(3);
    expect(view.jobs.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "brief_compilation", status: "queued", callPreparationId: preparation.id }),
      expect.objectContaining({ id: failed!.id, type: "text_artifact_generation", status: "dead_letter", lastErrorCode: "PROVIDER_UNAVAILABLE" }),
      expect.objectContaining({ id: running!.id, type: "text_artifact_generation", status: "running", callId: call.id })
    ]));
    for (const job of view.jobs.recent) {
      for (const key of ["textArtifactId", "recordingId", "callAttemptId", "leaseOwner", "forceRequested"]) {
        expect(job).not.toHaveProperty(key);
      }
    }
  }, 30_000);

  it("keeps reasoned, audited stop and role-protected resume independent of broken diagnostics", async () => {
    const { repository, service, authRepository, app, user, cookie } = await fixture(driver);
    const call = await service.create(input, user.id);
    await repository.grantSignupCredits(user.id);
    await service.approveCompilation(call.id, await originalPlanReview(service, call.id));
    vi.spyOn(repository, "getAdminSystemFacts").mockRejectedValue(new Error("DIAGNOSTICS_UNAVAILABLE"));
    expect((await app.inject({ method: "GET", url: "/api/admin/system", headers: { cookie } })).statusCode).toBe(500);
    const url = "/api/admin/system/outbound-calls";
    const read = await app.inject({ method: "GET", url, headers: { cookie } });
    expect(read.statusCode).toBe(200);
    expect(adminOutboundCallControlViewSchema.parse(read.json()).outboundCalls.enabled).toBe(true);
    expect(read.headers["cache-control"]).toBe("private, no-store");

    // Even a failed control read must not make the explicit stop depend on it.
    const controlRead = vi.spyOn(repository, "getOutboundCallControl").mockRejectedValue(new Error("READ_UNAVAILABLE"));
    expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(500);
    const stop = await app.inject({ method: "PUT", url, headers: { cookie }, payload: {
      enabled: false, reason: "Investigating a provider incident"
    } });
    expect(stop.statusCode).toBe(200);
    expect(adminOutboundCallControlViewSchema.parse(stop.json()).outboundCalls).toMatchObject({
      enabled: false, reason: "Investigating a provider incident", updatedAt: expect.any(String)
    });
    expect(stop.headers["cache-control"]).toBe("private, no-store");
    controlRead.mockRestore();
    await expect(service.start(call.id, user.id)).rejects.toMatchObject({ code: "OUTBOUND_CALLS_DISABLED" });
    const audit = vi.spyOn(repository, "setOutboundCallsEnabled");
    expect((await app.inject({ method: "PUT", url, headers: { cookie }, payload: { enabled: true, reason: "Incident resolved" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url, headers: { cookie }, payload: { enabled: false, reason: "x" } })).statusCode).toBe(400);
    expect(audit).not.toHaveBeenCalled();

    await authRepository.setUserRoleForTest(user.id, "superadmin");
    const resume = await app.inject({ method: "PUT", url, headers: { cookie }, payload: { enabled: true, reason: "Incident resolved" } });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ outboundCalls: { enabled: true } });
    expect(audit).toHaveBeenCalledWith(true, { actorUserId: user.id, reason: "Incident resolved" });

    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    for (const role of ["user", "support", "content_editor"] as UserRole[]) {
      await authRepository.setUserRoleForTest(user.id, role);
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url, headers: { cookie }, payload: { enabled: false, reason: "Forbidden stop" } })).statusCode).toBe(403);
    }
  }, 30_000);
});
