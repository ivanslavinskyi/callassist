import { describe, expect, it } from "vitest";
import { landingAction } from "./landing-action";
import { authenticatedAppRedirect } from "./route-access";
import type { User } from "@callassist/contracts";

describe("landing primary actions", () => {
  it.each(["en", "de"] as const)("preserves each CMS guest label and localized registration destination (%s)", locale => {
    for (const label of ["CMS hero CTA", "CMS final CTA", "Demo registration CTA"]) {
      expect(landingAction({ status: "anonymous" }, locale, `/${locale}/register`, label))
        .toEqual({ kind: "link", href: `/${locale}/register`, label });
    }
  });

  it.each(["en", "de"] as const)("routes every signed-in role through the application without an editor-specific CTA (%s)", locale => {
    for (const role of ["user", "support", "admin", "superadmin", "content_editor"] as const) {
      const action = landingAction({ status: "authenticated", user: { id: "user-1", role, emailVerified: false } }, locale, `/${locale}/register`, "Register");
      expect(action).toEqual({ kind: "link", href: `/${locale}/app`, label: locale === "de" ? "Anruf vorbereiten" : "Prepare a call" });
      // Entering the app still goes through the existing onboarding gate.
      expect(authenticatedAppRedirect({ role } as User, null, locale)).toBe(`/${locale}/onboarding`);
    }
  });

  it.each(["en", "de"] as const)("offers no registration destination while loading or unavailable (%s)", locale => {
    expect(landingAction({ status: "loading" }, locale, `/${locale}/register`, "Register").kind).toBe("loading");
    const failure = landingAction({ status: "unavailable" }, locale, `/${locale}/register`, "Register");
    expect(failure.kind).toBe("retry");
    expect(failure).not.toHaveProperty("href");
  });
});
