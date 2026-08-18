import { describe, expect, it } from "vitest";
import { localeFromPathname, localizePathname, negotiateUiLocale } from "./routing";

describe("UI locale routing", () => {
  it("reads only supported locale prefixes", () => {
    expect(localeFromPathname("/de/calls/123")).toBe("de");
    expect(localeFromPathname("/fr/calls/123")).toBeNull();
  });
  it("adds and replaces locale prefixes", () => {
    expect(localizePathname("/calls/123", "de")).toBe("/de/calls/123");
    expect(localizePathname("/en/calls/123", "de")).toBe("/de/calls/123");
    expect(localizePathname("/", "en")).toBe("/en");
  });
  it("prefers a valid persisted locale", () => {
    expect(negotiateUiLocale({ acceptLanguage: "en-GB", cookieLocale: "de" })).toBe("de");
  });
  it("matches regional browser languages and falls back to English", () => {
    expect(negotiateUiLocale({ acceptLanguage: "de-CH,de;q=.9" })).toBe("de");
    expect(negotiateUiLocale({ acceptLanguage: "fr-CH" })).toBe("en");
  });
});
