import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_UI_LOCALES } from "@callassist/contracts";
import { communicationLocales, resolveCommunicationLocale, resolveEmailLocale } from "./communication-locales";
import { emailChangeRequestNotice, emailMessages, securityNoticeEmail, verificationEmail } from "./email-templates";
import { emailBrandingFromEnv, emailIdentity } from "./email-branding";
import { ResendEmailProvider } from "./resend-email-provider";
import { TwilioVerificationProvider } from "./twilio-verification-provider";
import { BoundedVerificationProvider, boundVerificationProvider } from "./bounded-verification-provider";
import { MockVerificationProvider } from "./verification-provider";
import { ApplicationRateLimiter } from "./rate-limiter";
import { mockEmailVerificationCodeFromEnv } from "./create-email-provider";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("never injects mock email codes into real delivery or production", () => {
  vi.stubEnv("EMAIL_DRIVER", "resend"); vi.stubEnv("MOCK_EMAIL_VERIFICATION_CODE", "123456");
  expect(mockEmailVerificationCodeFromEnv()).toBeUndefined();
  vi.stubEnv("EMAIL_DRIVER", "mock"); vi.stubEnv("NODE_ENV", "production");
  expect(() => mockEmailVerificationCodeFromEnv()).toThrow();
  vi.stubEnv("NODE_ENV", "development");
  expect(mockEmailVerificationCodeFromEnv()?.()).toBe("123456");
  vi.stubEnv("MOCK_EMAIL_VERIFICATION_CODE", "bad");
  expect(() => mockEmailVerificationCodeFromEnv()).toThrow();
});
describe("communication language readiness", () => {
  it("covers every enabled UI locale and keeps all five planned languages explicit", () => {
    for (const language of SUPPORTED_UI_LOCALES) {
      expect(communicationLocales[language].emailReadiness).toBe("reviewed");
      expect(emailMessages[communicationLocales[language].email]).toBeDefined();
    }
    for (const language of ["fr", "it", "rm", "uk", "ru"] as const) expect(communicationLocales[language]).toBeDefined();
    expect(resolveCommunicationLocale("rm-CH")).toMatchObject({ language: "rm", email: "en", sms: "en", emailReadiness: "fallback" });
  });
  it.each(["en", "de", "fr", "it", "uk", "ru"] as const)("renders complete HTML/text and notices for %s", (locale) => {
    expect(resolveEmailLocale(`${locale}-${locale === "uk" ? "UA" : "CH"}`)).toBe(locale);
    const content = verificationEmail({ locale, code: "123456", expiresInMinutes: 10 });
    expect(content.text).toContain("123456"); expect(content.text).toContain("10");
    expect(content.html).toContain(`lang="${locale}"`); expect(content.text).not.toContain("{minutes}");
    expect(content.html).toContain(`src="cid:${content.attachments[0].content_id}"`);
    expect(Buffer.from(content.attachments[0].content, "base64").subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(content.text).toContain(emailIdentity.supportAddress);
    expect(content.html.match(/<a /g)).toHaveLength(2);
    expect(content.text).not.toMatch(/Ivan Slavinskyi|Weiernstrasse/);
    expect(content.html).not.toContain("background:");
    const legalLanguage = locale === "de" ? "de" : "en";
    expect(content.text).toContain(`https://shprohli.ch/${legalLanguage}/`);
    if (locale !== "en" && locale !== "de") expect(content.text).toContain(emailMessages[locale].footer.imprintEnglish);
    expect(emailChangeRequestNotice(locale).attachments).toEqual(content.attachments);
    for (const kind of ["email_changed", "phone_changed", "password_reset"] as const) {
      expect(securityNoticeEmail(locale, kind).text).not.toContain("undefined");
      expect(securityNoticeEmail(locale, kind).subject).toBe(emailMessages[locale].notices[kind]);
    }
  });
  it("escapes HTML and uses an explicit fallback for unknown/invalid preferences", () => {
    const html = verificationEmail({ locale: "en", code: '<img src=x onerror="alert(1)">', expiresInMinutes: 10 }).html;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    for (const locale of [undefined, null, "bad_locale", "pl-PL"]) expect(resolveEmailLocale(locale)).toBe("en");
  });
});

it("uses the configured website for email links and rejects unsafe production origins", () => {
  const branding = emailBrandingFromEnv({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://beta.example.com" });
  const content = verificationEmail({ locale: "de", code: "123456", expiresInMinutes: 10 }, branding);
  expect(content.html).toContain('href="https://beta.example.com/de/impressum"');
  expect(content.text).toContain("https://beta.example.com/de/impressum");
  expect(emailBrandingFromEnv({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }).siteUrl).toBe("http://localhost:3000");
  for (const siteUrl of [undefined, "http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com/?key=private", "javascript:alert(1)", "https://localhost"]) {
    expect(() => emailBrandingFromEnv({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: siteUrl })).toThrow();
  }
});

describe("Resend bounded delivery", () => {
  const input = { to: "fixture@example.com", locale: "de" as const, code: "654321", expiresInMinutes: 10, idempotencyKey: "fixture-message-1" };
  it("retries uncertain sends with the identical key/body and logs only a safe receipt", async () => {
    const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const request = vi.fn().mockRejectedValueOnce(new Error("private upstream response"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { status: 200 }));
    const provider = new ResendEmailProvider({ apiKey: "private-key", from: "fixture@example.com", fetch: request, sleep: async () => {} });
    await provider.sendEmailChangeVerification(input);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    expect(request.mock.calls[1][1].headers["Idempotency-Key"]).toBe(input.idempotencyKey);
    expect(request.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(request.mock.calls[0][1].body);
    expect(payload.reply_to).toBe(emailIdentity.supportAddress);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.html).toContain(`src="cid:${payload.attachments[0].content_id}"`);
    expect(payload.attachments[0].filename).toBe("shprohli-logo.png");
    const logs = log.mock.calls.flat().join("");
    expect(logs).toContain('"status":"accepted"'); expect(logs).toContain('"providerId":');
    for (const secret of [input.to, input.code, "private-key", "private upstream response"]) expect(logs).not.toContain(secret);
  });
  it.each([401, 422, 429])("does not retry permanent/long-backoff HTTP %s errors", async (status) => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const request = vi.fn().mockImplementation(async () => new Response("{}", { status, headers: { "retry-after": "60" } }));
    await expect(new ResendEmailProvider({ apiKey: "fixture", from: "fixture@example.com", fetch: request }).sendEmailChangeVerification(input)).rejects.toThrow("Email delivery unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("bounds repeated transient failures to two requests", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const request = vi.fn().mockImplementation(async () => new Response("{}", { status: 503 }));
    await expect(new ResendEmailProvider({ apiKey: "fixture", from: "fixture@example.com", fetch: request, sleep: async () => {} }).sendEmailChangeVerification(input)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("SMS dispatch", () => {
  it("allows Swiss and Ukrainian contacts with the configured/default policy and keeps other countries blocked", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SMS_DAILY_SEND_LIMIT", "100"); vi.stubEnv("SMS_PER_MINUTE_SEND_LIMIT", "10");
    for (const policy of ["", "CH,UA"]) {
      vi.stubEnv("SMS_ALLOWED_COUNTRIES", policy);
      const sms = new MockVerificationProvider();
      const provider = boundVerificationProvider(sms, new ApplicationRateLimiter());
      await provider.send("+380671234567", "de");
      await provider.send("+41791234567", "en");
      expect(sms.requests).toEqual([{ phoneE164: "+380671234567", locale: "de" }, { phoneE164: "+41791234567", locale: "en" }]);
      await expect(provider.send("+4915123456789", "de")).rejects.toMatchObject({ code: "SMS_DESTINATION_NOT_ALLOWED" });
    }
  });
  it("passes an explicit locale to Twilio and safely falls back for Romansh", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const create = vi.fn().mockResolvedValue({ sid: `VE${"a".repeat(32)}`, status: "pending" });
    const client = { verify: { v2: { services: () => ({ verifications: { create } }) } } };
    const provider = new TwilioVerificationProvider({ accountSid: "fixture", authToken: "fixture", serviceSid: "fixture", client: client as never });
    for (const locale of ["de-CH", "fr-CH", "it-CH", "uk-UA", "ru-RU", "rm-CH"]) await provider.send("+41791234567", locale);
    expect(create.mock.calls.map(([input]) => input.locale)).toEqual(["de", "fr", "it", "uk", "ru", "en"]);
  });
  it("shares phone/global budgets across flows, consumes uncertain sends and rejects other countries", async () => {
    let now = 0;
    const underlying = new MockVerificationProvider();
    const provider = new BoundedVerificationProvider(underlying, new ApplicationRateLimiter(() => now), { countries: ["CH"], daily: 2, perMinute: 2 });
    await provider.send("+41791234567", "de");
    await expect(provider.send("+41791234567", "en")).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 60 });
    now += 61_000;
    vi.spyOn(underlying, "send").mockRejectedValueOnce(new Error("uncertain send"));
    await expect(provider.send("+41791234567", "en")).rejects.toThrow("uncertain");
    now += 61_000;
    await expect(provider.send("+41791234568", "fr")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(provider.send("+4915123456789", "de")).rejects.toMatchObject({ code: "SMS_DESTINATION_NOT_ALLOWED" });
  });
});
