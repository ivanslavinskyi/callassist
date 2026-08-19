import { describe, expect, it } from "vitest";
import {
  loginInputSchema,
  phoneVerificationInputSchema,
  registrationInputSchema
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
});
