import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DATA_EXPORT_SCHEMA_VERSION,
  ACCOUNT_DELETION_CONFIRMATION,
  CALL_DATA_DELETION_CONFIRMATION,
  accountDataExportSchema,
  accountDeletionInputSchema,
  accountDeletionRequestSchema,
  callDataDeletionInputSchema,
  callDataDeletionResultSchema,
  accountSessionListSchema,
  accountStatusActionSchema,
  creditUsageSchema,
  loginInputSchema,
  passwordRecoveryCompleteInputSchema,
  passwordRecoveryCompleteResponseSchema,
  passwordRecoveryStartInputSchema,
  passwordRecoveryStartResponseSchema,
  passwordRecoveryVerifyInputSchema,
  passwordRecoveryVerifyResponseSchema,
  phoneChangeConfirmInputSchema,
  phoneChangeConfirmResponseSchema,
  phoneChangeStartInputSchema,
  phoneChangeStartResponseSchema,
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

  it("keeps password recovery payloads strict and tokens URL-safe", () => {
    expect(passwordRecoveryStartInputSchema.parse({
      email: " Nina.Keller@Example.com "
    })).toEqual({ email: "nina.keller@example.com" });
    expect(passwordRecoveryStartInputSchema.safeParse({
      email: validRegistration.email,
      revealAccount: true
    }).success).toBe(false);

    const recoveryId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const recoveryToken = "A".repeat(43);
    expect(passwordRecoveryStartResponseSchema.parse({
      status: "verification_required",
      recoveryId
    })).toMatchObject({ recoveryId });
    expect(passwordRecoveryVerifyInputSchema.safeParse({
      recoveryId,
      code: "123456"
    }).success).toBe(true);
    expect(passwordRecoveryVerifyResponseSchema.parse({
      status: "password_reset_required",
      recoveryToken
    })).toMatchObject({ recoveryToken });
    expect(passwordRecoveryCompleteInputSchema.safeParse({
      recoveryToken,
      newPassword: "a-new-long-password"
    }).success).toBe(true);
    expect(passwordRecoveryCompleteInputSchema.safeParse({
      recoveryToken: "not a URL-safe token",
      newPassword: "a-new-long-password"
    }).success).toBe(false);
    expect(passwordRecoveryCompleteResponseSchema.parse({
      status: "password_reset"
    })).toEqual({ status: "password_reset" });
  });

  it("keeps authenticated phone-change payloads strict", () => {
    const phoneChangeId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    expect(phoneChangeStartInputSchema.parse({
      newPhoneE164: " +41791234567 ",
      currentPassword: "a-long-test-password"
    })).toEqual({
      newPhoneE164: "+41791234567",
      currentPassword: "a-long-test-password"
    });
    expect(phoneChangeStartInputSchema.safeParse({
      newPhoneE164: "+41791234567",
      currentPassword: "a-long-test-password",
      userId: "not-client-controlled"
    }).success).toBe(false);
    expect(phoneChangeStartResponseSchema.parse({
      status: "verification_required",
      phoneChangeId
    })).toMatchObject({ phoneChangeId });
    expect(phoneChangeConfirmInputSchema.safeParse({
      phoneChangeId,
      code: "123456"
    }).success).toBe(true);
    expect(phoneChangeConfirmResponseSchema.parse({
      status: "phone_changed",
      user: {
        id: phoneChangeId,
        email: validRegistration.email,
        phoneE164: "+41791234567",
        phoneVerifiedAt: "2026-08-23T10:00:00.000Z",
        firstName: "Nina",
        lastName: "Keller",
        role: "user",
        status: "active",
        uiLocale: "de",
        createdAt: "2026-08-22T10:00:00.000Z",
        lastLoginAt: null
      },
      revokedSessionCount: 2
    })).toMatchObject({ status: "phone_changed", revokedSessionCount: 2 });
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

  it("requires an idempotency key, current password, and exact deletion phrase", () => {
    const request = callDataDeletionInputSchema.parse({
      requestId: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
      password: "a-long-test-password",
      confirmation: CALL_DATA_DELETION_CONFIRMATION
    });
    expect(request.confirmation).toBe("DELETE");
    expect(callDataDeletionInputSchema.safeParse({
      ...request,
      confirmation: "delete"
    }).success).toBe(false);
    expect(callDataDeletionInputSchema.safeParse({
      ...request,
      unexpected: true
    }).success).toBe(false);
    expect(callDataDeletionResultSchema.parse({
      requestId: request.requestId,
      deletedAt: "2026-08-22T10:00:00.000Z"
    })).toEqual({
      requestId: request.requestId,
      deletedAt: "2026-08-22T10:00:00.000Z"
    });
  });

  it("validates durable account deletion confirmation and owner-visible status", () => {
    const input = accountDeletionInputSchema.parse({
      requestId: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
      password: "a-long-test-password",
      confirmation: ACCOUNT_DELETION_CONFIRMATION
    });
    expect(input.confirmation).toBe("DELETE MY ACCOUNT");
    expect(accountDeletionInputSchema.safeParse({
      ...input,
      confirmation: "DELETE"
    }).success).toBe(false);
    expect(accountDeletionRequestSchema.parse({
      requestId: input.requestId,
      status: "retrying",
      attemptCount: 2,
      maxAttempts: 5,
      requestedAt: "2026-08-23T10:00:00.000Z",
      updatedAt: "2026-08-23T10:01:00.000Z",
      nextAttemptAt: "2026-08-23T10:02:00.000Z",
      completedAt: null,
      lastErrorCode: "PROVIDER_RECORDING_DELETE_FAILED"
    })).toMatchObject({ status: "retrying", attemptCount: 2 });
  });
});
