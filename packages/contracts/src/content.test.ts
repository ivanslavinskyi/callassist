import { describe, expect, it } from "vitest";
import {
  contentDraftUpdateInputSchema,
  editorialDraftUpdateInputSchema,
  localizeLandingBlock,
  navigationItemSchema,
  onboardingAcceptanceInputSchema,
  publishedContentIndexSchema,
  publishedContentPageSchema
} from "./content";

describe("content and onboarding contracts", () => {
  it("accepts structured published content without arbitrary HTML", () => {
    const page = publishedContentPageSchema.parse({
      key: "privacy",
      pageType: "page",
      sourceLocale: "en",
      locale: "de",
      slug: "datenschutz",
      title: "Datenschutz",
      summary: "Wie CallAssist Daten verarbeitet.",
      sections: [{
        heading: "Verarbeitete Daten",
        paragraphs: ["CallAssist verarbeitet Kontodaten."],
        bullets: ["Telefonnummer", "Transkript"]
      }],
      seoTitle: "Datenschutz | CallAssist",
      seoDescription: "Datenschutzhinweise für CallAssist.",
      revision: {
        id: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
        number: 1,
        requiresReacceptance: false,
        sourceRevisionNumber: 1,
        publishedAt: "2026-08-22T10:00:00.000Z"
      }
    });
    expect(page.sections[0]?.bullets).toContain("Telefonnummer");
    expect(page).not.toHaveProperty("html");
  });

  it("requires every explicit onboarding acknowledgement", () => {
    const valid = {
      locale: "en",
      termsRevisionId: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
      acceptableUseRevisionId: "4b742964-54b4-457c-a9c6-91b30293189d",
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    } as const;
    expect(onboardingAcceptanceInputSchema.safeParse(valid).success).toBe(true);
    expect(onboardingAcceptanceInputSchema.safeParse({
      ...valid,
      acknowledgeConsent: false
    }).success).toBe(false);
  });

  it("validates bounded structured CMS drafts without accepting HTML blobs", () => {
    const draft = contentDraftUpdateInputSchema.parse({
      locale: "de",
      title: "Datenschutzhinweise",
      summary: "Wie CallAssist Daten verarbeitet.",
      sections: [{
        heading: "Verarbeitete Daten",
        paragraphs: ["CallAssist verarbeitet Kontodaten."],
        bullets: ["Telefonnummer", "Transkript"]
      }],
      seoTitle: "Datenschutzhinweise | CallAssist",
      seoDescription: "Datenschutzinformationen für CallAssist.",
      sourceRevisionNumber: 1,
      requiresReacceptance: false
    });
    expect(draft.sections).toHaveLength(1);
    expect(contentDraftUpdateInputSchema.safeParse({
      ...draft,
      sections: []
    }).success).toBe(false);
  });

  it("describes published localized SEO state and translation freshness", () => {
    expect(publishedContentIndexSchema.safeParse({
      pages: [{
        key: "privacy",
        pageType: "page",
        sourceLocale: "en",
        revision: {
          id: "20000000-0000-4000-8000-000000000001",
          number: 2,
          publishedAt: "2026-08-25T12:00:00.000Z"
        },
        localizations: [{
          locale: "de",
          slug: "datenschutz",
          title: "Datenschutz",
          seoTitle: "Datenschutz | CallAssist",
          seoDescription: "Datenschutzinformationen für CallAssist.",
          sourceRevisionNumber: 1,
          translationStale: true
        }]
      }],
      landing: null
    }).success).toBe(true);
  });

  it("accepts reusable bilingual FAQ items and internal-only navigation", () => {
    const id = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    expect(editorialDraftUpdateInputSchema.safeParse({
      key: "faq",
      items: [{
        id,
        sortOrder: 0,
        enabled: true,
        question: { en: "How?", de: "Wie?" },
        answer: { en: "Carefully.", de: "Sorgfältig." }
      }]
    }).success).toBe(true);
    expect(navigationItemSchema.safeParse({
      id,
      sortOrder: 0,
      enabled: true,
      location: "footer",
      destination: "privacy",
      label: { en: "Privacy", de: "Datenschutz" }
    }).success).toBe(true);
    expect(navigationItemSchema.safeParse({
      id,
      sortOrder: 0,
      enabled: true,
      location: "footer",
      destination: "https://example.com",
      label: { en: "External", de: "Extern" }
    }).success).toBe(false);
  });

  it("rejects unbounded Landing drafts that omit required block types", () => {
    expect(editorialDraftUpdateInputSchema.safeParse({
      key: "landing",
      items: []
    }).success).toBe(false);
  });

  it("localizes structured Landing blocks through one shared transformation", () => {
    const block = localizeLandingBlock({
      id: "72000000-0000-4000-8000-000000000001",
      blockType: "hero",
      sortOrder: 0,
      enabled: true,
      eyebrow: { en: "Accessible calls", de: "Barrierefreie Anrufe" },
      title: { en: "Your call", de: "Ihr Anruf" },
      lead: { en: "English lead", de: "Deutscher Einstieg" },
      badges: { en: ["Beta"], de: ["Beta"] },
      primaryCtaLabel: { en: "Try", de: "Testen" },
      secondaryCtaLabel: { en: "Sign in", de: "Anmelden" },
      seoTitle: { en: "English SEO", de: "Deutscher SEO-Titel" },
      seoDescription: { en: "English description", de: "Deutsche Beschreibung" }
    }, "de");
    expect(block).toMatchObject({
      blockType: "hero",
      title: "Ihr Anruf",
      seoTitle: "Deutscher SEO-Titel"
    });
  });
});
