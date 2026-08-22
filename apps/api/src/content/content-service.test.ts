import { beforeEach, describe, expect, it } from "vitest";
import { ContentRepositoryError } from "./content-repository";
import { ContentService } from "./content-service";
import { InMemoryContentRepository } from "./in-memory-content-repository";
import { seededContentPages } from "./seed-content";

describe("ContentService", () => {
  let repository: InMemoryContentRepository;
  let service: ContentService;

  beforeEach(async () => {
    repository = new InMemoryContentRepository();
    service = new ContentService(
      repository,
      () => new Date("2026-08-22T12:00:00.000Z")
    );
    await service.initialize();
  });

  it("serves localized structured pages", async () => {
    await expect(service.getPublishedPage("de", "datenschutz")).resolves
      .toMatchObject({ key: "privacy", locale: "de", revision: { number: 1 } });
    await expect(service.getPublishedPage("en", "datenschutz")).resolves.toBeNull();
  });

  it("requires current Terms and AUP and retains append-only acceptance evidence", async () => {
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const initial = await service.getOnboardingStatus(userId, "de");
    expect(initial.required).toBe(true);

    const accepted = await service.acceptOnboarding(userId, {
      locale: "de",
      termsRevisionId: initial.current.terms.id,
      acceptableUseRevisionId: initial.current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    });
    expect(accepted).toMatchObject({
      required: false,
      accepted: { acceptedAt: "2026-08-22T12:00:00.000Z" }
    });
    expect(repository.acceptancesForTest()).toHaveLength(1);

    const revisionTwo = seededContentPages
      .filter(({ key }) => key === "terms")
      .map((page, index) => ({
        ...page,
        revisionLocalizationId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        revision: {
          ...page.revision,
          id: "60000000-0000-4000-8000-000000000002",
          number: 2,
          publishedAt: "2026-08-23T00:00:00.000Z"
        }
      }));
    await repository.initializeSeedContent(revisionTwo);
    await expect(service.getOnboardingStatus(userId, "de")).resolves
      .toMatchObject({ required: true, current: { terms: { revisionNumber: 2 } } });
  });

  it("rejects acceptance when a submitted legal revision is stale", async () => {
    const status = await service.getOnboardingStatus("user-id", "en");
    await expect(service.acceptOnboarding("user-id", {
      locale: "en",
      termsRevisionId: "70000000-0000-4000-8000-000000000001",
      acceptableUseRevisionId: status.current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    })).rejects.toMatchObject({
      code: "LEGAL_REVISION_CHANGED"
    } satisfies Partial<ContentRepositoryError>);
  });

  it("manages draft, preview, publish, history, and rollback without rewriting snapshots", async () => {
    const actorUserId = "a94f9676-2b25-48de-8537-0f858430f4f2";
    const before = await service.getAdminPage("privacy", "de");
    expect(before).toMatchObject({
      published: { title: "Datenschutzhinweise", revision: { number: 1 } },
      draft: null
    });

    await expect(service.createDraft(actorUserId, "privacy")).resolves
      .toMatchObject({ number: 2, status: "draft" });
    await expect(service.createDraft(actorUserId, "privacy")).rejects
      .toMatchObject({ code: "CONTENT_DRAFT_EXISTS" });
    await expect(service.updateDraft(actorUserId, "privacy", {
      locale: "de",
      title: "Aktualisierte Datenschutzhinweise",
      summary: before.published!.summary,
      sections: before.published!.sections,
      seoTitle: before.published!.seoTitle,
      seoDescription: before.published!.seoDescription,
      sourceRevisionNumber: 1,
      requiresReacceptance: true
    })).rejects.toMatchObject({ code: "CONTENT_REACCEPTANCE_INVALID" });

    await service.updateDraft(actorUserId, "privacy", {
      locale: "de",
      title: "Aktualisierte Datenschutzhinweise",
      summary: before.published!.summary,
      sections: before.published!.sections,
      seoTitle: before.published!.seoTitle,
      seoDescription: before.published!.seoDescription,
      sourceRevisionNumber: 1,
      requiresReacceptance: false
    });
    await expect(service.getAdminPreview("privacy", "de")).resolves
      .toMatchObject({
        title: "Aktualisierte Datenschutzhinweise",
        revision: { number: 2, status: "draft" }
      });
    await expect(service.getPublishedPage("de", "datenschutz")).resolves
      .toMatchObject({ title: "Datenschutzhinweise", revision: { number: 1 } });

    await service.publishDraft(
      actorUserId,
      "privacy",
      "Publish the reviewed privacy copy"
    );
    await expect(service.getPublishedPage("de", "datenschutz")).resolves
      .toMatchObject({
        title: "Aktualisierte Datenschutzhinweise",
        revision: { number: 2 }
      });
    await expect(service.listAdminRevisions("privacy")).resolves
      .toMatchObject([
        { number: 2, status: "published" },
        { number: 1, status: "published" }
      ]);

    await expect(service.createRollbackDraft(
      actorUserId,
      "privacy",
      1,
      "Restore the original reviewed copy"
    )).resolves.toMatchObject({ number: 3, status: "draft" });
    await expect(service.getAdminPreview("privacy", "de")).resolves
      .toMatchObject({ title: "Datenschutzhinweise", revision: { number: 3 } });
    expect(repository.adminEventsForTest().map(({ eventType }) => eventType))
      .toEqual([
        "content.draft_created",
        "content.draft_updated",
        "content.revision_published",
        "content.rollback_draft_created"
      ]);
  });

  it("forces re-acceptance after a material legal draft is published", async () => {
    const actorUserId = "48b5be1e-555c-4193-b60b-1bbfbbaac82a";
    const userId = "4978749b-efc6-4892-a145-d9438dd833cc";
    const initial = await service.getOnboardingStatus(userId, "en");
    await service.acceptOnboarding(userId, {
      locale: "en",
      termsRevisionId: initial.current.terms.id,
      acceptableUseRevisionId: initial.current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    });
    await service.createDraft(actorUserId, "terms");
    await service.publishDraft(
      actorUserId,
      "terms",
      "Publish a material Terms update"
    );
    await expect(service.getOnboardingStatus(userId, "de")).resolves
      .toMatchObject({
        required: true,
        current: { terms: { revisionNumber: 2 } }
      });
  });
});
