import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { getCreditErrorMessage } from "./credit-messages";

describe("credit messages", () => {
  it("distinguishes invalid codes from exhausted user limits", () => {
    expect(getCreditErrorMessage(
      new ApiError("PROMO_CODE_UNAVAILABLE", 404),
      "en"
    )).toContain("invalid");
    expect(getCreditErrorMessage(
      new ApiError("PROMO_USER_LIMIT_REACHED", 409),
      "de"
    )).toContain("maximal");
  });

  it("explains administrative authorization failures", () => {
    expect(getCreditErrorMessage(
      new ApiError("CREDIT_ADMIN_ACTION_FORBIDDEN", 403),
      "en"
    )).toBe("Your account is not allowed to perform this action.");
  });
});
