import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { InMemoryAuthRepository } from "../auth/in-memory-auth-repository";
import { AuthService } from "../auth/auth-service";
import { MockVerificationProvider } from "../auth/verification-provider";
import { PlanReviewError, emptyPlanReviewSummary, type PlanReviewAdmin } from "./plan-review-service";
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const caseId = "11111111-1111-4111-8111-111111111111", base = "/api/admin/safety/plan-reviews";
async function fixture() {
  const repository = new InMemoryAuthRepository(), calls = new CallService(new InMemoryCallRepository());
  const authService = new AuthService({ repository, verificationProvider: new MockVerificationProvider("123456"), signupCreditGranter: calls });
  const reviews = { list: vi.fn(async () => ({ available: true, items: [], nextCursor: null, summary: emptyPlanReviewSummary })),
    get: vi.fn(async () => ({ fixture: "safe metadata" })), evidence: vi.fn(async () => ({ fixture: "sensitive" })),
    update: vi.fn(async () => undefined), retryEmail: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  const app = buildApp({ service: calls, authService, planReviews: reviews as unknown as PlanReviewAdmin, logger: false, secureCookies: false, webOrigin: "http://localhost:3000" }); apps.push(app);
  const email = "plan-review-admin@example.test";
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "fixture-password-2026", phoneE164: "+41790000017", firstName: "QA", lastName: "Example", uiLocale: "en" } });
  const verified = await app.inject({ method: "POST", url: "/api/auth/verify-phone", payload: { email, code: "123456" } });
  expect(verified.statusCode).toBe(200);
  return { app, repository, reviews, actor: verified.json().user.id as string, cookie: String(verified.headers["set-cookie"]) };
}
describe("plan review API boundaries", () => {
  it("allows safe metadata to operators only and sensitive evidence only to superadmin", async () => {
    const f = await fixture();
    expect((await f.app.inject({ method: "GET", url: base })).statusCode).toBe(401);
    for (const role of ["user", "support", "content_editor", "admin", "superadmin"] as const) {
      await f.repository.setUserRoleForTest(f.actor, role);
      const read = await f.app.inject({ method: "GET", url: base, headers: { cookie: f.cookie } });
      expect(read.statusCode).toBe(["admin", "superadmin"].includes(role) ? 200 : 403);
      const evidence = await f.app.inject({ method: "POST", url: `${base}/${caseId}/sensitive-access`, headers: { cookie: f.cookie, origin: "http://localhost:3000" }, payload: { reason: "Investigate this revision" } });
      expect(evidence.statusCode).toBe(role === "superadmin" ? 200 : 403);
      expect(evidence.headers["cache-control"]).toBe("private, no-store");
    }
    expect(f.reviews.evidence).toHaveBeenCalledTimes(1);
    expect(f.reviews.evidence).toHaveBeenCalledWith(caseId, f.actor, "Investigate this revision");
  });
  it("validates filters and mutation bodies, rejects cross-origin requests, returns revision conflict", async () => {
    const f = await fixture(); await f.repository.setUserRoleForTest(f.actor, "superadmin");
    const headers = { cookie: f.cookie, origin: "http://localhost:3000" };
    expect((await f.app.inject({ method: "GET", url: `${base}?userId=not-a-uuid`, headers })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "GET", url: `${base}?limit=1000`, headers })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url: `${base}/${caseId}/sensitive-access`, headers: { ...headers, origin: "https://evil.example" }, payload: { reason: "Investigate case" } })).statusCode).toBe(403);
    const payload = { expectedRevision: 1, status: "resolved", resolution: "false_positive", assigneeId: null, note: "Review notes", reason: "Review complete" };
    expect((await f.app.inject({ method: "PATCH", url: `${base}/${caseId}`, headers, payload: { ...payload, resolution: null } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "PATCH", url: `${base}/${caseId}`, headers, payload })).statusCode).toBe(200);
    expect(f.reviews.update).toHaveBeenCalledWith(caseId, f.actor, payload);
    f.reviews.update.mockRejectedValueOnce(new PlanReviewError("PLAN_REVIEW_STALE"));
    const stale = await f.app.inject({ method: "PATCH", url: `${base}/${caseId}`, headers, payload });
    expect(stale.statusCode).toBe(409); expect(stale.json()).toEqual({ error: "PLAN_REVIEW_STALE" });
    const retry = await f.app.inject({ method: "POST", url: `${base}/${caseId}/emails/${caseId}/retry`, headers, payload: { reason: "Manual recovery after failure" } });
    expect(retry.statusCode).toBe(200); expect(f.reviews.retryEmail).toHaveBeenCalledWith(caseId, caseId, f.actor, "Manual recovery after failure");
  });
});
