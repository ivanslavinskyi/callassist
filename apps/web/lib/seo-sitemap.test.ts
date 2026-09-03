import type { PublishedContentIndex } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { buildSitemap } from "./seo-sitemap";

describe("published sitemap", () => {
  it("includes only available localizations with canonical alternates", () => {
    const index: PublishedContentIndex = {
      landing: {
        revision: {
          id: "81000000-0000-4000-8000-000000000003",
          number: 2,
          publishedAt: "2026-08-26T12:00:00.000Z"
        },
        sourceLocale: "en",
        localizations: [
          { locale: "en", seoTitle: "SHPROHLI", seoDescription: "English Landing description", translationStale: false },
          { locale: "de", seoTitle: "SHPROHLI", seoDescription: "Deutsche Landing-Beschreibung", translationStale: false }
        ]
      },
      pages: [{
        key: "support",
        pageType: "page",
        sourceLocale: "en",
        revision: {
          id: "20000000-0000-4000-8000-000000000004",
          number: 3,
          publishedAt: "2026-08-25T12:00:00.000Z"
        },
        localizations: [{
          locale: "en",
          slug: "support",
          title: "Support",
          seoTitle: "Support | SHPROHLI",
          seoDescription: "Support information for SHPROHLI users.",
          sourceRevisionNumber: 3,
          translationStale: false
        }]
      }, {
        key: "imprint",
        pageType: "page",
        sourceLocale: "en",
        revision: {
          id: "20000000-0000-4000-8000-000000000006",
          number: 1,
          publishedAt: "2026-09-02T00:00:00.000Z"
        },
        localizations: [
          { locale: "en", slug: "imprint", title: "Imprint", seoTitle: "Imprint | SHPROHLI", seoDescription: "Operator and contact information for SHPROHLI.", sourceRevisionNumber: 1, translationStale: false },
          { locale: "de", slug: "impressum", title: "Impressum", seoTitle: "Impressum | SHPROHLI", seoDescription: "Anbieter- und Kontaktangaben für SHPROHLI.", sourceRevisionNumber: 1, translationStale: false }
        ]
      }]
    };
    const sitemap = buildSitemap(index);
    expect(sitemap.map(({ url }) => url)).toEqual([
      "http://localhost:3000/en",
      "http://localhost:3000/de",
      "http://localhost:3000/en/support",
      "http://localhost:3000/en/imprint",
      "http://localhost:3000/de/impressum"
    ]);
    expect(sitemap[2]?.alternates?.languages).toEqual({
      en: "http://localhost:3000/en/support",
      "x-default": "http://localhost:3000/en/support"
    });
    expect(sitemap[0]?.lastModified).toBe("2026-08-26T12:00:00.000Z");
    expect(sitemap[1]?.lastModified).toBe("2026-08-26T12:00:00.000Z");
  });
});
