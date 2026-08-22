import { describe, expect, it } from "vitest";
import {
  RuntimeConfigurationError,
  validateRuntimeEnvironment
} from "./runtime-environment";

const key = Buffer.alloc(32, 7).toString("base64");

function productionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    STORAGE_DRIVER: "postgres",
    TELEPHONY_DRIVER: "twilio",
    DURABLE_WORKER_MODE: "external",
    DATABASE_URL: "postgresql://callassist:private@database.internal/callassist",
    DATA_ENCRYPTION_ACTIVE_KEY_ID: "primary-1",
    DATA_ENCRYPTION_KEY: key,
    DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "primary-1",
    PROMO_CODE_HASH_KEY: Buffer.alloc(32, 8).toString("base64"),
    OPENAI_API_KEY: "openai-private",
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "twilio-private",
    TWILIO_PHONE_NUMBER: "+41710000000",
    TWILIO_VERIFY_SERVICE_SID: "VA123",
    PUBLIC_BASE_URL: "https://calls.example.test",
    WEB_ORIGIN: "https://www.example.test,https://admin.example.test",
    VERIFICATION_DRIVER: "twilio",
    BRIEF_COMPILER_DRIVER: "openai",
    PORT: "4000",
    TWILIO_WEBHOOK_PORT: "4001"
  };
}

describe("production runtime configuration", () => {
  it("accepts a fail-closed API configuration", () => {
    expect(() => validateRuntimeEnvironment(
      productionEnvironment(),
      "api"
    )).not.toThrow();
  });

  it("keeps local development configuration flexible", () => {
    expect(() => validateRuntimeEnvironment({
      NODE_ENV: "development",
      STORAGE_DRIVER: "memory",
      TELEPHONY_DRIVER: "mock"
    }, "api")).not.toThrow();
  });

  it("rejects mock, local, shared-key and insecure production values", () => {
    const environment = productionEnvironment();
    environment.STORAGE_DRIVER = "memory";
    environment.TELEPHONY_DRIVER = "mock";
    environment.VERIFICATION_DRIVER = "mock";
    environment.BRIEF_COMPILER_DRIVER = "mock";
    environment.DATABASE_URL = "postgresql://user:password@localhost/db";
    environment.PUBLIC_BASE_URL = "http://localhost:4001";
    environment.WEB_ORIGIN = "http://localhost:3000";
    environment.PROMO_CODE_HASH_KEY = key;
    environment.TWILIO_WEBHOOK_PORT = "4000";

    expect(() => validateRuntimeEnvironment(environment, "api"))
      .toThrow(RuntimeConfigurationError);
    try {
      validateRuntimeEnvironment(environment, "api");
    } catch (error) {
      expect((error as RuntimeConfigurationError).issues).toEqual(
        expect.arrayContaining([
          "STORAGE_DRIVER must be postgres",
          "TELEPHONY_DRIVER must be twilio",
          "VERIFICATION_DRIVER must be twilio",
          "BRIEF_COMPILER_DRIVER must be openai",
          "DATABASE_URL must not use a loopback host",
          "PUBLIC_BASE_URL must contain only non-local HTTPS origins",
          "WEB_ORIGIN must contain only non-local HTTPS origins",
          "PROMO_CODE_HASH_KEY must be independent",
          "PORT and TWILIO_WEBHOOK_PORT must differ"
        ])
      );
      expect(error).not.toHaveProperty("message", expect.stringContaining(
        "twilio-private"
      ));
    }
  });

  it("keeps the promo HMAC key independent from retained data keys", () => {
    const environment = productionEnvironment();
    const previousKey = Buffer.alloc(32, 9).toString("base64");
    environment.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
      "primary-0": previousKey
    });
    environment.DATA_ENCRYPTION_LEGACY_V1_KEY_ID = "primary-0";
    environment.PROMO_CODE_HASH_KEY = previousKey;

    expect(() => validateRuntimeEnvironment(environment, "api"))
      .toThrow("PROMO_CODE_HASH_KEY must be independent");
  });

  it("does not require API-only verification and browser settings in a worker", () => {
    const environment = productionEnvironment();
    delete environment.PROMO_CODE_HASH_KEY;
    delete environment.TWILIO_VERIFY_SERVICE_SID;
    delete environment.WEB_ORIGIN;
    delete environment.VERIFICATION_DRIVER;
    delete environment.BRIEF_COMPILER_DRIVER;

    expect(() => validateRuntimeEnvironment(environment, "worker"))
      .not.toThrow();
  });

  it("rejects alternate loopback URL forms in production", () => {
    const environment = productionEnvironment();
    environment.DATABASE_URL = "postgresql://user:password@[::1]/db";
    environment.WEB_ORIGIN = "https://preview.localhost";

    expect(() => validateRuntimeEnvironment(environment, "api"))
      .toThrow(RuntimeConfigurationError);
    try {
      validateRuntimeEnvironment(environment, "api");
    } catch (error) {
      expect((error as RuntimeConfigurationError).issues).toEqual(
        expect.arrayContaining([
          "DATABASE_URL must not use a loopback host",
          "WEB_ORIGIN must contain only non-local HTTPS origins"
        ])
      );
    }
  });
});
