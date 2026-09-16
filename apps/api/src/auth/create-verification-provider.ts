import { MockVerificationProvider } from "./verification-provider";
import { TwilioVerificationProvider } from "./twilio-verification-provider";
import { boundVerificationProvider } from "./bounded-verification-provider";
import type { RateLimiter } from "./rate-limiter";
import type { BetaControls } from "../beta/beta-controls";

export function createVerificationProviderFromEnv(rateLimiter?: RateLimiter, betaControls?: BetaControls, purpose: "account" | "recipient_opt_out" = "account") {
  const driver =
    process.env.VERIFICATION_DRIVER?.trim() ||
    (process.env.TELEPHONY_DRIVER?.trim() === "twilio" ? "twilio" : "mock");
  if (driver === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("VERIFICATION_DRIVER=mock is forbidden in production");
    }
    return new MockVerificationProvider(
      process.env.MOCK_VERIFICATION_CODE?.trim() || "000000"
    );
  }
  if (driver === "twilio") {
    const serviceSid = requireEnvironmentValue(purpose === "recipient_opt_out" ? "TWILIO_OPT_OUT_VERIFY_SERVICE_SID" : "TWILIO_VERIFY_SERVICE_SID");
    if (purpose === "recipient_opt_out" && serviceSid === process.env.TWILIO_VERIFY_SERVICE_SID?.trim()) {
      throw new Error("TWILIO_OPT_OUT_VERIFY_SERVICE_SID must differ from TWILIO_VERIFY_SERVICE_SID");
    }
    return boundVerificationProvider(new TwilioVerificationProvider({
      accountSid: requireEnvironmentValue("TWILIO_ACCOUNT_SID"),
      authToken: requireEnvironmentValue("TWILIO_AUTH_TOKEN"),
      serviceSid, betaControls
    }), rateLimiter);
  }
  throw new Error(`Unsupported VERIFICATION_DRIVER: ${driver}`);
}

function requireEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Twilio Verify`);
  return value;
}
