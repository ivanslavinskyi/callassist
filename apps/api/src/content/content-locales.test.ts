import { randomUUID } from "node:crypto";
import {
  adminEditorialRevisionSchema,
  callLocaleSchema,
  contentDraftUpdateInputSchema,
  editorialDraftUpdateInputSchema,
  textLanguageSchema,
  type AdminContentLocalizedRevision
} from "@callassist/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentService } from "./content-service";
import { InMemoryContentRepository } from "./in-memory-content-repository";
import { seededEditorialCollections } from "./seed-content";

function localizedPage(source: AdminContentLocalizedRevision, locale: string, extra: Record<string, unknown> = {}) {
  return contentDraftUpdateInputSchema.parse({
    locale, title: `TEST ${locale}: ${source.title}`, summary: source.summary,
    sections: source.sections, seoTitle: source.seoTitle, seoDescription: source.seoDescription,
    sourceRevisionNumber: source.revision.sourceRevisionNumber,
    requiresReacceptance: source.revision.requiresReacceptance, ...extra
  });
}

describe("independent CMS languages", () => {
  let repository: InMemoryContentRepository;
  let service: ContentService;
  const actor = randomUUID();
  beforeEach(async () => {
    repository = new InMemoryContentRepository();
    service = new ContentService(repository);
    await service.initialize();
  });

  it("reads legacy JSON unchanged and accepts a third CMS locale without voice/text capability", () => {
    const revision = seededEditorialCollections.find(({ revision }) => revision.key === "faq")!.revision;
    expect(adminEditorialRevisionSchema.parse(revision).items).toEqual(revision.items);
    expect(textLanguageSchema.safeParse("pl").success).toBe(false);
    expect(callLocaleSchema.safeParse("pl").success).toBe(false);
    expect(editorialDraftUpdateInputSchema.safeParse({
      key: "faq", requiredLocales: ["en"], items: [{ id: randomUUID(), sortOrder: 0, enabled: true,
        question: { en: "Question", pl: "TEST pytanie" }, answer: { en: "Answer" }
      }]
    }).success).toBe(true);
  });

  it("falls back the whole FAQ and enforces only declared required locales", async () => {
    const original = (await service.getAdminEditorialCollection("faq")).published!;
    await service.createEditorialDraft(actor, "faq");
    await service.updateEditorialDraft(actor, "faq", editorialDraftUpdateInputSchema.parse({
      key: "faq", requiredLocales: ["en", "de"],
      items: [{ id: randomUUID(), sortOrder: 0, enabled: true,
        question: { en: "English question", de: "Deutsche Frage", pl: "TEST pytanie" },
        answer: { en: "English answer", de: "Deutsche Antwort" }
      }]
    }));
    await service.publishEditorialDraft(actor, "faq", "Test optional localization");
    expect(await service.getPublishedFaq("pl")).toMatchObject({
      locale: "en", items: [{ question: "English question", answer: "English answer" }]
    });
    await service.createEditorialDraft(actor, "faq");
    const draft = (await service.getAdminEditorialCollection("faq")).draft!;
    if (draft.key !== "faq") throw new Error("Unexpected fixture");
    await service.updateEditorialDraft(actor, "faq", { key: "faq", requiredLocales: ["en", "de", "pl"], items: draft.items });
    await expect(service.publishEditorialDraft(actor, "faq", "Missing required locale"))
      .rejects.toMatchObject({ code: "CONTENT_REQUIRED_LOCALE_MISSING" });
    await service.updateEditorialDraft(actor, "faq", {
      key: "faq", items: draft.items.map((item) => ({ ...item, answer: { ...item.answer, pl: "TEST odpowiedź" } }))
    });
    await service.publishEditorialDraft(actor, "faq", "Complete test locale");
    expect(await service.getPublishedFaq("pl")).toMatchObject({ locale: "pl", items: [{ answer: "TEST odpowiedź" }] });
    const historical = await service.listAdminEditorialRevisions("faq");
    expect(historical.find(({ id }) => id === original.id)).toMatchObject({ number: original.number, status: "published" });
    expect(original.items).toEqual(seededEditorialCollections.find(({ revision }) => revision.id === original.id)!.revision.items);
  });

  it("adds a page locale through draft data and supports explicit complete-document fallback", async () => {
    const source = (await service.getAdminPage("support", "en")).published!;
    expect(await service.getPublishedPage("pl", source.slug)).toBeNull();
    expect(await service.getPublishedPage("pl", source.slug, { allowFallback: true }))
      .toMatchObject({ locale: "en", title: source.title, sections: source.sections });
    await service.createDraft(actor, "support");
    await service.updateDraft(actor, "support", localizedPage(source, "en", { requiredLocales: ["en", "de", "pl"] }));
    await expect(service.publishDraft(actor, "support", "Incomplete language requirement"))
      .rejects.toMatchObject({ code: "CONTENT_REQUIRED_LOCALE_MISSING" });
    await service.updateDraft(actor, "support", localizedPage(source, "pl", { slug: "pomoc" }));
    await service.publishDraft(actor, "support", "Test third locale");
    expect(await service.getPublishedPage("pl", "pomoc")).toMatchObject({ locale: "pl", title: `TEST pl: ${source.title}` });
    expect((await service.listPublishedContentIndex()).pages.find(({ key }) => key === "support")?.localizations).toHaveLength(3);
    expect(await repository.getAdminRevision("support", "en", { revisionNumber: source.revision.number }))
      .toMatchObject({ title: source.title, sections: source.sections });
    const rollback = await service.createRollbackDraft(actor, "support", source.revision.number, "Restore original fixture");
    expect(rollback.requiredLocales).toEqual(["en", "de"]);
    await service.publishDraft(actor, "support", "Optional locale must not block original release");
    expect((await service.listPublishedContentIndex()).pages.find(({ key }) => key === "support")?.localizations).toHaveLength(2);
  });

  it("selects one common Terms/AUP locale and stores the actual language of acceptance", async () => {
    const userId = randomUUID();
    const terms = (await service.getAdminPage("terms", "en")).published!;
    await service.createDraft(actor, "terms");
    await service.updateDraft(actor, "terms", localizedPage(terms, "pl", { slug: "warunki" }));
    await service.publishDraft(actor, "terms", "Test third Terms language");
    const fallback = await service.getOnboardingStatus(userId, "pl");
    expect(fallback.current).toMatchObject({ terms: { locale: "en" }, acceptableUse: { locale: "en" } });
    await service.acceptOnboarding(userId, {
      locale: "pl", termsRevisionId: fallback.current.terms.id,
      acceptableUseRevisionId: fallback.current.acceptableUse.id,
      acceptTerms: true, acceptAcceptableUse: true,
      acknowledgeConsent: true, acknowledgeRetention: true, acknowledgeUseLimits: true, acknowledgeCredits: true
    });
    expect(await repository.listOnboardingAcceptances(userId)).toMatchObject([{ acceptedLocale: "en" }]);
    const aup = (await service.getAdminPage("acceptable_use", "en")).published!;
    await service.createDraft(actor, "acceptable_use");
    await service.updateDraft(actor, "acceptable_use", localizedPage(aup, "pl", { slug: "zasady" }));
    await service.publishDraft(actor, "acceptable_use", "Test third AUP language");
    expect((await service.getOnboardingStatus(userId, "pl")).current)
      .toMatchObject({ terms: { locale: "pl" }, acceptableUse: { locale: "pl" } });
    // Existing acceptance evidence remains the same language and revisions.
    expect(await repository.listOnboardingAcceptances(userId)).toMatchObject([{ acceptedLocale: "en", termsRevisionId: fallback.current.terms.id }]);
  });

  it("does not advertise a partially translated landing in the published index", async () => {
    await service.createEditorialDraft(actor, "landing");
    const draft = (await service.getAdminEditorialCollection("landing")).draft!;
    if (draft.key !== "landing") throw new Error("Unexpected fixture");
    await service.updateEditorialDraft(actor, "landing", {
      key: "landing", items: draft.items.map((block) => block.blockType === "hero"
        ? { ...block, seoTitle: { ...block.seoTitle, pl: "TEST title" }, seoDescription: { ...block.seoDescription, pl: "TEST description" } }
        : block)
    });
    await service.publishEditorialDraft(actor, "landing", "Publish EN DE with optional incomplete translation");
    expect(await service.getPublishedLanding("pl")).toMatchObject({ locale: "en" });
    expect((await service.listPublishedContentIndex()).landing?.localizations.map(({ locale }) => locale)).toEqual(["de", "en"]);
  });
});
