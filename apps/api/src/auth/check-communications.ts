import "../config/load-env";
import { createEmailProviderFromEnv, emailVerificationHashKeyFromEnv } from "./create-email-provider";
import { createRateLimiterFromEnv } from "./create-rate-limiter";
import { createVerificationProviderFromEnv } from "./create-verification-provider";
import { communicationLocales } from "./communication-locales";

// Configuration inspection only: no DB queries, provider requests or messages.
const checks: Record<string, boolean | string> = {};
for (const name of ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_VERIFICATION_HASH_KEY",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"]) {
  checks[name] = Boolean(process.env[name]?.trim());
}
try { checks.emailDriver = createEmailProviderFromEnv().mode; }
catch { checks.emailConfigurationValid = false; }
try { emailVerificationHashKeyFromEnv(); checks.emailHashKeyValid = true; }
catch { checks.emailHashKeyValid = false; }
try {
  const limiter = createRateLimiterFromEnv();
  try {
    checks.smsDriver = createVerificationProviderFromEnv(limiter).mode;
    checks.sharedSmsLimitsConfigured = Boolean(limiter.shared);
  } finally { await limiter.close?.(); }
} catch { checks.smsConfigurationValid = false; }
const configured = Object.values(checks).every((value) => value !== false) &&
  checks.emailDriver === "resend" && checks.smsDriver === "twilio";
console.log(JSON.stringify({ configured, checks, languages: communicationLocales,
  deliveryVerified: false,
  next: "Real delivery, domain DNS, Twilio geo/fraud settings and operator drills require separate acceptance. See docs/email-sms-implementation-2026-09-14.md."
}, null, 2));
if (!configured) process.exitCode = 1;
