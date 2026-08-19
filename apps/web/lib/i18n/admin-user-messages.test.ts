import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { getAdminUserErrorMessage } from "./admin-user-messages";

describe("admin user messages", () => {
  it("does not mask permission-scoped not-found responses", () => {
    expect(getAdminUserErrorMessage(
      new ApiError("USER_NOT_FOUND", 404),
      "en"
    )).toContain("permission scope");
  });

  it("localizes invalid filters", () => {
    expect(getAdminUserErrorMessage(
      new ApiError("INVALID_ADMIN_USER_QUERY", 400),
      "de"
    )).toContain("Suchfilter");
  });
});
