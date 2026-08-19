import { describe, expect, it } from "vitest";
import {
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
});
