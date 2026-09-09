import { describe, expect, it } from "vitest";
import { ContentService } from "./content-service";
import { InMemoryContentRepository } from "./in-memory-content-repository";
import { buildPublicContentReleaseCandidate } from "./public-content-release";

describe("public content release candidate", () => {
  it("captures exact sources and both FAQ surfaces without replacing a draft or publishing", async () => {
    const service = new ContentService(new InMemoryContentRepository());
    await service.initialize();
    const draft = await service.createEditorialDraft("46ccac03-8177-49ba-843c-b920c94d86cf", "faq");
    const before = await service.getAdminEditorialCollection("faq");
    const candidate = await buildPublicContentReleaseCandidate(service);

    expect(candidate.status).toBe("candidate_not_applied");
    const faq = candidate.collections.find((entry) => entry.key === "faq")!;
    expect(faq.sourceRevisionId).toBe(before.published?.id);
    expect(faq.existingDraftId).toBe(draft.id);
    expect(candidate.pages.find((entry) => entry.key === "faq")?.translations).toHaveLength(2);
    expect(await service.getAdminEditorialCollection("faq")).toEqual(before);
    expect(candidate.pages.flatMap((page) => page.translations).every((translation) =>
      translation.sourceRevisionNumber === 1 && translation.payload.sourceRevisionNumber === 2
    )).toBe(true);
  });

  it("keeps page and collection FAQ answers equivalent for each locale", async () => {
    const service = new ContentService(new InMemoryContentRepository());
    await service.initialize();
    for (const locale of ["en", "de"] as const) {
      const page = await service.getPublishedPage(locale, "faq");
      const collection = await service.getPublishedFaq(locale);
      expect(collection?.items.map((item) => [item.question, item.answer])).toEqual(
        page?.sections.map((section) => [section.heading, section.paragraphs.join("\n\n")])
      );
    }
  });
});
