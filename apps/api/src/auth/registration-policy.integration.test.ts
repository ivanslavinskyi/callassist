import "../config/load-env";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBetaSettings, type RegistrationPolicySettingsUpdate, uiLocales } from "@callassist/contracts";
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
afterEach(async () => { vi.restoreAllMocks(); for (const close of closers.splice(0).reverse()) await close(); });

async function fixture(policy: RegistrationPolicySettingsUpdate) {
  const db = isolatedTestDatabase(); closers.push(() => db.teardown()); await db.setup();
  const sql = postgres(db.url, { max: 3 }); closers.push(() => sql.end());
  const authRepository = new PostgresAuthRepository(db.url, true); closers.push(() => authRepository.close());
  const repository = new PostgresCallRepository(db.url, Buffer.alloc(32, 9), true);
  const service = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  const content = new ContentService(new PostgresContentRepository(db.url)); closers.push(() => content.repository.close()); await content.initialize();
  const sms = new MockVerificationProvider("123456");
  const auth = new AuthService({ repository: authRepository, signupCreditGranter: service, betaControls: repository.betaControls,
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
  it("restricts registration on the server and publishes the policy in every locale", async () => {
    const f = await fixture({ onboarding: "full", emailVerification: "required", swissPhonesOnly: true });
    for (const locale of uiLocales) {
      const response = await f.app.inject(`/api/auth/registration-options?locale=${locale}`);
      expect(response.json()).toMatchObject({ policy: { swissPhonesOnly: true }, smsCountries: ["CH"] });
    }
    const blocked = await f.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...f.input, phoneE164: "+380671234567" } });
    expect(blocked.statusCode).toBe(403); expect(blocked.json().error).toBe("SWISS_PHONE_REQUIRED");
    expect(f.sms.requests).toHaveLength(0);
    expect(await f.authRepository.findUserByEmail(f.input.email)).toBeNull();
    expect((await f.sql`SELECT public_accounts FROM beta_controls`)[0]!.public_accounts).toBe(0);
    const accepted = await f.app.inject({ method: "POST", url: "/api/auth/register", payload: f.input });
    expect(accepted.statusCode).toBe(202); expect(f.sms.requests).toHaveLength(1);
  });

  it("applies a changed policy to pending verification, resend and correction", async () => {
    const f = await fixture({ onboarding: "full", emailVerification: "required" });
    const input = { ...f.input, phoneE164: "+380671234567" };
    expect((await f.app.inject({method:"POST",url:"/api/auth/register",payload:input})).statusCode).toBe(202);
    await f.sql`UPDATE beta_controls SET settings=jsonb_set(settings,'{registration,swissPhonesOnly}','true')`;
    for (const [url,payload] of [
      ["/api/auth/verify-phone",{email:input.email,code:"123456"}],
      ["/api/auth/verification/resend",{email:input.email,uiLocale:"en"}],
      ["/api/auth/verification/phone",{email:input.email,currentPassword:input.password,newPhoneE164:"+380671234568",uiLocale:"en"}]
    ] as const) {
      const response=await f.app.inject({method:"POST",url,payload});
      expect(response.json(),url).toMatchObject({error:"SWISS_PHONE_REQUIRED"});
    }
    expect(f.sms.requests).toHaveLength(1);
    expect((await f.authRepository.findUserByEmail(input.email))!.phoneVerifiedAt).toBeNull();
    await expect(f.authRepository.correctUnverifiedPhone({userId:(await f.authRepository.findUserByEmail(input.email))!.id,
      expectedPasswordHash:(await f.authRepository.findUserByEmail(input.email))!.passwordHash,newPhoneE164:"+380671234568"}))
      .rejects.toMatchObject({code:"SWISS_PHONE_REQUIRED"});
  });

  it("keeps existing foreign accounts accessible but prevents starting and completing foreign phone changes", async () => {
    const f = await fixture({ onboarding: "full", emailVerification: "required" });
    const input = { ...f.input, phoneE164: "+380671234567" };
    await f.app.inject({method:"POST",url:"/api/auth/register",payload:input});
    const verified=await f.app.inject({method:"POST",url:"/api/auth/verify-phone",payload:{email:input.email,code:"123456"}});
    const headers={cookie:String(verified.headers["set-cookie"])};
    const start=await f.app.inject({method:"POST",url:"/api/auth/phone-change/start",headers,payload:{newPhoneE164:"+380671234568",currentPassword:input.password}});
    expect(start.statusCode).toBe(202);
    await f.sql`UPDATE beta_controls SET settings=jsonb_set(settings,'{registration,swissPhonesOnly}','true')`;
    const confirm=await f.app.inject({method:"POST",url:"/api/auth/phone-change/confirm",headers,payload:{phoneChangeId:start.json().phoneChangeId,code:"123456"}});
    expect(confirm.json()).toMatchObject({error:"SWISS_PHONE_REQUIRED"});
    const another=await f.app.inject({method:"POST",url:"/api/auth/phone-change/start",headers,payload:{newPhoneE164:"+380671234569",currentPassword:input.password}});
    expect(another.json()).toMatchObject({error:"SWISS_PHONE_REQUIRED"});
    const login=await f.app.inject({method:"POST",url:"/api/auth/login",payload:{email:input.email,password:input.password}});
    expect(login.statusCode).toBe(200); expect(login.json().user.phoneE164).toBe(input.phoneE164);
    expect(f.sms.requests).toHaveLength(2);
    // Switching to a Swiss number remains available.
    const swiss=await f.app.inject({method:"POST",url:"/api/auth/phone-change/start",headers,payload:{newPhoneE164:f.input.phoneE164,currentPassword:input.password}});
    expect(swiss.statusCode).toBe(202);
    const done=await f.app.inject({method:"POST",url:"/api/auth/phone-change/confirm",headers,payload:{phoneChangeId:swiss.json().phoneChangeId,code:"123456"}});
    expect(done.statusCode).toBe(200);
    expect((await f.authRepository.findUserByEmail(input.email))!.phoneE164).toBe(f.input.phoneE164);
  });

  it("preserves password recovery for an already verified foreign number", async () => {
    const f = await fixture({ onboarding: "full", emailVerification: "required" });
    const input = { ...f.input, phoneE164: "+380671234567" };
    const user = await f.authRepository.createUser({ ...input, passwordHash: "unused-pre-recovery-fixture-hash" });
    await f.authRepository.markPhoneVerified(user.id, new Date().toISOString(), input.phoneE164);
    await f.sql`UPDATE beta_controls SET settings=jsonb_set(settings,'{registration,swissPhonesOnly}','true')`;
    const start = await f.app.inject({ method: "POST", url: "/api/auth/recovery/start", payload: { email: input.email } });
    expect(start.statusCode).toBe(202);
    expect(f.sms.requests).toHaveLength(1);
    const approved = await f.app.inject({ method: "POST", url: "/api/auth/recovery/verify", payload: { recoveryId: start.json().recoveryId, code: "123456" } });
    expect(approved.statusCode).toBe(200);
    const newPassword = "updated-recovery-test-password";
    const completed = await f.app.inject({ method: "POST", url: "/api/auth/recovery/complete", payload: { recoveryToken: approved.json().recoveryToken, newPassword } });
    expect(completed.statusCode).toBe(200);
    const login = await f.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: input.email, password: newPassword } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.phoneE164).toBe(input.phoneE164);
  });

  it("rejects verification if the restriction is enabled during the provider check", async () => {
    const f = await fixture({ onboarding: "full", emailVerification: "required" });
    await f.app.inject({method:"POST",url:"/api/auth/register",payload:{...f.input,phoneE164:"+380671234567"}});
    vi.spyOn(f.sms,"check").mockImplementation(async () => {
      await f.sql`UPDATE beta_controls SET settings=jsonb_set(settings,'{registration,swissPhonesOnly}','true')`;
      return true;
    });
    const response=await f.app.inject({method:"POST",url:"/api/auth/verify-phone",payload:{email:f.input.email,code:"123456"}});
    expect(response.json()).toMatchObject({error:"SWISS_PHONE_REQUIRED"});
    const user=(await f.authRepository.findUserByEmail(f.input.email))!;
    expect(user.phoneVerifiedAt).toBeNull();
    await expect(f.authRepository.markPhoneVerified(user.id,new Date().toISOString(),user.phoneE164)).rejects.toMatchObject({code:"SWISS_PHONE_REQUIRED"});
  });
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
      expect(Object.keys(options.json()).sort()).toEqual(["beta", "documents", "policy", "smsCountries"]);
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
