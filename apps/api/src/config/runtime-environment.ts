import {
  dataEncryptionMaterialUsesKey,
  parseDataEncryptionKey,
  parseDataEncryptionKeyring,
  type DataEncryptionMaterial
} from "../security/encryption";

export type RuntimeProcess = "api" | "worker";

export class RuntimeConfigurationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid production configuration: ${issues.join("; ")}`);
    this.name = "RuntimeConfigurationError";
  }
}

export function validateRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  runtime: RuntimeProcess
) {
  if (environment.NODE_ENV !== "production") return;

  const issues: string[] = [];
  requireExact(environment, "STORAGE_DRIVER", "postgres", issues);
  requireExact(environment, "TELEPHONY_DRIVER", "twilio", issues);
  requireExact(environment, "DURABLE_WORKER_MODE", "external", issues);
  requirePostgresUrl(environment.DATABASE_URL, issues);
  let dataEncryptionMaterial: DataEncryptionMaterial | undefined;
  try {
    dataEncryptionMaterial = parseDataEncryptionKeyring(environment);
  } catch (error) {
    issues.push(error instanceof Error
      ? error.message
      : "DATA_ENCRYPTION keyring is invalid");
  }
  requireSecret(environment, "OPENAI_API_KEY", issues);
  requireSecret(environment, "TWILIO_ACCOUNT_SID", issues);
  requireSecret(environment, "TWILIO_AUTH_TOKEN", issues);
  requireSecret(environment, "TWILIO_PHONE_NUMBER", issues);
  requireHttpsOrigin(environment.PUBLIC_BASE_URL, "PUBLIC_BASE_URL", issues);

  if (runtime === "api") {
    requireExact(environment, "VERIFICATION_DRIVER", "twilio", issues);
    requireExact(environment, "EMAIL_DRIVER", "resend", issues);
    requireExact(environment, "BRIEF_COMPILER_DRIVER", "openai", issues);
    requireSecret(environment, "TWILIO_VERIFY_SERVICE_SID", issues);
    requireSecret(environment, "RESEND_API_KEY", issues);
    requireSecret(environment, "EMAIL_FROM", issues);
    requireBase64Key(
      environment.EMAIL_VERIFICATION_HASH_KEY,
      "EMAIL_VERIFICATION_HASH_KEY",
      issues
    );
    requireBase64Key(
      environment.PROMO_CODE_HASH_KEY,
      "PROMO_CODE_HASH_KEY",
      issues
    );
    requireBase64Key(
      environment.RATE_LIMIT_HASH_KEY,
      "RATE_LIMIT_HASH_KEY",
      issues
    );
    const rateLimitHashKey = decodeBase64Key(environment.RATE_LIMIT_HASH_KEY);
    const promoCodeHashKey = decodeBase64Key(environment.PROMO_CODE_HASH_KEY);
    const emailVerificationHashKey = decodeBase64Key(
      environment.EMAIL_VERIFICATION_HASH_KEY
    );
    if (environment.PROMO_CODE_HASH_KEY?.trim() && dataEncryptionMaterial) {
      try {
        const promoKey = parseDataEncryptionKey(
          environment.PROMO_CODE_HASH_KEY
        );
        if (dataEncryptionMaterialUsesKey(dataEncryptionMaterial, promoKey)) {
          issues.push("PROMO_CODE_HASH_KEY must be independent");
        }
      } catch {
        // The field-specific validation above reports the bounded issue.
      }
    }
    if (rateLimitHashKey && dataEncryptionMaterial &&
      dataEncryptionMaterialUsesKey(dataEncryptionMaterial, rateLimitHashKey)) {
      issues.push("RATE_LIMIT_HASH_KEY must be independent");
    }
    if (rateLimitHashKey && promoCodeHashKey &&
      rateLimitHashKey.equals(promoCodeHashKey)) {
      issues.push("RATE_LIMIT_HASH_KEY must differ from PROMO_CODE_HASH_KEY");
    }
    if (emailVerificationHashKey && dataEncryptionMaterial &&
      dataEncryptionMaterialUsesKey(dataEncryptionMaterial, emailVerificationHashKey)) {
      issues.push("EMAIL_VERIFICATION_HASH_KEY must be independent");
    }
    if (emailVerificationHashKey && (
      emailVerificationHashKey.equals(rateLimitHashKey ?? Buffer.alloc(0)) ||
      emailVerificationHashKey.equals(promoCodeHashKey ?? Buffer.alloc(0))
    )) {
      issues.push("EMAIL_VERIFICATION_HASH_KEY must differ from other HMAC keys");
    }
    const origins = environment.WEB_ORIGIN
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
    if (origins.length === 0) {
      issues.push("WEB_ORIGIN is required");
    } else {
      for (const origin of origins) {
        requireHttpsOrigin(origin, "WEB_ORIGIN", issues);
      }
    }
    requirePort(environment.PORT, "PORT", issues, 4_000);
    requirePort(
      environment.TWILIO_WEBHOOK_PORT,
      "TWILIO_WEBHOOK_PORT",
      issues,
      4_001
    );
    const port = Number(environment.PORT ?? 4_000);
    const webhookPort = Number(environment.TWILIO_WEBHOOK_PORT ?? 4_001);
    if (Number.isInteger(port) && port === webhookPort) {
      issues.push("PORT and TWILIO_WEBHOOK_PORT must differ");
    }
  }

  if (issues.length > 0) throw new RuntimeConfigurationError(issues);
}

function requireExact(
  environment: NodeJS.ProcessEnv,
  name: string,
  expected: string,
  issues: string[]
) {
  if (environment[name]?.trim() !== expected) {
    issues.push(`${name} must be ${expected}`);
  }
}

function requireSecret(
  environment: NodeJS.ProcessEnv,
  name: string,
  issues: string[]
) {
  if (!environment[name]?.trim()) issues.push(`${name} is required`);
}

function requireBase64Key(
  value: string | undefined,
  name: string,
  issues: string[]
) {
  if (!decodeBase64Key(value)) {
    issues.push(`${name} must be a base64-encoded 32-byte key`);
  }
}

function decodeBase64Key(value: string | undefined) {
  const encoded = value?.trim();
  const decoded = encoded && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ? Buffer.from(encoded, "base64")
    : null;
  const canonical = decoded
    ? decoded.toString("base64").replace(/=+$/, "") ===
      encoded!.replace(/=+$/, "")
    : false;
  return decoded?.length === 32 && canonical ? decoded : null;
}

function requirePostgresUrl(value: string | undefined, issues: string[]) {
  try {
    const url = new URL(value ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname || !url.username || !url.password
    ) {
      throw new Error("invalid");
    }
    if (isLoopbackHostname(url.hostname)) {
      issues.push("DATABASE_URL must not use a loopback host");
    }
  } catch {
    issues.push("DATABASE_URL must be an authenticated PostgreSQL URL");
  }
}

function requireHttpsOrigin(
  value: string | undefined,
  name: string,
  issues: string[]
) {
  try {
    const url = new URL(value?.trim() ?? "");
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      isLoopbackHostname(url.hostname)
    ) {
      throw new Error("invalid");
    }
  } catch {
    issues.push(`${name} must contain only non-local HTTPS origins`);
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized.startsWith("127.");
}

function requirePort(
  value: string | undefined,
  name: string,
  issues: string[],
  fallback: number
) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    issues.push(`${name} must be an integer between 1 and 65535`);
  }
}
