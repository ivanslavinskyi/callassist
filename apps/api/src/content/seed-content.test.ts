import { describe, expect, it } from "vitest";
import {
  adminEditorialRevisionSchema,
  publishedContentPageSchema
} from "@callassist/contracts";
import {
  seededContentPages,
  seededEditorialCollections
} from "./seed-content";

describe("seeded public content", () => {
  it("contains a valid EN and DE publication with unique sections for every page", () => {
    const logicalPages = new Map<string, Set<string>>();

    for (const seededPage of seededContentPages) {
      const {
        pageId: _pageId,
        localizationId: _localizationId,
        revisionLocalizationId: _revisionLocalizationId,
        ...publishedPage
      } = seededPage;
      expect(publishedContentPageSchema.safeParse(publishedPage).success).toBe(true);
      expect(new Set(
        publishedPage.sections.map(({ heading }) => heading)
      ).size).toBe(publishedPage.sections.length);

      const locales = logicalPages.get(publishedPage.key) ?? new Set<string>();
      locales.add(publishedPage.locale);
      logicalPages.set(publishedPage.key, locales);
    }

    expect(logicalPages.size).toBe(5);
    for (const locales of logicalPages.values()) {
      expect([...locales].sort()).toEqual(["de", "en"]);
    }
  });

  it("contains valid FAQ, Navigation, and bounded Landing publications", () => {
    expect(seededEditorialCollections.map(({ revision }) => revision.key).sort())
      .toEqual(["faq", "landing", "navigation"]);
    for (const { revision } of seededEditorialCollections) {
      expect(adminEditorialRevisionSchema.safeParse(revision).success).toBe(true);
    }
    const landing = seededEditorialCollections.find(
      ({ revision }) => revision.key === "landing"
    )!.revision;
    if (landing.key !== "landing") throw new Error("Expected Landing seed");
    expect(new Set(landing.items.map(({ blockType }) => blockType)).size).toBe(9);
  });
});
