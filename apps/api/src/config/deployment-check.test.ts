import { describe, expect, it } from "vitest";
import { checkDeployment } from "./deployment-check";

function config(): NodeJS.ProcessEnv {
  return { STORAGE_DRIVER: "postgres", TELEPHONY_DRIVER: "twilio", VERIFICATION_DRIVER: "twilio", EMAIL_DRIVER: "resend",
    DURABLE_WORKER_MODE: "external", BRIEF_COMPILER_DRIVER: "openai", TEXT_PROCESSOR_DRIVER: "openai",
    TEXT_ARTIFACT_GENERATION_ENABLED: "true", TEXT_ARTIFACT_DIRECTIONS: "plan_review:de:en,call_summary:*:en",
    REALTIME_AGENT_HANGUP_ENABLED: "true", DATABASE_URL: "postgresql://fixture:fixture@database.internal/shprohli_test",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), DATA_ENCRYPTION_ACTIVE_KEY_ID: "test-1",
    DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "test-1", PROMO_CODE_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
    RATE_LIMIT_HASH_KEY: Buffer.alloc(32, 3).toString("base64"), EMAIL_VERIFICATION_HASH_KEY: Buffer.alloc(32, 4).toString("base64"),
    OPENAI_API_KEY: "fixture", TWILIO_ACCOUNT_SID: "ACfixture", TWILIO_AUTH_TOKEN: "fixture", TWILIO_PHONE_NUMBER: "+41710000000",
    TWILIO_VERIFY_SERVICE_SID: "VAfixture", TWILIO_OPT_OUT_VERIFY_SERVICE_SID: "VAoptout", RECIPIENT_CONTACT_HASH_KEY: Buffer.alloc(32, 13).toString("base64"), RESEND_API_KEY: "fixture", EMAIL_FROM: "mail@example.com",
    NEXT_PUBLIC_SITE_URL: "https://test.example.com", NEXT_PUBLIC_API_URL: "https://test.example.com",
    INTERNAL_API_URL: "http://api:4000", WEB_ORIGIN: "https://test.example.com", PUBLIC_BASE_URL: "https://voice-test.example.com",
    TRUSTED_PROXY_CIDRS: "10.40.0.2/32", TWILIO_WEBHOOK_HOST: "0.0.0.0" };
}
describe("deployment preflight", () => {
  it("checks both production entry points without claiming provider or release acceptance", () => {
    expect(checkDeployment(config())).toMatchObject({ configurationValid: true, issues: [], providerTraffic: false, databaseChecked: false, publicReleaseApproved: false });
  });
  it("accepts explicit production Native v2 without a local admission flag", () => {
    expect(checkDeployment({ ...config(), VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2" }))
      .toMatchObject({ configurationValid: true, issues: [], providerTraffic: false, databaseChecked: false });
  });
  it("accepts a single named profile and reports the pinned release without requiring low-level flags", () => {
    expect(checkDeployment({ ...config(), REALTIME_AGENT_HANGUP_ENABLED: undefined, CALL_RUNTIME_PROFILE: "native_v2" }))
      .toMatchObject({ configurationValid: true, databaseChecked: false, runtimeProfile: {
        name: "native_v2", compilerVersion: "brief-compiler-13", promptVersion: "preparation-live-native-integrity-2026-11-08"
      } });
  });
  it.each([undefined, "false"])("rejects Native v2 before dialing when hangup is %s", flag => {
    const report = checkDeployment({ ...config(), VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v2", REALTIME_AGENT_HANGUP_ENABLED: flag });
    expect(report.configurationValid).toBe(false);
    for (const runtime of ["api", "worker"]) {
      expect(report.issues).toContain(`${runtime}: native_v2 requires REALTIME_AGENT_HANGUP_ENABLED=true`);
    }
  });
  it("detects an SSR cookie split and untrusted proxy policy", () => {
    const report = checkDeployment({ ...config(), NEXT_PUBLIC_API_URL: "https://api.example.com", TRUSTED_PROXY_CIDRS: "true" });
    expect(report.configurationValid).toBe(false);
    expect(report.issues.some(i => i.includes("host-only session cookies"))).toBe(true);
    expect(report.issues.some(i => i.includes("TRUSTED_PROXY_CIDRS"))).toBe(true);
  });
  it("rejects local public addresses, mixed ingress and malformed text directions", () => {
    const report = checkDeployment({ ...config(), NEXT_PUBLIC_SITE_URL: "https://preview.localhost", PUBLIC_BASE_URL: "https://test.example.com",
      TEXT_ARTIFACT_DIRECTIONS: "plan_review:de:invented" });
    expect(report.configurationValid).toBe(false);
    expect(report.issues.some(i => i.includes("NEXT_PUBLIC_SITE_URL"))).toBe(true);
    expect(report.issues.some(i => i.includes("TEXT_ARTIFACT_DIRECTIONS"))).toBe(true);
    expect(checkDeployment({ ...config(), PUBLIC_BASE_URL: "https://test.example.com" }).issues.some(i => i.includes("Twilio-only listener"))).toBe(true);
  });
  it("does not expose secrets in invalid configuration diagnostics", () => {
    const secret = "DO-NOT-LOG-PRIVATE-VALUE";
    const report = checkDeployment({ ...config(), DATABASE_URL: secret, DATA_ENCRYPTION_KEY: secret, RESEND_API_KEY: secret,
      NEXT_PUBLIC_SITE_URL: `https://name:${secret}@example.com`, TRUSTED_PROXY_CIDRS: secret });
    expect(report.configurationValid).toBe(false);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});
