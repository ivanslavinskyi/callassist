import type {
  ContentLocale,
  ContentPageKey,
  OnboardingAcceptanceInput,
  OnboardingStatus,
  PublishedContentPage
} from "@callassist/contracts";
import { randomUUID } from "node:crypto";
import {
  ContentRepositoryError,
  type ContentRepository,
  type SeedContentPage
} from "./content-repository";

type Acceptance = {
  id: string;
  userId: string;
  input: OnboardingAcceptanceInput;
  acceptedAt: string;
};

export class InMemoryContentRepository implements ContentRepository {
  readonly mode = "memory" as const;
  readonly #pages: SeedContentPage[] = [];
  readonly #acceptances: Acceptance[] = [];

  async initializeSeedContent(pages: SeedContentPage[]) {
    for (const page of pages) {
      const exists = this.#pages.some((candidate) =>
        candidate.revision.id === page.revision.id &&
        candidate.locale === page.locale
      );
      if (!exists) this.#pages.push(structuredClone(page));
    }
  }

  async getPublishedPage(locale: ContentLocale, slug: string) {
    const page = this.#latestPages().find(
      (candidate) => candidate.locale === locale && candidate.slug === slug
    );
    return page ? toPublishedPage(page) : null;
  }

  async getOnboardingStatus(
    userId: string,
    locale: ContentLocale
  ): Promise<OnboardingStatus> {
    const terms = this.#legalPage("terms", locale);
    const acceptableUse = this.#legalPage("acceptable_use", locale);
    const latestAcceptance = this.#acceptances
      .filter((acceptance) => acceptance.userId === userId)
      .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))[0];
    const isCurrent = Boolean(
      latestAcceptance &&
      latestAcceptance.input.termsRevisionId === terms.revision.id &&
      latestAcceptance.input.acceptableUseRevisionId === acceptableUse.revision.id
    );
    return {
      required: !isCurrent,
      current: {
        terms: toLegalReference(terms),
        acceptableUse: toLegalReference(acceptableUse)
      },
      accepted: latestAcceptance ? {
        termsRevisionId: latestAcceptance.input.termsRevisionId,
        acceptableUseRevisionId: latestAcceptance.input.acceptableUseRevisionId,
        acceptedAt: latestAcceptance.acceptedAt
      } : null
    };
  }

  async hasCurrentAcceptance(userId: string) {
    return !(await this.getOnboardingStatus(userId, "en")).required;
  }

  async acceptOnboarding(
    userId: string,
    input: OnboardingAcceptanceInput,
    acceptedAt: string
  ) {
    const terms = this.#legalPage("terms", input.locale);
    const acceptableUse = this.#legalPage("acceptable_use", input.locale);
    if (
      terms.revision.id !== input.termsRevisionId ||
      acceptableUse.revision.id !== input.acceptableUseRevisionId
    ) {
      throw new ContentRepositoryError("LEGAL_REVISION_CHANGED");
    }
    const exists = this.#acceptances.some((acceptance) =>
      acceptance.userId === userId &&
      acceptance.input.termsRevisionId === input.termsRevisionId &&
      acceptance.input.acceptableUseRevisionId === input.acceptableUseRevisionId
    );
    if (!exists) {
      this.#acceptances.push({
        id: randomUUID(),
        userId,
        input: structuredClone(input),
        acceptedAt
      });
    }
  }

  acceptancesForTest() {
    return structuredClone(this.#acceptances);
  }

  async close() {}

  #latestPages() {
    const latest = new Map<string, SeedContentPage>();
    for (const page of this.#pages) {
      const key = `${page.key}:${page.locale}`;
      const current = latest.get(key);
      if (!current || page.revision.number > current.revision.number) {
        latest.set(key, page);
      }
    }
    return [...latest.values()];
  }

  #legalPage(key: Extract<ContentPageKey, "terms" | "acceptable_use">, locale: ContentLocale) {
    const page = this.#latestPages().find(
      (candidate) => candidate.key === key && candidate.locale === locale
    );
    if (!page) throw new ContentRepositoryError("LEGAL_CONTENT_UNAVAILABLE");
    return page;
  }
}

function toPublishedPage(page: SeedContentPage): PublishedContentPage {
  const {
    pageId: _pageId,
    localizationId: _localizationId,
    revisionLocalizationId: _revisionLocalizationId,
    ...published
  } = page;
  return structuredClone(published);
}

function toLegalReference(page: SeedContentPage) {
  return {
    id: page.revision.id,
    key: page.key as "terms" | "acceptable_use",
    revisionNumber: page.revision.number,
    locale: page.locale,
    slug: page.slug,
    title: page.title,
    publishedAt: page.revision.publishedAt
  };
}
