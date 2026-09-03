import { describe, expect, it } from "vitest";
import {
  adminEditorialRevisionSchema,
  publishedContentPageSchema
} from "@callassist/contracts";
import { seededContentPages, seededEditorialCollections } from "./seed-content";

describe("published seed copy", () => {
  it("contains a valid EN and DE publication with unique sections for every page", () => {
    const logicalPages = new Map<string, Set<string>>();

    for (const seededPage of seededContentPages) {
      const {
        pageId: _pageId,
        localizationId: _localizationId,
        revisionLocalizationId: _revisionLocalizationId,
        requiresReacceptanceOnUpgrade: _requiresReacceptanceOnUpgrade,
        ...publishedPage
      } = seededPage;
      expect(publishedContentPageSchema.safeParse(publishedPage).success).toBe(true);
      expect(new Set(publishedPage.sections.map(({ heading }) => heading)).size)
        .toBe(publishedPage.sections.length);

      const locales = logicalPages.get(publishedPage.key) ?? new Set<string>();
      locales.add(publishedPage.locale);
      logicalPages.set(publishedPage.key, locales);
    }

    expect(logicalPages.size).toBe(6);
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

  it("publishes the complete bilingual public information set", () => {
    const keys = new Set(seededContentPages.map(({ key }) => key));
    expect(keys).toEqual(new Set([
      "privacy", "terms", "acceptable_use", "support", "faq", "imprint"
    ]));
    expect(seededContentPages.filter(({ key }) => key === "imprint"))
      .toHaveLength(2);
  });

  it("keeps upgraded legal seeds from forcing a new acceptance", () => {
    for (const seed of seededContentPages.filter(({ key }) =>
      key === "terms" || key === "acceptable_use"
    )) {
      expect(seed.requiresReacceptanceOnUpgrade).toBe(false);
    }
  });

  it("uses voice-first consent copy and keeps keypad input as a fallback", () => {
    const english = seededContentPages
      .filter(({ locale }) => locale === "en")
      .map((seed) => JSON.stringify(seed))
      .join("\n");
    expect(english).toContain("asked for consent");
    expect(english).toContain("verbally first");
    expect(english).toContain("confirmation by keypad");
    expect(english).not.toMatch(/press(?:es)? 1/iu);
  });

  it("seeds eight FAQ entries and the intended public navigation", () => {
    const faq = seededEditorialCollections.find(({ revision }) => revision.key === "faq")!;
    const navigation = seededEditorialCollections.find(({ revision }) => revision.key === "navigation")!;
    expect(faq.revision.items).toHaveLength(8);
    expect(navigation.revision.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ location: "header", destination: "how_it_works" }),
      expect.objectContaining({ location: "footer", destination: "imprint" }),
      expect.objectContaining({ location: "footer", destination: "opt_out" })
    ]));
  });
});
