import type { PublishedContentIndex } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { buildSeoAudit } from "./seo-audit";

const index: PublishedContentIndex = {
  landing: {
    revision: {
      id: "81000000-0000-4000-8000-000000000003",
      number: 4,
      publishedAt: "2026-08-26T12:00:00.000Z"
    },
    sourceLocale: "en",
    localizations: [
      { locale: "en", seoTitle: "SHPROHLI — AI-assisted phone calls", seoDescription: "Everyday calls when speaking or the local language is a barrier.", translationStale: false },
      { locale: "de", seoTitle: "SHPROHLI — KI-unterstützte Telefonanrufe", seoDescription: "Alltägliche Anrufe, wenn Sprechen oder die lokale Sprache eine Barriere ist.", translationStale: false }
    ]
  },
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
      { locale: "de", slug: "datenschutz", title: "Datenschutz", seoTitle: "Datenschutz | SHPROHLI", seoDescription: "Kurze Beschreibung.", sourceRevisionNumber: 1, translationStale: true },
      { locale: "en", slug: "privacy", title: "Privacy notice", seoTitle: "Privacy Notice | SHPROHLI", seoDescription: "Learn how SHPROHLI processes account, call, consent, recording and transcript data.", sourceRevisionNumber: 2, translationStale: false }
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
    expect(audit.find((route) => route.url.endsWith("/de"))).toMatchObject({
      revisionNumber: 4,
      publishedAt: "2026-08-26T12:00:00.000Z"
    });
  });
});
