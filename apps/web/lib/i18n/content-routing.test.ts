import { describe, expect, it } from "vitest";
import {
  contentPath,
  switchContentLocale
} from "./content-routing";

describe("localized content routing", () => {
  it("maps logical pages to locale-specific slugs", () => {
    expect(contentPath("en", "privacy")).toBe("/en/privacy");
    expect(contentPath("de", "privacy")).toBe("/de/datenschutz");
    expect(contentPath("de", "acceptable_use")).toBe("/de/nutzungsregeln");
    expect(contentPath("en", "imprint")).toBe("/en/imprint");
    expect(contentPath("de", "imprint")).toBe("/de/impressum");
  });

  it("switches public content through the logical page instead of copying its slug", () => {
    expect(switchContentLocale("/en/privacy", "de")).toBe("/de/datenschutz");
    expect(switchContentLocale("/de/nutzungsbedingungen", "en")).toBe("/en/terms");
    expect(switchContentLocale("/en/imprint", "de")).toBe("/de/impressum");
    expect(switchContentLocale("/en/app", "de")).toBeNull();
  });
});
