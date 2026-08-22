import { localizeLandingBlock } from "@callassist/contracts";
import type {
  AdminContentLocalizedRevision,
  AdminContentPageSummary,
  AdminContentRevisionSummary,
  AdminEditorialRevision,
  ContentDraftUpdateInput,
  ContentLocale,
  ContentPageKey,
  EditorialCollectionKey,
  EditorialDraftUpdateInput,
  EditorialRevisionSummary,
  OnboardingAcceptanceInput,
  OnboardingAcceptanceRecord,
  OnboardingStatus,
  PublishedContentIndex,
  PublishedContentPage,
  PublishedFaq,
  PublishedLanding,
  PublishedNavigation
} from "@callassist/contracts";
import { randomUUID } from "node:crypto";
import {
  ContentRepositoryError,
  type ContentRepository,
  type SeedContentPage,
  type SeedEditorialCollection
} from "./content-repository";

type Acceptance = {
  id: string;
  userId: string;
  input: OnboardingAcceptanceInput;
  acceptedAt: string;
};

type RevisionMetadata = {
  status: "draft" | "published";
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

type ContentAdminEvent = {
  eventType:
    | "content.draft_created"
    | "content.draft_updated"
    | "content.revision_published"
    | "content.rollback_draft_created";
  actorUserId: string;
  key: ContentPageKey;
  revisionId: string;
  sourceRevisionId: string | null;
  locale: ContentLocale | null;
  reason: string | null;
  createdAt: string;
};

type EditorialAdminEvent = {
  eventType:
    | "editorial.draft_created"
    | "editorial.draft_updated"
    | "editorial.revision_published"
    | "editorial.rollback_draft_created";
  actorUserId: string;
  key: EditorialCollectionKey;
  revisionId: string;
  sourceRevisionId: string | null;
  reason: string | null;
  createdAt: string;
};

export class InMemoryContentRepository implements ContentRepository {
  readonly mode = "memory" as const;
  readonly #pages: SeedContentPage[] = [];
  readonly #drafts: SeedContentPage[] = [];
  readonly #revisionMetadata = new Map<string, RevisionMetadata>();
  readonly #acceptances: Acceptance[] = [];
  readonly #adminEvents: ContentAdminEvent[] = [];
  readonly #editorialCollections = new Map<EditorialCollectionKey, {
    collectionId: string;
    revisions: AdminEditorialRevision[];
  }>();
  readonly #editorialAdminEvents: EditorialAdminEvent[] = [];

  async initializeSeedContent(pages: SeedContentPage[]) {
    for (const page of pages) {
      const exists = this.#pages.some((candidate) =>
        candidate.revision.id === page.revision.id &&
        candidate.locale === page.locale
      );
      if (!exists) this.#pages.push(structuredClone(page));
      if (!this.#revisionMetadata.has(page.revision.id)) {
        this.#revisionMetadata.set(page.revision.id, {
          status: "published",
          createdByUserId: null,
          createdAt: page.revision.publishedAt,
          updatedAt: page.revision.publishedAt,
          publishedAt: page.revision.publishedAt
        });
      }
    }
  }

  async initializeSeedEditorialCollections(
    collections: SeedEditorialCollection[]
  ) {
    for (const collection of collections) {
      const current = this.#editorialCollections.get(collection.revision.key) ?? {
        collectionId: collection.collectionId,
        revisions: []
      };
      if (!current.revisions.some(({ id }) => id === collection.revision.id)) {
        current.revisions.push(structuredClone(collection.revision));
      }
      this.#editorialCollections.set(collection.revision.key, current);
    }
  }

  async getPublishedPage(locale: ContentLocale, slug: string) {
    const page = this.#latestPublishedPages().find(
      (candidate) => candidate.locale === locale && candidate.slug === slug
    );
    return page ? toPublishedPage(page) : null;
  }

  async listPublishedContentIndex(): Promise<PublishedContentIndex> {
    const grouped = new Map<ContentPageKey, SeedContentPage[]>();
    for (const page of this.#latestPublishedPages()) {
      const pages = grouped.get(page.key) ?? [];
      pages.push(page);
      grouped.set(page.key, pages);
    }
    return {
      pages: [...grouped.entries()]
        .map(([key, pages]) => {
          const exemplar = pages[0]!;
          const source = pages.find(({ locale }) =>
            locale === exemplar.sourceLocale
          );
          const sourceRevisionNumber = source?.revision.sourceRevisionNumber ??
            exemplar.revision.number;
          return {
            key,
            pageType: exemplar.pageType,
            sourceLocale: exemplar.sourceLocale,
            revision: {
              id: exemplar.revision.id,
              number: exemplar.revision.number,
              publishedAt: exemplar.revision.publishedAt
            },
            localizations: pages
              .map((page) => ({
                locale: page.locale,
                slug: page.slug,
                title: page.title,
                seoTitle: page.seoTitle,
                seoDescription: page.seoDescription,
                sourceRevisionNumber: page.revision.sourceRevisionNumber,
                translationStale: page.locale !== exemplar.sourceLocale &&
                  page.revision.sourceRevisionNumber < sourceRevisionNumber
              }))
              .sort((left, right) => left.locale.localeCompare(right.locale))
          };
        })
        .sort((left, right) => left.key.localeCompare(right.key)),
      landing: this.#landingIndex()
    };
  }

  async getPublishedFaq(locale: ContentLocale): Promise<PublishedFaq | null> {
    const revision = this.#latestEditorial("faq", "published");
    if (!revision || revision.key !== "faq" || !revision.publishedAt) return null;
    return {
      locale,
      revision: {
        id: revision.id,
        number: revision.number,
        publishedAt: revision.publishedAt
      },
      items: revision.items
        .filter(({ enabled }) => enabled)
        .sort(bySortOrder)
        .map((item) => ({
          id: item.id,
          question: item.question[locale],
          answer: item.answer[locale]
        }))
    };
  }

  async getPublishedLanding(
    locale: ContentLocale
  ): Promise<PublishedLanding | null> {
    const revision = this.#latestEditorial("landing", "published");
    if (!revision || revision.key !== "landing" || !revision.publishedAt) {
      return null;
    }
    const hero = revision.items.find(({ blockType }) => blockType === "hero");
    if (!hero || hero.blockType !== "hero") return null;
    return {
      locale,
      revision: {
        id: revision.id,
        number: revision.number,
        publishedAt: revision.publishedAt
      },
      blocks: revision.items
        .filter(({ enabled }) => enabled)
        .sort(bySortOrder)
        .map((block) => localizeLandingBlock(block, locale)),
      seo: {
        title: hero.seoTitle[locale],
        description: hero.seoDescription[locale]
      }
    };
  }

  async getPublishedNavigation(
    locale: ContentLocale
  ): Promise<PublishedNavigation | null> {
    const revision = this.#latestEditorial("navigation", "published");
    if (!revision || revision.key !== "navigation" || !revision.publishedAt) {
      return null;
    }
    const items = revision.items
      .filter(({ enabled }) => enabled)
      .sort(bySortOrder)
      .flatMap((item) => {
        const href = this.#navigationHref(item.destination, locale);
        return href ? [{
          id: item.id,
          location: item.location,
          destination: item.destination,
          label: item.label[locale],
          href
        }] : [];
      });
    return {
      locale,
      revision: {
        id: revision.id,
        number: revision.number,
        publishedAt: revision.publishedAt
      },
      items
    };
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

  async listOnboardingAcceptances(
    userId: string
  ): Promise<OnboardingAcceptanceRecord[]> {
    return this.#acceptances
      .filter((acceptance) => acceptance.userId === userId)
      .sort((left, right) =>
        right.acceptedAt.localeCompare(left.acceptedAt) ||
        right.id.localeCompare(left.id)
      )
      .map(({ id, input, acceptedAt }) => ({
        id,
        termsRevisionId: input.termsRevisionId,
        acceptableUseRevisionId: input.acceptableUseRevisionId,
        acceptedLocale: input.locale,
        acceptedTerms: input.acceptTerms,
        acceptedAcceptableUse: input.acceptAcceptableUse,
        acknowledgedConsent: input.acknowledgeConsent,
        acknowledgedRetention: input.acknowledgeRetention,
        acknowledgedUseLimits: input.acknowledgeUseLimits,
        acknowledgedCredits: input.acknowledgeCredits,
        acceptedAt
      }));
  }

  async listAdminPages(): Promise<AdminContentPageSummary[]> {
    const keys = new Set(this.#pages.map(({ key }) => key));
    return [...keys].map((key) => {
      const publishedPages = this.#pagesForLatestPublishedRevision(key);
      const draftPages = this.#drafts.filter((page) => page.key === key);
      const routingPages = publishedPages.length ? publishedPages : draftPages;
      const exemplar = routingPages[0]!;
      return {
        key,
        pageType: exemplar.pageType,
        sourceLocale: exemplar.sourceLocale,
        localizations: routingPages.map(({ locale, slug }) => ({ locale, slug })),
        publishedRevision: publishedPages.length
          ? this.#summary(publishedPages)
          : null,
        draftRevision: draftPages.length ? this.#summary(draftPages) : null
      };
    });
  }

  async getAdminRevision(
    key: ContentPageKey,
    locale: ContentLocale,
    selector: { status: "draft" | "published" } | { revisionNumber: number }
  ): Promise<AdminContentLocalizedRevision | null> {
    const candidates = "revisionNumber" in selector
      ? [...this.#pages, ...this.#drafts].filter((page) =>
          page.key === key && page.revision.number === selector.revisionNumber
        )
      : selector.status === "draft"
        ? this.#drafts.filter((page) => page.key === key)
        : this.#pagesForLatestPublishedRevision(key);
    const page = candidates.find((candidate) => candidate.locale === locale);
    return page ? this.#localizedRevision(page) : null;
  }

  async listAdminRevisions(key: ContentPageKey) {
    const grouped = new Map<string, SeedContentPage[]>();
    for (const page of [...this.#pages, ...this.#drafts].filter(
      (candidate) => candidate.key === key
    )) {
      const group = grouped.get(page.revision.id) ?? [];
      group.push(page);
      grouped.set(page.revision.id, group);
    }
    return [...grouped.values()]
      .map((pages) => this.#summary(pages))
      .sort((left, right) => right.number - left.number);
  }

  async createDraft(actorUserId: string, key: ContentPageKey, createdAt: string) {
    if (this.#drafts.some((page) => page.key === key)) {
      throw new ContentRepositoryError("CONTENT_DRAFT_EXISTS");
    }
    const source = this.#pagesForLatestPublishedRevision(key);
    if (!source.length) throw new ContentRepositoryError("CONTENT_PAGE_NOT_FOUND");
    const draft = this.#copyAsDraft(source, actorUserId, createdAt);
    this.#adminEvents.push({
      eventType: "content.draft_created",
      actorUserId,
      key,
      revisionId: draft[0]!.revision.id,
      sourceRevisionId: source[0]!.revision.id,
      locale: null,
      reason: null,
      createdAt
    });
    return this.#summary(draft);
  }

  async updateDraft(
    actorUserId: string,
    key: ContentPageKey,
    input: ContentDraftUpdateInput,
    updatedAt: string
  ) {
    const draftPages = this.#drafts.filter((page) => page.key === key);
    const page = draftPages.find(({ locale }) => locale === input.locale);
    if (!page) throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
    Object.assign(page, {
      title: input.title,
      summary: input.summary,
      sections: structuredClone(input.sections),
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription
    });
    page.revision.sourceRevisionNumber = page.locale === page.sourceLocale
      ? page.revision.number
      : input.sourceRevisionNumber;
    for (const candidate of draftPages) {
      candidate.revision.requiresReacceptance = input.requiresReacceptance;
    }
    this.#revisionMetadata.get(page.revision.id)!.updatedAt = updatedAt;
    this.#adminEvents.push({
      eventType: "content.draft_updated",
      actorUserId,
      key,
      revisionId: page.revision.id,
      sourceRevisionId: null,
      locale: input.locale,
      reason: null,
      createdAt: updatedAt
    });
    return this.#localizedRevision(page);
  }

  async publishDraft(
    actorUserId: string,
    key: ContentPageKey,
    reason: string,
    publishedAt: string
  ) {
    const draftPages = this.#drafts.filter((page) => page.key === key);
    if (!draftPages.length) {
      throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
    }
    const revisionId = draftPages[0]!.revision.id;
    const metadata = this.#revisionMetadata.get(revisionId)!;
    metadata.status = "published";
    metadata.updatedAt = publishedAt;
    metadata.publishedAt = publishedAt;
    for (const page of draftPages) {
      page.revision.publishedAt = publishedAt;
      this.#pages.push(structuredClone(page));
    }
    this.#removeDraft(key);
    this.#adminEvents.push({
      eventType: "content.revision_published",
      actorUserId,
      key,
      revisionId,
      sourceRevisionId: null,
      locale: null,
      reason,
      createdAt: publishedAt
    });
    return this.#summary(this.#pages.filter(
      (page) => page.revision.id === revisionId
    ));
  }

  async createRollbackDraft(
    actorUserId: string,
    key: ContentPageKey,
    sourceRevisionNumber: number,
    reason: string,
    createdAt: string
  ) {
    if (this.#drafts.some((page) => page.key === key)) {
      throw new ContentRepositoryError("CONTENT_DRAFT_EXISTS");
    }
    const source = this.#pages.filter((page) =>
      page.key === key && page.revision.number === sourceRevisionNumber
    );
    if (!source.length) {
      throw new ContentRepositoryError("CONTENT_REVISION_NOT_FOUND");
    }
    const draft = this.#copyAsDraft(source, actorUserId, createdAt);
    this.#adminEvents.push({
      eventType: "content.rollback_draft_created",
      actorUserId,
      key,
      revisionId: draft[0]!.revision.id,
      sourceRevisionId: source[0]!.revision.id,
      locale: null,
      reason,
      createdAt
    });
    return this.#summary(draft);
  }

  async getAdminEditorialCollection(key: EditorialCollectionKey) {
    return {
      published: this.#latestEditorial(key, "published"),
      draft: this.#latestEditorial(key, "draft")
    };
  }

  async listAdminEditorialRevisions(
    key: EditorialCollectionKey
  ): Promise<EditorialRevisionSummary[]> {
    return (this.#editorialCollections.get(key)?.revisions ?? [])
      .map(editorialSummary)
      .sort((left, right) => right.number - left.number);
  }

  async createEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    createdAt: string
  ) {
    if (this.#latestEditorial(key, "draft")) {
      throw new ContentRepositoryError("EDITORIAL_DRAFT_EXISTS");
    }
    const source = this.#latestEditorial(key, "published");
    const collection = this.#editorialCollections.get(key);
    if (!source || !collection) {
      throw new ContentRepositoryError("EDITORIAL_COLLECTION_NOT_FOUND");
    }
    const draft = {
      ...structuredClone(source),
      id: randomUUID(),
      number: Math.max(...collection.revisions.map(({ number }) => number)) + 1,
      status: "draft" as const,
      createdByUserId: actorUserId,
      createdAt,
      updatedAt: createdAt,
      publishedAt: null
    } satisfies AdminEditorialRevision;
    collection.revisions.push(draft);
    this.#editorialAdminEvents.push({
      eventType: "editorial.draft_created",
      actorUserId,
      key,
      revisionId: draft.id,
      sourceRevisionId: source.id,
      reason: null,
      createdAt
    });
    return editorialSummary(draft);
  }

  async updateEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    input: EditorialDraftUpdateInput,
    updatedAt: string
  ) {
    if (input.key !== key) {
      throw new ContentRepositoryError("EDITORIAL_COLLECTION_MISMATCH");
    }
    const collection = this.#editorialCollections.get(key);
    const index = collection?.revisions.findIndex((revision) =>
      revision.status === "draft"
    ) ?? -1;
    if (!collection || index < 0) {
      throw new ContentRepositoryError("EDITORIAL_DRAFT_NOT_FOUND");
    }
    const current = collection.revisions[index]!;
    const updated = {
      ...current,
      key: input.key,
      items: structuredClone(input.items),
      updatedAt
    } as AdminEditorialRevision;
    collection.revisions[index] = updated;
    this.#editorialAdminEvents.push({
      eventType: "editorial.draft_updated",
      actorUserId,
      key,
      revisionId: updated.id,
      sourceRevisionId: null,
      reason: null,
      createdAt: updatedAt
    });
    return structuredClone(updated);
  }

  async publishEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    reason: string,
    publishedAt: string
  ) {
    const collection = this.#editorialCollections.get(key);
    const index = collection?.revisions.findIndex((revision) =>
      revision.status === "draft"
    ) ?? -1;
    if (!collection || index < 0) {
      throw new ContentRepositoryError("EDITORIAL_DRAFT_NOT_FOUND");
    }
    const draft = collection.revisions[index]!;
    if (draft.key === "navigation") this.#assertNavigationDestinations(draft);
    const published = {
      ...draft,
      status: "published" as const,
      updatedAt: publishedAt,
      publishedAt
    } as AdminEditorialRevision;
    collection.revisions[index] = published;
    this.#editorialAdminEvents.push({
      eventType: "editorial.revision_published",
      actorUserId,
      key,
      revisionId: published.id,
      sourceRevisionId: null,
      reason,
      createdAt: publishedAt
    });
    return editorialSummary(published);
  }

  async createEditorialRollbackDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    sourceRevisionNumber: number,
    reason: string,
    createdAt: string
  ) {
    if (this.#latestEditorial(key, "draft")) {
      throw new ContentRepositoryError("EDITORIAL_DRAFT_EXISTS");
    }
    const collection = this.#editorialCollections.get(key);
    const source = collection?.revisions.find((revision) =>
      revision.number === sourceRevisionNumber && revision.status === "published"
    );
    if (!collection || !source) {
      throw new ContentRepositoryError("EDITORIAL_REVISION_NOT_FOUND");
    }
    const draft = {
      ...structuredClone(source),
      id: randomUUID(),
      number: Math.max(...collection.revisions.map(({ number }) => number)) + 1,
      status: "draft" as const,
      createdByUserId: actorUserId,
      createdAt,
      updatedAt: createdAt,
      publishedAt: null
    } satisfies AdminEditorialRevision;
    collection.revisions.push(draft);
    this.#editorialAdminEvents.push({
      eventType: "editorial.rollback_draft_created",
      actorUserId,
      key,
      revisionId: draft.id,
      sourceRevisionId: source.id,
      reason,
      createdAt
    });
    return editorialSummary(draft);
  }

  acceptancesForTest() {
    return structuredClone(this.#acceptances);
  }

  adminEventsForTest() {
    return structuredClone(this.#adminEvents);
  }

  editorialAdminEventsForTest() {
    return structuredClone(this.#editorialAdminEvents);
  }

  async close() {}

  #latestPublishedPages() {
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

  #latestEditorial(
    key: EditorialCollectionKey,
    status: "draft" | "published"
  ): AdminEditorialRevision | null {
    const revision = (this.#editorialCollections.get(key)?.revisions ?? [])
      .filter((candidate) => candidate.status === status)
      .sort((left, right) => right.number - left.number)[0];
    return revision ? structuredClone(revision) : null;
  }

  #navigationHref(
    destination: PublishedNavigation["items"][number]["destination"],
    locale: ContentLocale
  ) {
    if (destination === "home") return `/${locale}`;
    if (destination === "opt_out") return `/${locale}/opt-out`;
    const page = this.#latestPublishedPages().find((candidate) =>
      candidate.key === destination && candidate.locale === locale
    );
    return page ? `/${locale}/${page.slug}` : null;
  }

  #landingIndex(): PublishedContentIndex["landing"] {
    const revision = this.#latestEditorial("landing", "published");
    if (!revision || revision.key !== "landing" || !revision.publishedAt) {
      return null;
    }
    const hero = revision.items.find(({ blockType }) => blockType === "hero");
    if (!hero || hero.blockType !== "hero") return null;
    return {
      revision: {
        id: revision.id,
        number: revision.number,
        publishedAt: revision.publishedAt
      },
      sourceLocale: "en",
      localizations: (["en", "de"] as const).map((locale) => ({
        locale,
        seoTitle: hero.seoTitle[locale],
        seoDescription: hero.seoDescription[locale],
        translationStale: false
      }))
    };
  }

  #assertNavigationDestinations(
    revision: Extract<AdminEditorialRevision, { key: "navigation" }>
  ) {
    const broken = revision.items.some((item) =>
      item.enabled && (["en", "de"] as const).some((locale) =>
        !this.#navigationHref(item.destination, locale)
      )
    );
    if (broken) {
      throw new ContentRepositoryError("EDITORIAL_DESTINATION_UNAVAILABLE");
    }
  }

  #pagesForLatestPublishedRevision(key: ContentPageKey) {
    const number = Math.max(
      0,
      ...this.#pages.filter((page) => page.key === key)
        .map((page) => page.revision.number)
    );
    return this.#pages.filter((page) =>
      page.key === key && page.revision.number === number
    );
  }

  #legalPage(
    key: Extract<ContentPageKey, "terms" | "acceptable_use">,
    locale: ContentLocale
  ) {
    const legalPages = this.#pages
      .filter((page) =>
        page.key === key &&
        page.locale === locale &&
        page.revision.requiresReacceptance
      )
      .sort((left, right) => right.revision.number - left.revision.number);
    const page = legalPages[0];
    if (!page) throw new ContentRepositoryError("LEGAL_CONTENT_UNAVAILABLE");
    return page;
  }

  #copyAsDraft(
    source: SeedContentPage[],
    actorUserId: string,
    createdAt: string
  ) {
    const revisionId = randomUUID();
    const revisionNumber = Math.max(
      0,
      ...this.#pages.filter(({ key }) => key === source[0]!.key)
        .map(({ revision }) => revision.number)
    ) + 1;
    const draft = source.map((page) => ({
      ...structuredClone(page),
      revisionLocalizationId: randomUUID(),
      revision: {
        ...page.revision,
        id: revisionId,
        number: revisionNumber,
        publishedAt: createdAt
      }
    }));
    this.#drafts.push(...draft);
    this.#revisionMetadata.set(revisionId, {
      status: "draft",
      createdByUserId: actorUserId,
      createdAt,
      updatedAt: createdAt,
      publishedAt: null
    });
    return draft;
  }

  #removeDraft(key: ContentPageKey) {
    for (let index = this.#drafts.length - 1; index >= 0; index -= 1) {
      if (this.#drafts[index]!.key === key) this.#drafts.splice(index, 1);
    }
  }

  #summary(pages: SeedContentPage[]): AdminContentRevisionSummary {
    const page = pages[0]!;
    const metadata = this.#revisionMetadata.get(page.revision.id)!;
    return {
      id: page.revision.id,
      number: page.revision.number,
      status: metadata.status,
      requiresReacceptance: page.revision.requiresReacceptance,
      createdByUserId: metadata.createdByUserId,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      publishedAt: metadata.publishedAt,
      locales: [...new Set(pages.map(({ locale }) => locale))]
    };
  }

  #localizedRevision(page: SeedContentPage): AdminContentLocalizedRevision {
    const metadata = this.#revisionMetadata.get(page.revision.id)!;
    const published = toPublishedPage(page);
    return {
      ...published,
      revision: {
        id: page.revision.id,
        number: page.revision.number,
        status: metadata.status,
        requiresReacceptance: page.revision.requiresReacceptance,
        sourceRevisionNumber: page.revision.sourceRevisionNumber,
        createdByUserId: metadata.createdByUserId,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        publishedAt: metadata.publishedAt
      }
    };
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

function editorialSummary(
  revision: AdminEditorialRevision
): EditorialRevisionSummary {
  const { key: _key, items: _items, ...summary } = revision;
  return structuredClone(summary);
}

function bySortOrder(
  left: { sortOrder: number },
  right: { sortOrder: number }
) {
  return left.sortOrder - right.sortOrder;
}
