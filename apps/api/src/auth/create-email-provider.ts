import { MockEmailProvider } from "./email-provider";
import { ResendEmailProvider } from "./resend-email-provider";

export function createEmailProviderFromEnv() {
  const driver = process.env.EMAIL_DRIVER?.trim() || "mock";
  if (driver === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_DRIVER=mock is forbidden in production");
    }
    return new MockEmailProvider();
  }
  if (driver === "resend") {
    return new ResendEmailProvider({
      apiKey: requireEnvironmentValue("RESEND_API_KEY"),
      from: requireEnvironmentValue("EMAIL_FROM")
    });
  }
  throw new Error(`Unsupported EMAIL_DRIVER: ${driver}`);
}

export function emailVerificationHashKeyFromEnv() {
  const encoded = process.env.EMAIL_VERIFICATION_HASH_KEY?.trim();
  if (!encoded && process.env.NODE_ENV !== "production") return Buffer.alloc(32, 11);
  const decoded = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
  if (decoded.length !== 32) {
    throw new Error("EMAIL_VERIFICATION_HASH_KEY must be a base64-encoded 32-byte key");
  }
  return decoded;
}

function requireEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for email delivery`);
  return value;
}
