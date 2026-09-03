import type {
  PublishedContentIndexPage,
  PublishedContentPage,
  PublishedLanding
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { contentPageMetadata, homeMetadata } from "./seo-metadata";

const page: PublishedContentPage = {
  key: "privacy",
  pageType: "page",
  sourceLocale: "en",
  locale: "de",
  slug: "datenschutz",
  title: "Datenschutz",
  summary: "Zusammenfassung",
  sections: [{ heading: "Daten", paragraphs: ["Details"], bullets: [] }],
  seoTitle: "Datenschutz | SHPROHLI",
  seoDescription: "Datenschutzinformationen für SHPROHLI.",
  revision: {
    id: "20000000-0000-4000-8000-000000000001",
    number: 2,
    requiresReacceptance: false,
    sourceRevisionNumber: 2,
    publishedAt: "2026-08-25T12:00:00.000Z"
  }
};
const indexPage: PublishedContentIndexPage = {
  key: "privacy",
  pageType: "page",
  sourceLocale: "en",
  revision: {
    id: page.revision.id,
    number: 2,
    publishedAt: page.revision.publishedAt
  },
  localizations: [
    { locale: "de", slug: "datenschutz", title: "Datenschutz", seoTitle: page.seoTitle, seoDescription: page.seoDescription, sourceRevisionNumber: 2, translationStale: false },
    { locale: "en", slug: "privacy", title: "Privacy", seoTitle: "Privacy | SHPROHLI", seoDescription: "Privacy information.", sourceRevisionNumber: 2, translationStale: false }
  ]
};
const landing: PublishedLanding = {
  revision: {
    id: "81000000-0000-4000-8000-000000000003",
    number: 3,
    publishedAt: "2026-08-26T12:00:00.000Z"
  },
  locale: "de",
  blocks: [],
  seo: {
    title: "Veröffentlichte Landing | SHPROHLI",
    description: "Die veröffentlichte CMS-Beschreibung der deutschen Landingpage."
  }
};

describe("public SEO metadata", () => {
  it("generates localized canonical, hreflang, OG, and Twitter metadata", () => {
    expect(contentPageMetadata(page, indexPage)).toMatchObject({
      alternates: {
        canonical: "/de/datenschutz",
        languages: {
          de: "/de/datenschutz",
          en: "/en/privacy",
          "x-default": "/en/privacy"
        }
      },
      robots: { index: true, follow: true },
      openGraph: {
        locale: "de_CH",
        alternateLocale: ["en_CH"],
        url: "/de/datenschutz"
      },
      twitter: { card: "summary_large_image" }
    });
  });

  it("gives both localized home pages canonical alternates", () => {
    expect(homeMetadata("de", landing)).toMatchObject({
      title: landing.seo.title,
      description: landing.seo.description,
      alternates: {
        canonical: "/de",
        languages: { en: "/en", de: "/de", "x-default": "/en" }
      }
    });
  });
});
