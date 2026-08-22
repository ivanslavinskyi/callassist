import { describe, expect, it } from "vitest";
import { publishedContentPageSchema } from "@callassist/contracts";
import { seededContentPages } from "./seed-content";

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
});
