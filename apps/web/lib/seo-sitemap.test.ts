import type { PublishedContentIndex } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { buildSitemap } from "./seo-sitemap";

describe("published sitemap", () => {
  it("includes only available localizations with canonical alternates", () => {
    const index: PublishedContentIndex = {
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
          seoTitle: "Support and safety | CallAssist",
          seoDescription: "Support and safety information for CallAssist users.",
          sourceRevisionNumber: 3,
          translationStale: false
        }]
      }]
    };
    const sitemap = buildSitemap(index);
    expect(sitemap.map(({ url }) => url)).toEqual([
      "http://localhost:3000/en",
      "http://localhost:3000/de",
      "http://localhost:3000/en/support"
    ]);
    expect(sitemap[2]?.alternates?.languages).toEqual({
      en: "http://localhost:3000/en/support",
      "x-default": "http://localhost:3000/en/support"
    });
  });
});
