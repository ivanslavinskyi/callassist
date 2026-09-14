import { isPhoneCountryCode, verificationPhoneCountry } from "@callassist/contracts";
import { ApplicationRateLimiter, type RateLimiter } from "./rate-limiter";
import type { VerificationProvider } from "./verification-provider";

export class VerificationSendError extends Error {
  constructor(readonly code: "SMS_DESTINATION_NOT_ALLOWED" | "RATE_LIMITED", readonly retryAfterSeconds?: number) {
    super(code);
  }
}

export class BoundedVerificationProvider implements VerificationProvider {
  get mode() { return this.provider.mode; }
  constructor(private readonly provider: VerificationProvider, private readonly limiter: RateLimiter,
    private readonly policy: { countries: string[]; daily: number; perMinute: number }) {}

  async send(phoneE164: string, locale?: string) {
    const country = verificationPhoneCountry(phoneE164);
    if (!country || !this.policy.countries.includes(country)) throw new VerificationSendError("SMS_DESTINATION_NOT_ALLOWED");
    // One shared budget across signup, recovery, changes and public opt-out.
    // Reserve before dispatch; uncertain sends are never refunded or auto-retried.
    const result = await this.limiter.consumeMany([
      { scope: "sms-send:cooldown", identifier: phoneE164, limit: 1, windowMs: 60_000 },
      { scope: "sms-send:phone", identifier: phoneE164, limit: 3, windowMs: 3_600_000 },
      { scope: "sms-send:global-minute", identifier: "all", limit: this.policy.perMinute, windowMs: 60_000 },
      { scope: "sms-send:global-day", identifier: "all", limit: this.policy.daily, windowMs: 86_400_000 }
    ]);
    if (!result.allowed) throw new VerificationSendError("RATE_LIMITED", result.retryAfterSeconds);
    return this.provider.send(phoneE164, locale);
  }
  check(phoneE164: string, code: string) { return this.provider.check(phoneE164, code); }
}

export function boundVerificationProvider(provider: VerificationProvider, limiter?: RateLimiter) {
  if (process.env.NODE_ENV === "production" && !limiter?.shared) throw new Error("Production SMS requires a shared rate limiter");
  const countries = (process.env.SMS_ALLOWED_COUNTRIES?.trim() || "CH,UA").split(",").map((v) => v.trim().toUpperCase());
  if (!countries.length || countries.some((v) => !isPhoneCountryCode(v))) throw new Error("SMS_ALLOWED_COUNTRIES must contain ISO country codes");
  const limit = (name: string, fallback: number) => {
    const value = Number(process.env[name]?.trim() || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new Error(`${name} must be an integer between 1 and 100000`);
    return value;
  };
  return new BoundedVerificationProvider(provider, limiter ?? new ApplicationRateLimiter(), {
    countries, daily: limit("SMS_DAILY_SEND_LIMIT", 100), perMinute: limit("SMS_PER_MINUTE_SEND_LIMIT", 10)
  });
}
