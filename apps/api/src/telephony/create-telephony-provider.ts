import type { TelephonyProvider } from "./telephony-provider";
import { MockTelephonyProvider } from "./mock-telephony-provider";
import { TwilioTelephonyProvider } from "./twilio-telephony-provider";

export function createTelephonyProviderFromEnv(): TelephonyProvider {
  const driver = process.env.TELEPHONY_DRIVER?.trim() || "mock";
  if (driver === "mock") return new MockTelephonyProvider();

  if (driver === "twilio") {
    const asyncAmd = process.env.TWILIO_ASYNC_AMD?.trim() || "true";
    if (!["true", "false"].includes(asyncAmd)) throw new Error("TWILIO_ASYNC_AMD must be true or false");
    const accountSid = requireEnvironmentValue("TWILIO_ACCOUNT_SID");
    const authToken = requireEnvironmentValue("TWILIO_AUTH_TOKEN");
    const fromNumber = requireEnvironmentValue("TWILIO_PHONE_NUMBER");
    const publicBaseUrl = requireEnvironmentValue("PUBLIC_BASE_URL");
    return new TwilioTelephonyProvider({
      accountSid,
      authToken,
      fromNumber,
      publicBaseUrl,
      asyncAnswering: asyncAmd === "true" && process.env.VOICE_RUNTIME_DRIVER?.trim() === "live" && process.env.VOICE_RUNTIME_LIVE_FALLBACK?.trim() !== "true"
    });
  }

  throw new Error(`Unsupported TELEPHONY_DRIVER: ${driver}`);
}

function requireEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Twilio telephony`);
  return value;
}
