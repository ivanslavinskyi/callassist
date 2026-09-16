import { describe, expect, it } from "vitest";
import { callLocaleSchema, isCallLanguageAvailable, isSelectableCallLocale, selectableCallLanguagesForRole } from "./call-brief";

describe("call language availability", () => {
  it.each([undefined, null, "user", "admin", "support", "content_editor"])("does not offer Russian to %s", (role) => {
    expect(selectableCallLanguagesForRole(role).map(item => item.locale)).toEqual(["de-CH", "fr-CH", "it-CH", "en-GB"]);
    expect(isSelectableCallLocale("ru-RU", role)).toBe(false);
  });
  it("keeps Russian available for superadmin and historical schemas readable", () => {
    expect(isSelectableCallLocale("ru-RU", "superadmin")).toBe(true);
    expect(selectableCallLanguagesForRole("superadmin").map(item => item.locale)).toContain("ru-RU");
    expect(callLocaleSchema.parse("ru-RU")).toBe("ru-RU");
    expect(isCallLanguageAvailable("en-US", "user")).toBe(true);
    expect(isSelectableCallLocale("en-US", "superadmin")).toBe(false);
  });
  it("keeps historical German calls readable without offering the retired variant", () => {
    expect(callLocaleSchema.parse("de-DE")).toBe("de-DE");
    expect(isCallLanguageAvailable("de-DE", "user")).toBe(true);
    expect(isSelectableCallLocale("de-DE", "superadmin")).toBe(false);
    expect(selectableCallLanguagesForRole("superadmin").map(item => item.locale)).toEqual(["de-CH", "fr-CH", "it-CH", "en-GB", "ru-RU"]);
  });
});
