import { describe, expect, it } from "vitest";
import {
  adminUserSearchSchema,
  adminUserSummarySchema
} from "./admin-users";

describe("admin user contracts", () => {
  it("bounds and normalizes search text", () => {
    expect(adminUserSearchSchema.parse("  nina@example.com  ")).toBe(
      "nina@example.com"
    );
    expect(adminUserSearchSchema.safeParse(" ").success).toBe(false);
  });

  it("exposes verification state without a phone number", () => {
    const summary = adminUserSummarySchema.parse({
      id: "34a9354c-3976-4b58-9610-65f36fe9bc72",
      email: "nina@example.com",
      firstName: "Nina",
      lastName: "Keller",
      role: "user",
      status: "active",
      phoneVerified: true,
      createdAt: "2026-08-19T10:00:00.000Z",
      lastLoginAt: null
    });
    expect(summary).not.toHaveProperty("phoneE164");
  });
});
