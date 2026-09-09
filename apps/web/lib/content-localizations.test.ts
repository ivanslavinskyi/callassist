import { describe, expect, it } from "vitest";
import { contentLanguageDirection, normalizeLocalizedList, normalizeLocalizedText } from "./content-localizations";

describe("CMS presentation language maps", () => {
  it("retains a third locale while editing and normalizing legacy EN/DE", () => {
    expect(normalizeLocalizedText({ en: " New English ", de: " Deutsch ", pl: " Polski " }))
      .toEqual({ en: "New English", de: "Deutsch", pl: "Polski" });
    expect(normalizeLocalizedList({ en: [" A "], de: [" B "], pl: [" C ", ""] }))
      .toEqual({ en: ["A"], de: ["B"], pl: ["C"] });
  });
  it("uses the language of the actual content for text direction", () => {
    expect(contentLanguageDirection("en")).toBe("ltr");
    expect(contentLanguageDirection("pl")).toBe("ltr");
    expect(contentLanguageDirection("ar")).toBe("rtl");
    expect(contentLanguageDirection("az-Arab")).toBe("rtl");
  });
});
