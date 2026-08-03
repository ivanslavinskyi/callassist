import type { TelephonyProvider } from "./telephony-provider";
import { MockTelephonyProvider } from "./mock-telephony-provider";
import { TwilioTelephonyProvider } from "./twilio-telephony-provider";

export function createTelephonyProviderFromEnv(): TelephonyProvider {
  const driver = process.env.TELEPHONY_DRIVER?.trim() || "mock";
  if (driver === "mock") return new MockTelephonyProvider();

  if (driver === "twilio") {
    const accountSid = requireEnvironmentValue("TWILIO_ACCOUNT_SID");
    const authToken = requireEnvironmentValue("TWILIO_AUTH_TOKEN");
    const fromNumber = requireEnvironmentValue("TWILIO_PHONE_NUMBER");
    const publicBaseUrl = requireEnvironmentValue("PUBLIC_BASE_URL");
    return new TwilioTelephonyProvider({
      accountSid,
      authToken,
      fromNumber,
      publicBaseUrl
    });
  }

  throw new Error(`Unsupported TELEPHONY_DRIVER: ${driver}`);
}

function requireEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Twilio telephony`);
  return value;
}
