import {
  contentDraftUpdateInputSchema,
  editorialDraftUpdateInputSchema,
  type ContentPageKey
} from "@callassist/contracts";
import type { ContentService } from "./content-service";
import { seededContentPages, seededEditorialCollections } from "./seed-content";

const pageKeys: ContentPageKey[] = ["privacy", "terms", "acceptable_use", "faq", "imprint"];

/** Read-only candidate generation. Neither seeds, drafts nor acceptances are changed. */
export async function buildPublicContentReleaseCandidate(service: ContentService) {
  const pages = [];
  for (const key of pageKeys) {
    const translations = [];
    for (const locale of ["en", "de"] as const) {
      const source = await service.getAdminPage(key, locale);
      if (!source.published) throw new Error(`Missing published source: ${key}/${locale}`);
      const seed = seededContentPages.find((page) => page.key === key && page.locale === locale)!;
      translations.push({
        locale,
        sourceRevisionId: source.published.revision.id,
        sourceRevisionNumber: source.published.revision.number,
        existingDraftId: source.draft?.revision.id ?? null,
        payload: contentDraftUpdateInputSchema.parse({
          locale,
          title: seed.title,
          summary: seed.summary,
          sections: seed.sections,
          seoTitle: seed.seoTitle,
          seoDescription: seed.seoDescription,
          // Replace with the newly created draft's number when applying EN/DE.
          sourceRevisionNumber: source.published.revision.number + 1,
          requiresReacceptance: key === "terms" || key === "acceptable_use"
        })
      });
    }
    pages.push({ key, translations });
  }

  const collections = [];
  for (const key of ["landing", "faq"] as const) {
    const source = await service.getAdminEditorialCollection(key);
    if (!source.published) throw new Error(`Missing published collection: ${key}`);
    const seed = seededEditorialCollections.find((collection) => collection.revision.key === key)!;
    collections.push({
      key,
      sourceRevisionId: source.published.id,
      sourceRevisionNumber: source.published.number,
      existingDraftId: source.draft?.id ?? null,
      payload: editorialDraftUpdateInputSchema.parse({ key, items: seed.revision.items })
    });
  }

  return {
    // Stable identifier expected by the bounded staging workflow, not a copy timestamp.
    release: "public-copy-2026-09-09",
    status: "candidate_not_applied" as const,
    reason: "Align pre-call disclosure and explicit permission to book or confirm one bounded appointment, recipient-confirmed results, consent recognition, audio retention and connection-based promotional credits with implementation.",
    reacceptanceDecision: "New Terms and Acceptable Use revisions require renewed acceptance because supported use and processing disclosures change. Existing acceptance records remain unchanged.",
    publication: "Review all changes against the captured source revisions. Create new drafts through ContentService/admin API only when the source still matches and no draft exists. Never overwrite an existing draft. Resolve any conflict separately. Review previews, then publish through the existing workflow and record new revision IDs.",
    pages,
    collections
  };
}
