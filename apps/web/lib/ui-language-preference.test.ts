import { describe, expect, it } from "vitest";
import { readExplicitGuestLocale, resolvePostLoginLocale } from "./ui-language-preference";

describe("independent interface preference", () => {
  it("does not mistake a routing cookie for an explicit guest choice", () => {
    expect(readExplicitGuestLocale("callassist_ui_locale=de; another=value")).toBeNull();
    expect(resolvePostLoginLocale({ explicitGuestLocale: null, accountLocale: "en", pageLocale: "de" })).toBe("en");
  });

  it("takes an explicit guest choice into the account on login", () => {
    const explicitGuestLocale = readExplicitGuestLocale("callassist_ui_locale=de; callassist_explicit_guest_locale=de");
    expect(resolvePostLoginLocale({ explicitGuestLocale, accountLocale: "en", pageLocale: "en" })).toBe("de");
  });

  it("falls back to an available page language for an unavailable account UI", () => {
    expect(readExplicitGuestLocale("callassist_explicit_guest_locale=ru")).toBeNull();
    expect(resolvePostLoginLocale({ explicitGuestLocale: null, accountLocale: "ru", pageLocale: "de" })).toBe("de");
  });
});
