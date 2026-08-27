import type { OnboardingStatus, User } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import {
  adminAreaRedirect,
  authenticatedAppRedirect,
  contentAdminRedirect,
  operationalAdminRedirect,
  onboardingPageRedirect
} from "./route-access";

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
const legalReferences: OnboardingStatus["current"] = {
  terms: {
    id: "20000000-0000-4000-8000-000000000002",
    key: "terms",
    revisionNumber: 1,
    locale: "en",
    slug: "terms",
    title: "Terms",
    publishedAt: "2026-08-22T00:00:00.000Z"
  },
  acceptableUse: {
    id: "20000000-0000-4000-8000-000000000003",
    key: "acceptable_use",
    revisionNumber: 1,
    locale: "en",
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    publishedAt: "2026-08-22T00:00:00.000Z"
  }
};
const required: OnboardingStatus = {
  required: true,
  current: legalReferences,
  accepted: null
};
const current: OnboardingStatus = {
  required: false,
  current: legalReferences,
  accepted: {
    termsRevisionId: legalReferences.terms.id,
    acceptableUseRevisionId: legalReferences.acceptableUse.id,
    acceptedAt: "2026-08-22T12:00:00.000Z"
  }
};

describe("server route access decisions", () => {
  it("requires a session for the application tree", () => {
    expect(authenticatedAppRedirect(null, null, "de")).toBe("/de/login");
    expect(authenticatedAppRedirect(user, required, "de")).toBe("/de/onboarding");
    expect(authenticatedAppRedirect(user, current, "de")).toBeNull();
    expect(authenticatedAppRedirect(
      { ...user, role: "content_editor" }, current, "de"
    )).toBe("/admin/content");
  });

  it("allows content staff into the shared admin tree", () => {
    expect(adminAreaRedirect(null, null, "en")).toBe("/en/login");
    expect(adminAreaRedirect(user, required, "en")).toBe("/en/onboarding");
    expect(adminAreaRedirect(user, current, "en")).toBe("/en/app");
    expect(adminAreaRedirect({ ...user, role: "support" }, current, "en")).toBe("/en/app");
    expect(adminAreaRedirect({ ...user, role: "content_editor" }, current, "en")).toBeNull();
    expect(adminAreaRedirect({ ...user, role: "admin" }, current, "en")).toBeNull();
    expect(adminAreaRedirect({ ...user, role: "superadmin" }, current, "en")).toBeNull();
  });

  it("separates content administration from operational administration", () => {
    const editor = { ...user, role: "content_editor" as const };
    expect(contentAdminRedirect(editor, current, "en")).toBeNull();
    expect(contentAdminRedirect(user, current, "en")).toBe("/en/app");
    expect(operationalAdminRedirect(editor, current, "en")).toBe("/admin/content");
    expect(operationalAdminRedirect({ ...user, role: "admin" }, current, "en")).toBeNull();
    expect(operationalAdminRedirect({ ...user, role: "superadmin" }, current, "en")).toBeNull();
  });

  it("keeps only users with current acceptance out of onboarding", () => {
    expect(onboardingPageRedirect(null, null, "de")).toBe("/de/login");
    expect(onboardingPageRedirect(user, required, "de")).toBeNull();
    expect(onboardingPageRedirect(user, current, "de")).toBe("/de/app");
    expect(onboardingPageRedirect(
      { ...user, role: "content_editor" }, current, "de"
    )).toBe("/admin/content");
  });
});
