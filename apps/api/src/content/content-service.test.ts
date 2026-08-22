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
});
