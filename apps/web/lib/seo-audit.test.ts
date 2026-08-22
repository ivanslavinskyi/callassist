import type { PublishedContentIndex } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { buildSeoAudit } from "./seo-audit";

const index: PublishedContentIndex = {
  pages: [{
    key: "privacy",
    pageType: "page",
    sourceLocale: "en",
    revision: {
      id: "20000000-0000-4000-8000-000000000001",
      number: 2,
      publishedAt: "2026-08-25T12:00:00.000Z"
    },
    localizations: [
      { locale: "de", slug: "datenschutz", title: "Datenschutz", seoTitle: "Datenschutz | CallAssist", seoDescription: "Kurze Beschreibung.", sourceRevisionNumber: 1, translationStale: true },
      { locale: "en", slug: "privacy", title: "Privacy notice", seoTitle: "Privacy notice for the CallAssist public beta", seoDescription: "Learn how CallAssist processes account, call, consent, recording, and transcript data during the supervised public beta.", sourceRevisionNumber: 2, translationStale: false }
    ]
  }]
};

describe("SEO audit", () => {
  it("reports published routes, alternates and actionable warnings", () => {
    const audit = buildSeoAudit(index);
    expect(audit).toHaveLength(4);
    const german = audit.find((route) => route.url.endsWith("/de/datenschutz"))!;
    expect(german).toMatchObject({
      revisionNumber: 2,
      translationStale: true,
      alternates: {
        de: "http://localhost:3000/de/datenschutz",
        en: "http://localhost:3000/en/privacy",
        "x-default": "http://localhost:3000/en/privacy"
      }
    });
    expect(german.issues).toEqual(expect.arrayContaining([
      "translation_stale",
      "description_short"
    ]));
  });
});
