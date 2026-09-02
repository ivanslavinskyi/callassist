import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { getAccountContactChangeErrorMessage } from "./account-messages";

describe("account contact-change errors", () => {
  it("distinguishes password, code, rate-limit, and delivery failures", () => {
    expect(getAccountContactChangeErrorMessage(
      new ApiError("INVALID_CREDENTIALS", 401),
      "en",
      "phone"
    )).toContain("password");
    expect(getAccountContactChangeErrorMessage(
      new ApiError("INVALID_EMAIL_CHANGE", 401),
      "en",
      "email"
    )).toContain("code");
    expect(getAccountContactChangeErrorMessage(
      new ApiError("RATE_LIMITED", 429),
      "de",
      "email"
    )).toContain("Versuche");
    expect(getAccountContactChangeErrorMessage(
      new ApiError("EMAIL_DELIVERY_UNAVAILABLE", 503),
      "de",
      "email"
    )).toContain("nicht verfügbar");
  });
});
