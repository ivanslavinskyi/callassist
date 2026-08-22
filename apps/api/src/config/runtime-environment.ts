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
  requireBase64Key(environment.DATA_ENCRYPTION_KEY, "DATA_ENCRYPTION_KEY", issues);
  requireSecret(environment, "OPENAI_API_KEY", issues);
  requireSecret(environment, "TWILIO_ACCOUNT_SID", issues);
  requireSecret(environment, "TWILIO_AUTH_TOKEN", issues);
  requireSecret(environment, "TWILIO_PHONE_NUMBER", issues);
  requireHttpsOrigin(environment.PUBLIC_BASE_URL, "PUBLIC_BASE_URL", issues);

  if (runtime === "api") {
    requireExact(environment, "VERIFICATION_DRIVER", "twilio", issues);
    requireExact(environment, "BRIEF_COMPILER_DRIVER", "openai", issues);
    requireSecret(environment, "TWILIO_VERIFY_SERVICE_SID", issues);
    requireBase64Key(
      environment.PROMO_CODE_HASH_KEY,
      "PROMO_CODE_HASH_KEY",
      issues
    );
    if (
      environment.PROMO_CODE_HASH_KEY?.trim() &&
      environment.PROMO_CODE_HASH_KEY.trim() ===
        environment.DATA_ENCRYPTION_KEY?.trim()
    ) {
      issues.push("PROMO_CODE_HASH_KEY must be independent");
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
  const encoded = value?.trim();
  const decoded = encoded && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ? Buffer.from(encoded, "base64")
    : null;
  const canonical = decoded
    ? decoded.toString("base64").replace(/=+$/, "") ===
      encoded!.replace(/=+$/, "")
    : false;
  if (!decoded || decoded.length !== 32 || !canonical) {
    issues.push(`${name} must be a base64-encoded 32-byte key`);
  }
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
