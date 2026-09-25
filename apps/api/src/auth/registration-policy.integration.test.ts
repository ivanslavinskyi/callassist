import "../config/load-env";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { defaultBetaSettings, type RegistrationPolicy, uiLocales } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresAuthRepository } from "./postgres-auth-repository";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { PostgresContentRepository } from "../content/postgres-content-repository";
import { ContentService } from "../content/content-service";
import { CallService } from "../call-service";
import { AuthService } from "./auth-service";
import { MockVerificationProvider } from "./verification-provider";
import { BoundedVerificationProvider } from "./bounded-verification-provider";
import { ApplicationRateLimiter } from "./rate-limiter";
import { buildApp } from "../app";

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });

async function fixture(policy: RegistrationPolicy) {
  const db = isolatedTestDatabase(); closers.push(() => db.teardown()); await db.setup();
  const sql = postgres(db.url, { max: 3 }); closers.push(() => sql.end());
  const authRepository = new PostgresAuthRepository(db.url, true); closers.push(() => authRepository.close());
  const repository = new PostgresCallRepository(db.url, Buffer.alloc(32, 9), true);
  const service = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  const content = new ContentService(new PostgresContentRepository(db.url)); closers.push(() => content.repository.close()); await content.initialize();
  const sms = new MockVerificationProvider("123456");
  const auth = new AuthService({ repository: authRepository, signupCreditGranter: service,
    verificationProvider: new BoundedVerificationProvider(sms, new ApplicationRateLimiter(), { countries: ["CH", "UA"], daily: 100, perMinute: 100 }) });
  await sql`UPDATE beta_controls SET settings=${sql.json({ ...defaultBetaSettings, registration: policy, rollingDayBudgetMicros: 100_000_000 })} WHERE id=true`;
  const app = buildApp({ service, authService: auth, contentService: content, logger: false, secureCookies: false }); closers.push(() => app.close());
  const input = { email: `${randomUUID()}@example.com`, password: "registration-test-password", phoneE164: "+41790000001", firstName: "Test", lastName: "Owner", uiLocale: "en" as const };
  const docs = (await content.getRegistrationDocuments("en"))!;
  const acceptance = { locale: docs.terms.locale, termsRevisionId: docs.terms.id, acceptableUseRevisionId: docs.acceptableUse.id,
    privacyRevisionId: docs.privacy.id, privacyLocale: docs.privacy.locale,
    acceptTerms: true, acceptAcceptableUse: true, acknowledgeConsent: true, acknowledgeRetention: true, acknowledgeUseLimits: true, acknowledgeCredits: true };
  return { app, sql, input, acceptance, sms, content, authRepository, repository };
}

describe("registration policies and email deferral", () => {
  it.each([
    ["full", "required"], ["full", "deferrable"], ["registration", "required"], ["registration", "deferrable"]
  ] as const)("supports %s onboarding with %s email verification", async (onboarding, emailVerification) => {
    const f = await fixture({ onboarding, emailVerification });
    const registered = await f.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...f.input, ...(onboarding === "registration" ? { legalAcceptance: f.acceptance } : {}) } });
    expect(registered.statusCode).toBe(202);
    const verified = await f.app.inject({ method: "POST", url: "/api/auth/verify-phone", payload: { email: f.input.email, code: "123456" } });
    expect(verified.statusCode).toBe(200);
    const cookie = String(verified.headers["set-cookie"]);
    const user = verified.json().user;
    expect(user.emailVerifiedAt).toBeNull();
    expect((await f.content.getOnboardingStatus(user.id, "en")).required).toBe(onboarding === "full");
    if (emailVerification === "required") {
      expect((await f.app.inject({ method: "POST", url: "/api/auth/email-verification/defer", headers: { cookie } })).statusCode).toBe(403);
      await f.sql`UPDATE beta_controls SET settings=jsonb_set(settings,'{registration,emailVerification}','"deferrable"') WHERE id=true`;
    }
    const deferred = await f.app.inject({ method: "POST", url: "/api/auth/email-verification/defer", headers: { cookie } });
    expect(deferred.statusCode).toBe(200);
    expect(deferred.json().user.emailVerifiedAt).toBeNull();
    expect(deferred.json().user.emailVerificationDeferredAt).toEqual(expect.any(String));
    const login = await f.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: f.input.email, password: f.input.password } });
    expect(login.json().user.emailVerificationDeferredAt).toBe(deferred.json().user.emailVerificationDeferredAt);
    await f.sql`UPDATE beta_controls SET settings=jsonb_set(settings,'{registration,emailVerification}','"required"') WHERE id=true`;
    expect((await f.app.inject({ method: "POST", url: "/api/auth/email-verification/defer", headers: { cookie } })).statusCode).toBe(403);
    await f.sql`UPDATE users SET email='changed@example.com' WHERE id=${user.id}`;
    expect((await f.authRepository.findUserByEmail("changed@example.com"))?.emailVerificationDeferredAt).toBeNull();
  });

  it("rolls back account admission for missing or stale documents, then records all three versions", async () => {
    const f = await fixture({ onboarding: "registration", emailVerification: "required" });
    for (const legalAcceptance of [undefined, { ...f.acceptance, privacyRevisionId: randomUUID() }]) {
      const result = await f.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...f.input, legalAcceptance } });
      expect(result.statusCode).toBe(409);
      expect(await f.authRepository.findUserByEmail(f.input.email)).toBeNull();
      expect(f.sms.requests).toHaveLength(0);
      expect((await f.sql`SELECT public_accounts FROM beta_controls`)[0]!.public_accounts).toBe(0);
    }
    const good = await f.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...f.input, legalAcceptance: f.acceptance } });
    expect(good.statusCode).toBe(202);
    const user = (await f.authRepository.findUserByEmail(f.input.email))!;
    expect(await f.content.repository.listOnboardingAcceptances(user.id)).toMatchObject([{ privacyRevisionId: f.acceptance.privacyRevisionId, privacyLocale: f.acceptance.privacyLocale }]);
    expect(f.sms.requests).toHaveLength(1);
  });

  it("serves safe options for all locales and rejects invalid/disallowed numbers before account creation", async () => {
    const f = await fixture({ onboarding: "full", emailVerification: "required" });
    for (const locale of uiLocales) {
      const options = await f.app.inject(`/api/auth/registration-options?locale=${locale}`);
      expect(options.statusCode).toBe(200);
      expect(Object.keys(options.json()).sort()).toEqual(["documents", "policy", "smsCountries"]);
      expect(options.json().documents.privacy.id).toEqual(expect.any(String));
    }
    for (const phoneE164 of ["+999123456789", "+442079460000"]) {
      const result = await f.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...f.input, phoneE164 } });
      expect(result.statusCode).toBe(phoneE164.startsWith("+999") ? 400 : 403);
      expect(await f.authRepository.findUserByEmail(f.input.email)).toBeNull();
    }
    expect(f.sms.requests).toHaveLength(0);
  });
});
