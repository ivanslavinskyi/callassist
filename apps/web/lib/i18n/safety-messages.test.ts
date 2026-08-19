import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { getOptOutErrorMessage } from "./opt-out-messages";
import { getSafetyErrorMessage } from "./safety-messages";

describe("recipient safety messages", () => {
  it("localizes public verification failures", () => {
    expect(getOptOutErrorMessage(
      new ApiError("INVALID_OPT_OUT_VERIFICATION", 401),
      "de"
    )).toBe("Der Bestätigungscode ist falsch oder abgelaufen.");
  });

  it("does not hide staff authorization failures behind a generic error", () => {
    expect(getSafetyErrorMessage(
      new ApiError("ADMIN_ACTION_FORBIDDEN", 403),
      "en"
    )).toBe("Your account is not allowed to perform this action.");
  });
});
