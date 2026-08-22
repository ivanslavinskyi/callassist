import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DATA_EXPORT_SCHEMA_VERSION,
  accountDataExportSchema,
  accountSessionListSchema,
  accountStatusActionSchema,
  creditUsageSchema,
  loginInputSchema,
  phoneVerificationInputSchema,
  registrationInputSchema,
  sessionRevocationActionSchema
} from "./account";

const validRegistration = {
  email: "nina.keller@example.com",
  password: "a-long-test-password",
  phoneE164: "+41710000000",
  firstName: "Nina",
  lastName: "Keller",
  uiLocale: "de" as const
};

describe("registrationInputSchema", () => {
  it("requires separate first and last names", () => {
    expect(registrationInputSchema.safeParse(validRegistration).success).toBe(true);

    const { lastName: _omitted, ...withoutLastName } = validRegistration;
    expect(registrationInputSchema.safeParse(withoutLastName).success).toBe(false);
    expect(
      registrationInputSchema.safeParse({ ...validRegistration, firstName: "" }).success
    ).toBe(false);
  });

  it("normalizes email casing and surrounding whitespace", () => {
    const parsed = registrationInputSchema.parse({
      ...validRegistration,
      email: "  Nina.Keller@Example.com  "
    });
    expect(parsed.email).toBe("nina.keller@example.com");
  });

  it("normalizes login and verification email addresses", () => {
    expect(
      loginInputSchema.parse({
        email: " Nina.Keller@Example.com ",
        password: "a-long-test-password"
      }).email
    ).toBe("nina.keller@example.com");
    expect(
      phoneVerificationInputSchema.parse({
        email: " Nina.Keller@Example.com ",
        code: "123456"
      }).email
    ).toBe("nina.keller@example.com");
  });

  it("validates reconciled credit usage without exposing idempotency keys", () => {
    const usage = creditUsageSchema.parse({
      balance: 2,
      activeCallBriefId: null,
      transactions: [
        {
          id: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
          amount: 3,
          type: "signup_grant",
          callAttemptId: null,
          promoRedemptionId: null,
          adminId: null,
          reason: "Phone verification signup grant",
          createdAt: "2026-08-19T10:00:00.000Z"
        }
      ]
    });
    expect(usage.balance).toBe(2);
    expect(creditUsageSchema.safeParse({ ...usage, balance: -1 }).success).toBe(false);
  });

  it("allows only reversible account statuses and requires an audit reason", () => {
    expect(accountStatusActionSchema.parse({
      status: "suspended",
      reason: "Repeated abuse report"
    })).toEqual({ status: "suspended", reason: "Repeated abuse report" });
    expect(accountStatusActionSchema.safeParse({
      status: "deleted",
      reason: "Not a reversible operation"
    }).success).toBe(false);
    expect(sessionRevocationActionSchema.safeParse({ reason: "  " }).success)
      .toBe(false);
  });

  it("keeps the account session inventory bounded and free of raw client data", () => {
    const inventory = accountSessionListSchema.parse({
      sessions: [{
        id: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
        browser: "firefox",
        platform: "linux",
        current: true,
        expiresAt: "2026-09-19T10:00:00.000Z",
        createdAt: "2026-08-19T10:00:00.000Z",
        lastSeenAt: "2026-08-20T10:00:00.000Z"
      }],
      totalActive: 1,
      truncated: false
    });

    expect(inventory.sessions[0]).not.toHaveProperty("tokenHash");
    expect(inventory.sessions[0]).not.toHaveProperty("userAgent");
    expect(accountSessionListSchema.safeParse({
      ...inventory,
      sessions: Array.from({ length: 51 }, () => inventory.sessions[0])
    }).success).toBe(false);
  });

  it("versions strict account exports without authentication secrets", () => {
    const exported = accountDataExportSchema.parse({
      schemaVersion: ACCOUNT_DATA_EXPORT_SCHEMA_VERSION,
      exportId: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
      generatedAt: "2026-08-22T10:00:00.000Z",
      account: {
        id: "f4e2bf73-e441-4dd2-976b-f949ad41b674",
        email: validRegistration.email,
        phoneE164: validRegistration.phoneE164,
        phoneVerifiedAt: "2026-08-19T10:00:00.000Z",
        firstName: validRegistration.firstName,
        lastName: validRegistration.lastName,
        role: "user",
        status: "active",
        uiLocale: validRegistration.uiLocale,
        createdAt: "2026-08-19T09:00:00.000Z",
        lastLoginAt: "2026-08-22T09:00:00.000Z"
      },
      activeSessions: { sessions: [], totalActive: 0, truncated: false },
      credits: { balance: 0, activeCallBriefId: null, transactions: [] },
      onboardingAcceptances: [],
      calls: []
    });
    expect(exported.schemaVersion).toBe("1");
    expect(accountDataExportSchema.safeParse({
      ...exported,
      tokenHash: "must-not-be-accepted"
    }).success).toBe(false);
    expect(accountDataExportSchema.safeParse({
      ...exported,
      schemaVersion: "2"
    }).success).toBe(false);
  });
});
