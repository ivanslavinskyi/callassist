import type { User } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { adminAreaRedirect, authenticatedAppRedirect } from "./route-access";

const user: User = {
  id: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
  email: "nina@example.com",
  phoneE164: "+41791234567",
  phoneVerifiedAt: "2026-08-19T10:00:00.000Z",
  firstName: "Nina",
  lastName: "Keller",
  role: "user",
  status: "active",
  uiLocale: "de",
  createdAt: "2026-08-19T09:00:00.000Z",
  lastLoginAt: "2026-08-19T10:00:00.000Z"
};

describe("server route access decisions", () => {
  it("requires a session for the application tree", () => {
    expect(authenticatedAppRedirect(null, "de")).toBe("/de/login");
    expect(authenticatedAppRedirect(user, "de")).toBeNull();
  });

  it("allows only admin and superadmin roles into current admin pages", () => {
    expect(adminAreaRedirect(null, "en")).toBe("/en/login");
    expect(adminAreaRedirect(user, "en")).toBe("/en/app");
    expect(adminAreaRedirect({ ...user, role: "support" }, "en")).toBe("/en/app");
    expect(adminAreaRedirect({ ...user, role: "content_editor" }, "en")).toBe("/en/app");
    expect(adminAreaRedirect({ ...user, role: "admin" }, "en")).toBeNull();
    expect(adminAreaRedirect({ ...user, role: "superadmin" }, "en")).toBeNull();
  });
});
