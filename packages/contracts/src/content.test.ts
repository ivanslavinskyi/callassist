import { describe, expect, it } from "vitest";
import {
  contentDraftUpdateInputSchema,
  onboardingAcceptanceInputSchema,
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
});
