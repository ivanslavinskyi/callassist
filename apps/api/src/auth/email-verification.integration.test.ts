import "../config/load-env";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { AuthService } from "./auth-service";
import { InMemoryAuthRepository } from "./in-memory-auth-repository";
import { PostgresAuthRepository } from "./postgres-auth-repository";
import { MockEmailProvider } from "./email-provider";
import { MockVerificationProvider } from "./verification-provider";
import { ApplicationRateLimiter } from "./rate-limiter";

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of closers.splice(0).reverse()) await close(); });
async function fixture(driver: "memory" | "postgres") {
  const db = driver === "postgres" ? isolatedTestDatabase() : null;
  if (db) { closers.push(() => db.teardown()); await db.setup(); }
  const repository = db ? new PostgresAuthRepository(db.url) : new InMemoryAuthRepository();
  let now = Date.now(); let nextCode = 500_000;
  const email = new MockEmailProvider(); const sms = new MockVerificationProvider("123456");
  const service = new CallService(new InMemoryCallRepository());
  const auth = new AuthService({ repository, verificationProvider: sms, emailProvider: email,
    emailVerificationCode: () => String(++nextCode), now: () => new Date(now),
    rateLimiter: new ApplicationRateLimiter(() => now), signupCreditGranter: service });
  const app = buildApp({ service, authService: auth, secureCookies: false, logger: false });
  closers.push(() => app.close());
  const registration = { email: `${randomUUID()}@example.com`, phoneE164: "+41791234567",
    firstName: "Email", lastName: "Fixture", password: "fixture-password-2026", uiLocale: "de" as const };
  await auth.register(registration, { ip: "127.0.0.1" });
  const session = await auth.verifyPhone({ email: registration.email, code: "123456" }, { ip: "127.0.0.1" });
  const call = await service.create({ recipientName: "Email fixture", phoneNumber: "+41710000999", objective: "Ask when the office opens.", assistantProfileId: "sebastian", representedPersonFirstName: "Email", representedPersonLastName: "Fixture", locale: "en-GB", allowedFacts: [] }, session.user.id);
  const cookie = `callassist_session=${session.token}`;
  const post = (url: string, payload: unknown, overrideCookie = cookie) => app.inject({ method: "POST", url, payload: payload as object, headers: { cookie: overrideCookie } });
  const start = () => post("/api/auth/email-verification/start", { uiLocale: "de" });
  const confirm = (id: string, code = email.verificationMessages.at(-1)!.code, overrideCookie = cookie) => post("/api/auth/email-verification/confirm", { verificationId: id, code }, overrideCookie);
  return { app, call, repository, service, auth, email, sms, registration, session, cookie, post, start, confirm, advance: (ms: number) => { now += ms; } };
}

describe.each(["memory", "postgres"] as const)("email verification on %s", (driver) => {
  it("uses the saved interface language ahead of the active request language", async () => {
    const f = await fixture(driver);
    await f.auth.updateLanguagePreferences(f.session.user.id, { uiLocale: "fr" });
    const sent = await f.post("/api/auth/email-verification/start", { uiLocale: "uk" });
    expect(sent.statusCode).toBe(202);
    expect(f.email.verificationMessages.at(-1)?.locale).toBe("fr");
  });
  it("supports Ukrainian registration, correction, phone change and recovery", async () => {
    const f = await fixture(driver);
    const email = `${randomUUID()}@example.com`;
    const registration = await f.post("/api/auth/register", { ...f.registration, email, phoneE164: "+380 (67) 123-45-67" });
    expect(registration.statusCode).toBe(202);
    expect(f.sms.requests.at(-1)).toEqual({ phoneE164: "+380671234567", locale: "de" });
    expect((await f.post("/api/auth/verification/phone", { email, currentPassword: f.registration.password, newPhoneE164: "+380 50 123 45 67" })).statusCode).toBe(202);
    await f.auth.resendVerification({ email }, { ip: "127.0.0.1" });
    expect(f.sms.requests.at(-1)?.phoneE164).toBe("+380501234567");
    expect((await f.auth.verifyPhone({ email, code: "123456" }, { ip: "127.0.0.1" })).user.phoneVerifiedAt).toBeTruthy();
    const change = await f.post("/api/auth/phone-change/start", { newPhoneE164: "00380 63 123 45 67", currentPassword: f.registration.password });
    expect(change.statusCode).toBe(202);
    expect((await f.post("/api/auth/phone-change/confirm", { phoneChangeId: change.json().phoneChangeId, code: "123456" })).statusCode).toBe(200);
    expect((await f.repository.findUserByEmail(f.registration.email))?.phoneE164).toBe("+380631234567");
    await f.auth.startPasswordRecovery({ email: f.registration.email }, { ip: "127.0.0.1" });
    expect(f.sms.requests.at(-1)).toEqual({ phoneE164: "+380631234567", locale: "de" });
  }, 30_000);

  async function pendingUser(f: Awaited<ReturnType<typeof fixture>>) {
    const existing = await f.repository.findUserByEmail(f.registration.email);
    return f.repository.createUser({ ...f.registration, email: `${randomUUID()}@example.com`, phoneE164: "+41791234568", passwordHash: existing!.passwordHash });
  }

  it("rejects a phone reserved by an unfinished signup before sending an SMS", async () => {
    const f = await fixture(driver); const pending = await pendingUser(f);
    const smsCount = f.sms.requests.length;
    const response = await f.post("/api/auth/phone-change/start", {
      newPhoneE164: pending.phoneE164, currentPassword: f.registration.password
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "PHONE_CHANGE_NOT_AVAILABLE" });
    expect(f.sms.requests).toHaveLength(smsCount);
    expect((await f.repository.findUserByEmail(pending.email))).toMatchObject({ phoneE164: pending.phoneE164, phoneVerifiedAt: null });
    expect((await f.repository.findUserByEmail(f.registration.email))?.phoneE164).toBe(f.registration.phoneE164);
  }, 30_000);

  it("reports an unavailable number, not a wrong code, if another signup claims it after SMS delivery", async () => {
    const f = await fixture(driver);
    const started = await f.post("/api/auth/phone-change/start", {
      newPhoneE164: "+41791234568", currentPassword: f.registration.password
    });
    expect(started.statusCode).toBe(202);
    const pending = await pendingUser(f);
    const check = vi.spyOn(f.sms, "check");
    const input = { phoneChangeId: started.json().phoneChangeId, code: "123456" };
    const confirmed = await f.post("/api/auth/phone-change/confirm", input);
    expect(check).toHaveBeenCalledWith(pending.phoneE164, "123456");
    expect(confirmed.statusCode).toBe(409);
    expect(confirmed.json()).toEqual({ error: "PHONE_CHANGE_NOT_AVAILABLE" });
    expect((await f.repository.findUserByEmail(f.registration.email))?.phoneE164).toBe(f.registration.phoneE164);
    expect((await f.repository.findUserByEmail(pending.email))).toMatchObject({ phoneE164: pending.phoneE164, phoneVerifiedAt: null });
    expect(f.email.securityMessages).toHaveLength(0);
    expect(await f.auth.authenticate(f.session.token)).not.toBeNull();
    const replay = await f.post("/api/auth/phone-change/confirm", input);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: "INVALID_PHONE_CHANGE" });
    expect(check).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("corrects a signup phone only with its password and still requires SMS proof", async () => {
    const f = await fixture(driver); const pending = await pendingUser(f);
    const input = { email: pending.email, currentPassword: f.registration.password, newPhoneE164: "+41791234569", uiLocale: "de" as const };
    const smsCount = f.sms.requests.length;
    expect((await f.post("/api/auth/verification/phone", { ...input, currentPassword: "wrong-password" })).statusCode).toBe(403);
    expect(f.sms.requests).toHaveLength(smsCount);
    expect((await f.post("/api/auth/verification/phone", input)).statusCode).toBe(202);
    expect((await f.repository.findUserByEmail(pending.email))).toMatchObject({ phoneE164: input.newPhoneE164, phoneVerifiedAt: null });
    expect(f.sms.requests.at(-1)).toEqual({ phoneE164: input.newPhoneE164, locale: "de" });
    const proof = await f.auth.verifyPhone({ email: pending.email, code: "123456" }, { ip: "127.0.0.1" });
    expect(proof.user.phoneVerifiedAt).toBeTruthy();
    expect((await f.post("/api/auth/verification/phone", input)).statusCode).toBe(403);
  }, 30_000);

  it("cannot apply an in-flight proof to a corrected phone or reuse it concurrently", async () => {
    const f = await fixture(driver); const pending = await pendingUser(f);
    let notifyEntered!: () => void; let releaseCheck!: (approved: boolean) => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const released = new Promise<boolean>((resolve) => { releaseCheck = resolve; });
    vi.spyOn(f.sms, "check").mockImplementationOnce(async () => { notifyEntered(); return released; });
    const proof = f.auth.verifyPhone({ email: pending.email, code: "123456" }, { ip: "127.0.0.1" }).catch((error) => error);
    await entered;
    await f.auth.correctUnverifiedPhone({ email: pending.email, currentPassword: f.registration.password, newPhoneE164: "+41791234569" }, { ip: "127.0.0.1" });
    releaseCheck(true);
    expect(await proof).toMatchObject({ code: "INVALID_VERIFICATION" });
    expect((await f.repository.findUserByEmail(pending.email))?.phoneVerifiedAt).toBeNull();
    const attempts = await Promise.allSettled([1, 2].map(() => f.auth.verifyPhone({ email: pending.email, code: "123456" }, { ip: "127.0.0.1" })));
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  }, 30_000);

  it("leaves a corrected phone unverified on outage and does not steal an occupied number", async () => {
    const f = await fixture(driver); const pending = await pendingUser(f);
    const input = { email: pending.email, currentPassword: f.registration.password, newPhoneE164: f.registration.phoneE164 };
    expect((await f.post("/api/auth/verification/phone", input)).statusCode).toBe(403);
    vi.spyOn(f.sms, "send").mockRejectedValueOnce(new Error("provider unavailable"));
    expect((await f.post("/api/auth/verification/phone", { ...input, newPhoneE164: "+41791234569" })).statusCode).toBe(503);
    expect((await f.repository.findUserByEmail(pending.email))).toMatchObject({ phoneE164: "+41791234569", phoneVerifiedAt: null });
    await f.auth.resendVerification({ email: pending.email }, { ip: "127.0.0.1" });
    expect(f.sms.requests.at(-1)?.phoneE164).toBe("+41791234569");
  }, 30_000);

  it("rejects another user and stops guessing after eight attempts", async () => {
    const f = await fixture(driver);
    const otherEmail = `${randomUUID()}@example.com`;
    await f.auth.register({ ...f.registration, email: otherEmail, phoneE164: "+41791234568" }, { ip: "127.0.0.2" });
    const other = await f.auth.verifyPhone({ email: otherEmail, code: "123456" }, { ip: "127.0.0.2" });
    const started = await f.start(); const id = started.json().verificationId;
    expect((await f.confirm(id, undefined, `callassist_session=${other.token}`)).statusCode).toBe(401);
    for (let attempt = 0; attempt < 7; attempt++) expect((await f.confirm(id, "999999")).statusCode).toBe(401);
    // The shared challenge-ID limiter also counts the foreign-user attempt.
    expect((await f.confirm(id)).statusCode).toBe(429);
    expect((await f.repository.findUserByEmail(f.registration.email))?.emailVerifiedAt).toBeNull();
    expect((await f.repository.findUserByEmail(otherEmail))?.emailVerifiedAt).toBeNull();
  }, 30_000);

  it("notifies a verified address after phone change and password reset", async () => {
    const f = await fixture(driver);
    const started = await f.start(); expect((await f.confirm(started.json().verificationId)).statusCode).toBe(200);
    const phone = await f.post("/api/auth/phone-change/start", { newPhoneE164: "+41791234568", currentPassword: f.registration.password });
    expect(phone.statusCode).toBe(202);
    expect((await f.post("/api/auth/phone-change/confirm", { phoneChangeId: phone.json().phoneChangeId, code: "123456" })).statusCode).toBe(200);
    const recovery = await f.auth.startPasswordRecovery({ email: f.registration.email, uiLocale: "de" }, { ip: "127.0.0.1" });
    const grant = await f.auth.verifyPasswordRecovery({ recoveryId: recovery.recoveryId, code: "123456" }, { ip: "127.0.0.1" });
    await f.auth.completePasswordRecovery({ recoveryToken: grant.recoveryToken, newPassword: "new-fixture-password-2026" }, { ip: "127.0.0.1" });
    expect(f.email.securityMessages.map((message) => [message.kind, message.to, message.locale])).toEqual([
      ["phone_changed", f.registration.email, "de"], ["password_reset", f.registration.email, "de"]
    ]);
    expect(await f.auth.authenticate(f.session.token)).toBeNull();
  }, 30_000);

  it("requires proof before either call-start route, sends localized email and persists proof", async () => {
    const f = await fixture(driver);
    expect(f.session.user.emailVerifiedAt).toBeNull();
    expect(f.sms.requests[0].locale).toBe("de");
    const startCall = vi.spyOn(f.service, "start");
    for (const operation of ["start", "approve-and-start"]) {
      const response = await f.post(`/api/call-briefs/${f.call.id}/${operation}`, {});
      expect(response.statusCode).toBe(403); expect(response.json().error).toBe("EMAIL_VERIFICATION_REQUIRED");
    }
    expect(startCall).not.toHaveBeenCalled();
    const started = await f.start(); expect(started.statusCode).toBe(202);
    expect(started.headers["cache-control"]).toBe("private, no-store");
    expect(f.email.verificationMessages[0]).toMatchObject({ to: f.registration.email, locale: "de", expiresInMinutes: 10 });
    expect(f.email.noticeMessages).toHaveLength(0);
    const confirmed = await f.confirm(started.json().verificationId);
    expect(confirmed.statusCode).toBe(200); expect(confirmed.json()).toMatchObject({ status: "email_verified", user: { emailVerifiedAt: expect.any(String) } });
    expect((await f.repository.findUserByEmail(f.registration.email))?.emailVerifiedAt).toBeTruthy();
    expect((await f.start()).statusCode).toBe(409);
    await f.service.approveCompilation(f.call.id, await originalPlanReview(f.service, f.call.id));
    expect((await f.post(`/api/call-briefs/${f.call.id}/start`, {})).statusCode).toBe(200);
    expect((await f.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: f.cookie } })).statusCode).toBe(200);
  }, 30_000);

  it("rejects another session, another purpose, wrong codes and replay without invalidating a valid session", async () => {
    const f = await fixture(driver);
    const other = await f.auth.login({ email: f.registration.email, password: f.registration.password }, { ip: "127.0.0.2" });
    const started = await f.start(); const id = started.json().verificationId;
    expect((await f.confirm(id, undefined, `callassist_session=${other.token}`)).statusCode).toBe(401);
    expect((await f.post("/api/auth/email-change/confirm", { emailChangeId: id, code: f.email.verificationMessages.at(-1)!.code })).statusCode).toBe(401);
    expect((await f.confirm(id, "999999")).statusCode).toBe(401);
    expect((await f.confirm(id)).statusCode).toBe(200);
    expect((await f.confirm(id)).statusCode).toBe(401);
    expect(await f.auth.authenticate(f.session.token)).not.toBeNull();
    expect(await f.auth.authenticate(other.token)).toBeNull();
  }, 30_000);

  it("enforces resend cooldown, invalidates earlier codes and rejects expired challenges", async () => {
    const f = await fixture(driver);
    const first = await f.start(); const oldCode = f.email.verificationMessages.at(-1)!.code;
    expect((await f.start()).statusCode).toBe(429);
    f.advance(61_000);
    const next = await f.start(); expect(next.statusCode).toBe(202);
    expect((await f.confirm(first.json().verificationId, oldCode)).statusCode).toBe(401);
    expect((await f.confirm(next.json().verificationId, oldCode)).statusCode).toBe(401);
    f.advance(10 * 60_000 + 1);
    expect((await f.confirm(next.json().verificationId)).statusCode).toBe(401);
    expect((await f.repository.findUserByEmail(f.registration.email))?.emailVerifiedAt).toBeNull();
  }, 30_000);

  it("invalidates uncertain delivery and permits correction without mailing account details to an unverified address", async () => {
    const f = await fixture(driver);
    vi.spyOn(f.email, "sendEmailChangeVerification").mockImplementationOnce(async (input) => {
      f.email.verificationMessages.push(input); throw new Error("uncertain delivery");
    });
    expect((await f.start()).statusCode).toBe(503);
    const message = f.email.verificationMessages.at(-1)!;
    expect((await f.confirm(message.idempotencyKey!.split("/").at(-1)!, message.code)).statusCode).toBe(401);
    f.advance(61_000);
    const corrected = `${randomUUID()}@example.com`;
    const change = await f.post("/api/auth/email-change/start", { newEmail: corrected, currentPassword: f.registration.password });
    expect(change.statusCode).toBe(202);
    expect(f.email.noticeMessages).toHaveLength(0);
    const completed = await f.post("/api/auth/email-change/confirm", { emailChangeId: change.json().emailChangeId, code: f.email.verificationMessages.at(-1)!.code });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().user).toMatchObject({ email: corrected, emailVerifiedAt: expect.any(String) });
    expect(f.email.securityMessages.map((m) => m.to)).toEqual([corrected]);
    expect(await f.repository.findUserByEmail(f.registration.email)).toBeNull();
  }, 30_000);

  it("does not turn a completed change into failure when a security notice cannot be delivered", async () => {
    const f = await fixture(driver);
    const initial = await f.start(); expect((await f.confirm(initial.json().verificationId)).statusCode).toBe(200);
    f.advance(61_000);
    vi.spyOn(f.email, "sendEmailChangeNotice").mockRejectedValue(new Error("notice unavailable"));
    vi.spyOn(f.email, "sendSecurityNotice").mockRejectedValue(new Error("notice unavailable"));
    const next = `${randomUUID()}@example.com`;
    const change = await f.post("/api/auth/email-change/start", { newEmail: next, currentPassword: f.registration.password });
    expect(change.statusCode).toBe(202);
    expect((await f.post("/api/auth/email-change/confirm", { emailChangeId: change.json().emailChangeId, code: f.email.verificationMessages.at(-1)!.code })).statusCode).toBe(200);
    expect((await f.repository.findUserByEmail(next))?.emailVerifiedAt).toBeTruthy();
  }, 30_000);
});
