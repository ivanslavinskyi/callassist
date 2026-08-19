import { MockVerificationProvider } from "./verification-provider";
import { TwilioVerificationProvider } from "./twilio-verification-provider";

export function createVerificationProviderFromEnv() {
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
    return new TwilioVerificationProvider({
      accountSid: requireEnvironmentValue("TWILIO_ACCOUNT_SID"),
      authToken: requireEnvironmentValue("TWILIO_AUTH_TOKEN"),
      serviceSid: requireEnvironmentValue("TWILIO_VERIFY_SERVICE_SID")
    });
  }
  throw new Error(`Unsupported VERIFICATION_DRIVER: ${driver}`);
}

function requireEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Twilio Verify`);
  return value;
}
