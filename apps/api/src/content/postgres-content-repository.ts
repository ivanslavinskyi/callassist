import {
  adminEditorialRevisionSchema,
  localizeLandingBlock
} from "@callassist/contracts";
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
import postgres from "postgres";
import {
  ContentRepositoryError,
  type ContentRepository,
  type SeedContentPage,
  type SeedEditorialCollection
} from "./content-repository";

type DatabaseDate = Date | string;

type PublishedPageRow = Omit<
  PublishedContentPage,
  "sections" | "revision"
> & {
  sections: PublishedContentPage["sections"] | string;
  revisionId: string;
  revisionNumber: number;
  requiresReacceptance: boolean;
  sourceRevisionNumber: number;
  publishedAt: DatabaseDate;
};

type LegalReferenceRow = {
  id: string;
  key: "terms" | "acceptable_use";
  revisionNumber: number;
  locale: ContentLocale;
  slug: string;
  title: string;
  publishedAt: DatabaseDate;
};

type AcceptanceRow = {
  termsRevisionId: string;
  acceptableUseRevisionId: string;
  acceptedAt: DatabaseDate;
};

type AcceptanceExportRow = Omit<OnboardingAcceptanceRecord, "acceptedAt"> & {
  acceptedAt: DatabaseDate;
};

type RevisionSummaryRow = {
  id: string;
  number: number;
  status: "draft" | "published";
  requiresReacceptance: boolean;
  createdByUserId: string | null;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  publishedAt: DatabaseDate | null;
  locales: ContentLocale[];
};

type AdminPageRow = {
  key: ContentPageKey;
  pageType: "page" | "landing";
  sourceLocale: ContentLocale;
  localizations: Array<{ locale: ContentLocale; slug: string }> | string;
};

type AdminRevisionRow = Omit<
  AdminContentLocalizedRevision,
  "sections" | "revision"
> & {
  sections: AdminContentLocalizedRevision["sections"] | string;
  revisionId: string;
  revisionNumber: number;
  revisionStatus: "draft" | "published";
  requiresReacceptance: boolean;
  sourceRevisionNumber: number;
  createdByUserId: string | null;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  publishedAt: DatabaseDate | null;
};

type RevisionLocalizationCopyRow = {
  locale: ContentLocale;
  title: string;
  summary: string;
  sections: AdminContentLocalizedRevision["sections"] | string;
  seoTitle: string;
  seoDescription: string;
  sourceRevisionNumber: number;
};

type PublishedIndexRow = {
  key: ContentPageKey;
  pageType: "page" | "landing";
  sourceLocale: ContentLocale;
  revisionId: string;
  revisionNumber: number;
  publishedAt: DatabaseDate;
  locale: ContentLocale;
  slug: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  sourceRevisionNumber: number;
};

type ContentAdminEventType =
  | "content.draft_created"
  | "content.draft_updated"
  | "content.revision_published"
  | "content.rollback_draft_created";

type EditorialRevisionRow = {
  key: EditorialCollectionKey;
  id: string;
  number: number;
  status: "draft" | "published";
  snapshot: unknown[] | string;
  createdByUserId: string | null;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  publishedAt: DatabaseDate | null;
};

type EditorialAdminEventType =
  | "editorial.draft_created"
  | "editorial.draft_updated"
  | "editorial.revision_published"
  | "editorial.rollback_draft_created";

export class PostgresContentRepository implements ContentRepository {
  readonly mode = "postgres" as const;
  readonly #sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5, onnotice: () => undefined });
  }

  async initializeSeedContent(pages: SeedContentPage[]) {
    await this.#sql.begin(async (transaction) => {
      for (const page of pages) {
        const now = new Date(page.revision.publishedAt);
        await transaction`
          INSERT INTO content_pages (
            id, key, page_type, source_locale, created_at, updated_at
          ) VALUES (
            ${page.pageId}, ${page.key}, ${page.pageType}, ${page.sourceLocale},
            ${now}, ${now}
          ) ON CONFLICT (id) DO NOTHING
        `;
        await transaction`
          INSERT INTO content_page_localizations (
            id, page_id, locale, slug, created_at, updated_at
          ) VALUES (
            ${page.localizationId}, ${page.pageId}, ${page.locale}, ${page.slug},
            ${now}, ${now}
          ) ON CONFLICT (id) DO NOTHING
        `;
        await transaction`
          INSERT INTO content_page_revisions (
            id, page_id, revision_number, status, requires_reacceptance,
            created_by_user_id, created_at, updated_at, published_at
          ) VALUES (
            ${page.revision.id}, ${page.pageId}, ${page.revision.number},
            'published', ${page.revision.requiresReacceptance}, ${null},
            ${now}, ${now}, ${now}
          ) ON CONFLICT (id) DO NOTHING
        `;
        await transaction`
          INSERT INTO content_page_revision_localizations (
            id, revision_id, locale, title, summary, sections,
            seo_title, seo_description, source_revision_number, created_at,
            updated_at
          ) VALUES (
            ${page.revisionLocalizationId}, ${page.revision.id}, ${page.locale},
            ${page.title}, ${page.summary}, ${transaction.json(page.sections)},
            ${page.seoTitle}, ${page.seoDescription},
            ${page.revision.sourceRevisionNumber}, ${now}, ${now}
          ) ON CONFLICT (id) DO NOTHING
        `;
      }
    });
  }

  async initializeSeedEditorialCollections(
    collections: SeedEditorialCollection[]
  ) {
    await this.#sql.begin(async (transaction) => {
      for (const collection of collections) {
        const revision = collection.revision;
        const createdAt = new Date(revision.createdAt);
        await transaction`
          INSERT INTO content_editorial_collections (
            id, key, created_at, updated_at
          ) VALUES (
            ${collection.collectionId}, ${revision.key}, ${createdAt}, ${createdAt}
          ) ON CONFLICT (id) DO NOTHING
        `;
        await transaction`
          INSERT INTO content_editorial_revisions (
            id, collection_id, revision_number, status, snapshot,
            created_by_user_id, created_at, updated_at, published_at
          ) VALUES (
            ${revision.id}, ${collection.collectionId}, ${revision.number},
            'published', ${transaction.json(revision.items)}, ${null},
            ${createdAt}, ${new Date(revision.updatedAt)},
            ${new Date(revision.publishedAt!)}
          ) ON CONFLICT (id) DO NOTHING
        `;
      }
    });
  }

  async getPublishedPage(locale: ContentLocale, slug: string) {
    const [row] = await this.#sql<PublishedPageRow[]>`
      SELECT
        page.key AS "key",
        page.page_type AS "pageType",
        page.source_locale AS "sourceLocale",
        localization.locale AS "locale",
        localization.slug AS "slug",
        revision_localization.title AS "title",
        revision_localization.summary AS "summary",
        revision_localization.sections AS "sections",
        revision_localization.seo_title AS "seoTitle",
        revision_localization.seo_description AS "seoDescription",
        revision.id AS "revisionId",
        revision.revision_number AS "revisionNumber",
        revision.requires_reacceptance AS "requiresReacceptance",
        revision_localization.source_revision_number AS "sourceRevisionNumber",
        revision.published_at AS "publishedAt"
      FROM content_page_localizations localization
      JOIN content_pages page ON page.id = localization.page_id
      JOIN LATERAL (
        SELECT * FROM content_page_revisions candidate
        WHERE candidate.page_id = page.id AND candidate.status = 'published'
        ORDER BY candidate.revision_number DESC
        LIMIT 1
      ) revision ON true
      JOIN content_page_revision_localizations revision_localization
        ON revision_localization.revision_id = revision.id
        AND revision_localization.locale = localization.locale
      WHERE localization.locale = ${locale} AND localization.slug = ${slug}
      LIMIT 1
    `;
    return row ? mapPublishedPage(row) : null;
  }

  async listPublishedContentIndex(): Promise<PublishedContentIndex> {
    const rows = await this.#sql<PublishedIndexRow[]>`
      SELECT
        page.key AS "key",
        page.page_type AS "pageType",
        page.source_locale AS "sourceLocale",
        revision.id AS "revisionId",
        revision.revision_number AS "revisionNumber",
        revision.published_at AS "publishedAt",
        localization.locale AS "locale",
        localization.slug AS "slug",
        revision_localization.title AS "title",
        revision_localization.seo_title AS "seoTitle",
        revision_localization.seo_description AS "seoDescription",
        revision_localization.source_revision_number AS "sourceRevisionNumber"
      FROM content_pages page
      JOIN LATERAL (
        SELECT * FROM content_page_revisions candidate
        WHERE candidate.page_id = page.id AND candidate.status = 'published'
        ORDER BY candidate.revision_number DESC
        LIMIT 1
      ) revision ON true
      JOIN content_page_revision_localizations revision_localization
        ON revision_localization.revision_id = revision.id
      JOIN content_page_localizations localization
        ON localization.page_id = page.id
        AND localization.locale = revision_localization.locale
      ORDER BY page.key, localization.locale
    `;
    const grouped = new Map<ContentPageKey, PublishedIndexRow[]>();
    for (const row of rows) {
      const pages = grouped.get(row.key) ?? [];
      pages.push(row);
      grouped.set(row.key, pages);
    }
    const landingRevision = await this.#getEditorialRevision("landing", {
      status: "published"
    });
    return {
      pages: [...grouped.entries()].map(([key, pages]) => {
        const exemplar = pages[0]!;
        const source = pages.find(({ locale }) =>
          locale === exemplar.sourceLocale
        );
        const sourceRevisionNumber = source?.sourceRevisionNumber ??
          exemplar.revisionNumber;
        return {
          key,
          pageType: exemplar.pageType,
          sourceLocale: exemplar.sourceLocale,
          revision: {
            id: exemplar.revisionId,
            number: exemplar.revisionNumber,
            publishedAt: toIso(exemplar.publishedAt)
          },
          localizations: pages.map((page) => ({
            locale: page.locale,
            slug: page.slug,
            title: page.title,
            seoTitle: page.seoTitle,
            seoDescription: page.seoDescription,
            sourceRevisionNumber: page.sourceRevisionNumber,
            translationStale: page.locale !== exemplar.sourceLocale &&
              page.sourceRevisionNumber < sourceRevisionNumber
          }))
        };
      }),
      landing: landingRevision?.key === "landing" && landingRevision.publishedAt
        ? landingIndex(landingRevision)
        : null
    };
  }

  async getPublishedFaq(locale: ContentLocale): Promise<PublishedFaq | null> {
    const revision = await this.#getEditorialRevision("faq", {
      status: "published"
    });
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
        .sort(byEditorialSortOrder)
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
    const revision = await this.#getEditorialRevision("landing", {
      status: "published"
    });
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
        .sort(byEditorialSortOrder)
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
    const [revision, index] = await Promise.all([
      this.#getEditorialRevision("navigation", { status: "published" }),
      this.listPublishedContentIndex()
    ]);
    if (
      !revision || revision.key !== "navigation" || !revision.publishedAt
    ) return null;
    return {
      locale,
      revision: {
        id: revision.id,
        number: revision.number,
        publishedAt: revision.publishedAt
      },
      items: revision.items
        .filter(({ enabled }) => enabled)
        .sort(byEditorialSortOrder)
        .flatMap((item) => {
          const href = navigationHref(item.destination, locale, index);
          return href ? [{
            id: item.id,
            location: item.location,
            destination: item.destination,
            label: item.label[locale],
            href
          }] : [];
        })
    };
  }

  async getOnboardingStatus(
    userId: string,
    locale: ContentLocale
  ): Promise<OnboardingStatus> {
    const references = await this.#legalReferences(this.#sql, locale);
    const [accepted] = await this.#sql<AcceptanceRow[]>`
      SELECT
        terms_revision_id AS "termsRevisionId",
        acceptable_use_revision_id AS "acceptableUseRevisionId",
        accepted_at AS "acceptedAt"
      FROM user_onboarding_acceptances
      WHERE user_id = ${userId}
      ORDER BY accepted_at DESC, id DESC
      LIMIT 1
    `;
    const current = Boolean(
      accepted &&
      accepted.termsRevisionId === references.terms.id &&
      accepted.acceptableUseRevisionId === references.acceptableUse.id
    );
    return {
      required: !current,
      current: references,
      accepted: accepted ? {
        termsRevisionId: accepted.termsRevisionId,
        acceptableUseRevisionId: accepted.acceptableUseRevisionId,
        acceptedAt: toIso(accepted.acceptedAt)
      } : null
    };
  }

  async hasCurrentAcceptance(userId: string) {
    const references = await this.#legalReferences(this.#sql, "en");
    const [row] = await this.#sql<{ accepted: boolean }[]>`
      SELECT EXISTS(
        SELECT 1
        FROM user_onboarding_acceptances
        WHERE user_id = ${userId}
          AND terms_revision_id = ${references.terms.id}
          AND acceptable_use_revision_id = ${references.acceptableUse.id}
      ) AS accepted
    `;
    return row?.accepted ?? false;
  }

  async acceptOnboarding(
    userId: string,
    input: OnboardingAcceptanceInput,
    acceptedAt: string
  ) {
    await this.#sql.begin(async (transaction) => {
      const references = await this.#legalReferences(transaction, input.locale);
      if (
        references.terms.id !== input.termsRevisionId ||
        references.acceptableUse.id !== input.acceptableUseRevisionId
      ) {
        throw new ContentRepositoryError("LEGAL_REVISION_CHANGED");
      }
      try {
        await transaction`
          INSERT INTO user_onboarding_acceptances (
            id, user_id, terms_revision_id, acceptable_use_revision_id,
            accepted_locale, accepted_terms, accepted_acceptable_use,
            acknowledged_consent, acknowledged_retention,
            acknowledged_use_limits, acknowledged_credits, accepted_at
          ) VALUES (
            ${randomUUID()}, ${userId}, ${input.termsRevisionId},
            ${input.acceptableUseRevisionId}, ${input.locale},
            ${input.acceptTerms}, ${input.acceptAcceptableUse},
            ${input.acknowledgeConsent}, ${input.acknowledgeRetention},
            ${input.acknowledgeUseLimits}, ${input.acknowledgeCredits},
            ${new Date(acceptedAt)}
          )
          ON CONFLICT (user_id, terms_revision_id, acceptable_use_revision_id)
          DO NOTHING
        `;
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new ContentRepositoryError("USER_NOT_FOUND", { cause: error });
        }
        throw error;
      }
    });
  }

  async listOnboardingAcceptances(userId: string) {
    const rows = await this.#sql<AcceptanceExportRow[]>`
      SELECT
        id,
        terms_revision_id AS "termsRevisionId",
        acceptable_use_revision_id AS "acceptableUseRevisionId",
        accepted_locale AS "acceptedLocale",
        accepted_terms AS "acceptedTerms",
        accepted_acceptable_use AS "acceptedAcceptableUse",
        acknowledged_consent AS "acknowledgedConsent",
        acknowledged_retention AS "acknowledgedRetention",
        acknowledged_use_limits AS "acknowledgedUseLimits",
        acknowledged_credits AS "acknowledgedCredits",
        accepted_at AS "acceptedAt"
      FROM user_onboarding_acceptances
      WHERE user_id = ${userId}
      ORDER BY accepted_at DESC, id DESC
    `;
    return rows.map((row) => ({
      ...row,
      acceptedAt: toIso(row.acceptedAt)
    }));
  }

  async listAdminPages(): Promise<AdminContentPageSummary[]> {
    const rows = await this.#sql<AdminPageRow[]>`
      SELECT
        page.key AS "key",
        page.page_type AS "pageType",
        page.source_locale AS "sourceLocale",
        jsonb_agg(
          jsonb_build_object(
            'locale', localization.locale,
            'slug', localization.slug
          ) ORDER BY localization.locale
        ) AS "localizations"
      FROM content_pages page
      JOIN content_page_localizations localization
        ON localization.page_id = page.id
      GROUP BY page.id
      ORDER BY page.key
    `;
    return Promise.all(rows.map(async (row) => {
      const [publishedRevision, draftRevision] = await Promise.all([
        this.#revisionSummaryForKey(row.key, "published"),
        this.#revisionSummaryForKey(row.key, "draft")
      ]);
      const localizations = typeof row.localizations === "string"
        ? JSON.parse(row.localizations) as Array<{
            locale: ContentLocale;
            slug: string;
          }>
        : row.localizations;
      return {
        ...row,
        localizations,
        publishedRevision,
        draftRevision
      };
    }));
  }

  async getAdminRevision(
    key: ContentPageKey,
    locale: ContentLocale,
    selector: { status: "draft" | "published" } | { revisionNumber: number }
  ) {
    const byNumber = "revisionNumber" in selector;
    const status = byNumber ? null : selector.status;
    const revisionNumber = byNumber ? selector.revisionNumber : null;
    const rows = await this.#sql<AdminRevisionRow[]>`
      SELECT
        page.key AS "key",
        page.page_type AS "pageType",
        page.source_locale AS "sourceLocale",
        localization.locale AS "locale",
        localization.slug AS "slug",
        revision_localization.title AS "title",
        revision_localization.summary AS "summary",
        revision_localization.sections AS "sections",
        revision_localization.seo_title AS "seoTitle",
        revision_localization.seo_description AS "seoDescription",
        revision.id AS "revisionId",
        revision.revision_number AS "revisionNumber",
        revision.status AS "revisionStatus",
        revision.requires_reacceptance AS "requiresReacceptance",
        revision_localization.source_revision_number AS "sourceRevisionNumber",
        revision.created_by_user_id AS "createdByUserId",
        revision.created_at AS "createdAt",
        greatest(revision.updated_at, revision_localization.updated_at) AS "updatedAt",
        revision.published_at AS "publishedAt"
      FROM content_pages page
      JOIN content_page_localizations localization
        ON localization.page_id = page.id AND localization.locale = ${locale}
      JOIN content_page_revisions revision ON revision.page_id = page.id
      JOIN content_page_revision_localizations revision_localization
        ON revision_localization.revision_id = revision.id
        AND revision_localization.locale = localization.locale
      WHERE page.key = ${key}
        AND (${status}::text IS NULL OR revision.status = ${status})
        AND (${revisionNumber}::integer IS NULL
          OR revision.revision_number = ${revisionNumber})
      ORDER BY revision.revision_number DESC
      LIMIT 1
    `;
    return rows[0] ? mapAdminRevision(rows[0]) : null;
  }

  async listAdminRevisions(key: ContentPageKey) {
    const rows = await this.#sql<RevisionSummaryRow[]>`
      SELECT
        revision.id AS "id",
        revision.revision_number AS "number",
        revision.status AS "status",
        revision.requires_reacceptance AS "requiresReacceptance",
        revision.created_by_user_id AS "createdByUserId",
        revision.created_at AS "createdAt",
        revision.updated_at AS "updatedAt",
        revision.published_at AS "publishedAt",
        array_agg(revision_localization.locale ORDER BY revision_localization.locale)
          AS "locales"
      FROM content_page_revisions revision
      JOIN content_pages page ON page.id = revision.page_id
      JOIN content_page_revision_localizations revision_localization
        ON revision_localization.revision_id = revision.id
      WHERE page.key = ${key}
      GROUP BY revision.id
      ORDER BY revision.revision_number DESC
    `;
    return rows.map(mapRevisionSummary);
  }

  async createDraft(
    actorUserId: string,
    key: ContentPageKey,
    createdAt: string
  ) {
    const revisionId = await this.#sql.begin(async (transaction) => {
      const [page] = await transaction<{ id: string }[]>`
        SELECT id FROM content_pages WHERE key = ${key} FOR UPDATE
      `;
      if (!page) throw new ContentRepositoryError("CONTENT_PAGE_NOT_FOUND");
      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM content_page_revisions
        WHERE page_id = ${page.id} AND status = 'draft'
      `;
      if (existing) throw new ContentRepositoryError("CONTENT_DRAFT_EXISTS");
      const [source] = await transaction<{
        id: string;
        number: number;
        requiresReacceptance: boolean;
      }[]>`
        SELECT
          id,
          revision_number AS "number",
          requires_reacceptance AS "requiresReacceptance"
        FROM content_page_revisions
        WHERE page_id = ${page.id} AND status = 'published'
        ORDER BY revision_number DESC
        LIMIT 1
      `;
      if (!source) throw new ContentRepositoryError("CONTENT_REVISION_NOT_FOUND");
      return this.#copyRevisionToDraft(transaction, {
        actorUserId,
        pageId: page.id,
        sourceRevisionId: source.id,
        revisionNumber: source.number + 1,
        requiresReacceptance: source.requiresReacceptance,
        eventType: "content.draft_created",
        reason: null,
        createdAt
      });
    });
    return this.#requireRevisionSummary(revisionId);
  }

  async updateDraft(
    actorUserId: string,
    key: ContentPageKey,
    input: ContentDraftUpdateInput,
    updatedAt: string
  ) {
    await this.#sql.begin(async (transaction) => {
      const [draft] = await transaction<{
        id: string;
        pageId: string;
        revisionNumber: number;
        sourceLocale: ContentLocale;
      }[]>`
        SELECT
          revision.id,
          revision.page_id AS "pageId",
          revision.revision_number AS "revisionNumber",
          page.source_locale AS "sourceLocale"
        FROM content_page_revisions revision
        JOIN content_pages page ON page.id = revision.page_id
        WHERE page.key = ${key} AND revision.status = 'draft'
        FOR UPDATE OF revision
      `;
      if (!draft) throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
      const sourceRevisionNumber = input.locale === draft.sourceLocale
        ? draft.revisionNumber
        : input.sourceRevisionNumber;
      await transaction`
        UPDATE content_page_revisions
        SET requires_reacceptance = ${input.requiresReacceptance},
            updated_at = ${new Date(updatedAt)}
        WHERE id = ${draft.id}
      `;
      const updated = await transaction`
        UPDATE content_page_revision_localizations
        SET title = ${input.title},
            summary = ${input.summary},
            sections = ${transaction.json(input.sections)},
            seo_title = ${input.seoTitle},
            seo_description = ${input.seoDescription},
            source_revision_number = ${sourceRevisionNumber},
            updated_at = ${new Date(updatedAt)}
        WHERE revision_id = ${draft.id} AND locale = ${input.locale}
        RETURNING id
      `;
      if (!updated.count) {
        throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
      }
      await this.#insertAdminEvent(transaction, {
        eventType: "content.draft_updated",
        actorUserId,
        pageId: draft.pageId,
        revisionId: draft.id,
        sourceRevisionId: null,
        locale: input.locale,
        reason: null,
        createdAt: updatedAt
      });
    });
    const draft = await this.getAdminRevision(key, input.locale, { status: "draft" });
    if (!draft) throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
    return draft;
  }

  async publishDraft(
    actorUserId: string,
    key: ContentPageKey,
    reason: string,
    publishedAt: string
  ) {
    const revisionId = await this.#sql.begin(async (transaction) => {
      const [draft] = await transaction<{
        id: string;
        pageId: string;
        expectedLocales: number;
        actualLocales: number;
      }[]>`
        SELECT
          revision.id,
          revision.page_id AS "pageId",
          (SELECT count(*)::integer FROM content_page_localizations route
            WHERE route.page_id = revision.page_id) AS "expectedLocales",
          (SELECT count(*)::integer FROM content_page_revision_localizations content
            WHERE content.revision_id = revision.id) AS "actualLocales"
        FROM content_page_revisions revision
        JOIN content_pages page ON page.id = revision.page_id
        WHERE page.key = ${key} AND revision.status = 'draft'
        FOR UPDATE OF revision
      `;
      if (!draft) throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
      if (draft.actualLocales !== draft.expectedLocales) {
        throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
      }
      await transaction`
        UPDATE content_page_revisions
        SET status = 'published',
            published_at = ${new Date(publishedAt)},
            updated_at = ${new Date(publishedAt)}
        WHERE id = ${draft.id}
      `;
      await this.#insertAdminEvent(transaction, {
        eventType: "content.revision_published",
        actorUserId,
        pageId: draft.pageId,
        revisionId: draft.id,
        sourceRevisionId: null,
        locale: null,
        reason,
        createdAt: publishedAt
      });
      return draft.id;
    });
    return this.#requireRevisionSummary(revisionId);
  }

  async createRollbackDraft(
    actorUserId: string,
    key: ContentPageKey,
    sourceRevisionNumber: number,
    reason: string,
    createdAt: string
  ) {
    const revisionId = await this.#sql.begin(async (transaction) => {
      const [page] = await transaction<{ id: string }[]>`
        SELECT id FROM content_pages WHERE key = ${key} FOR UPDATE
      `;
      if (!page) throw new ContentRepositoryError("CONTENT_PAGE_NOT_FOUND");
      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM content_page_revisions
        WHERE page_id = ${page.id} AND status = 'draft'
      `;
      if (existing) throw new ContentRepositoryError("CONTENT_DRAFT_EXISTS");
      const [source] = await transaction<{
        id: string;
        requiresReacceptance: boolean;
      }[]>`
        SELECT id, requires_reacceptance AS "requiresReacceptance"
        FROM content_page_revisions
        WHERE page_id = ${page.id}
          AND revision_number = ${sourceRevisionNumber}
          AND status = 'published'
      `;
      if (!source) throw new ContentRepositoryError("CONTENT_REVISION_NOT_FOUND");
      const [numberRow] = await transaction<{ nextNumber: number }[]>`
        SELECT (max(revision_number) + 1)::integer AS "nextNumber"
        FROM content_page_revisions WHERE page_id = ${page.id}
      `;
      return this.#copyRevisionToDraft(transaction, {
        actorUserId,
        pageId: page.id,
        sourceRevisionId: source.id,
        revisionNumber: numberRow!.nextNumber,
        requiresReacceptance: source.requiresReacceptance,
        eventType: "content.rollback_draft_created",
        reason,
        createdAt
      });
    });
    return this.#requireRevisionSummary(revisionId);
  }

  async getAdminEditorialCollection(key: EditorialCollectionKey) {
    const [published, draft] = await Promise.all([
      this.#getEditorialRevision(key, { status: "published" }),
      this.#getEditorialRevision(key, { status: "draft" })
    ]);
    return { published, draft };
  }

  async listAdminEditorialRevisions(
    key: EditorialCollectionKey
  ): Promise<EditorialRevisionSummary[]> {
    const rows = await this.#sql<EditorialRevisionRow[]>`
      SELECT
        collection.key AS "key",
        revision.id AS "id",
        revision.revision_number AS "number",
        revision.status AS "status",
        revision.snapshot AS "snapshot",
        revision.created_by_user_id AS "createdByUserId",
        revision.created_at AS "createdAt",
        revision.updated_at AS "updatedAt",
        revision.published_at AS "publishedAt"
      FROM content_editorial_revisions revision
      JOIN content_editorial_collections collection
        ON collection.id = revision.collection_id
      WHERE collection.key = ${key}
      ORDER BY revision.revision_number DESC
    `;
    return rows.map((row) => editorialSummary(mapEditorialRevision(row)));
  }

  async createEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    createdAt: string
  ) {
    const revisionId = await this.#sql.begin(async (transaction) => {
      const [collection] = await transaction<{ id: string }[]>`
        SELECT id FROM content_editorial_collections
        WHERE key = ${key} FOR UPDATE
      `;
      if (!collection) {
        throw new ContentRepositoryError("EDITORIAL_COLLECTION_NOT_FOUND");
      }
      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM content_editorial_revisions
        WHERE collection_id = ${collection.id} AND status = 'draft'
      `;
      if (existing) throw new ContentRepositoryError("EDITORIAL_DRAFT_EXISTS");
      const [source] = await transaction<{
        id: string;
        number: number;
        snapshot: unknown[] | string;
      }[]>`
        SELECT id, revision_number AS "number", snapshot
        FROM content_editorial_revisions
        WHERE collection_id = ${collection.id} AND status = 'published'
        ORDER BY revision_number DESC
        LIMIT 1
      `;
      if (!source) {
        throw new ContentRepositoryError("EDITORIAL_REVISION_NOT_FOUND");
      }
      return this.#copyEditorialRevisionToDraft(transaction, {
        actorUserId,
        collectionId: collection.id,
        sourceRevisionId: source.id,
        revisionNumber: source.number + 1,
        snapshot: parseJsonArray(source.snapshot),
        eventType: "editorial.draft_created",
        reason: null,
        createdAt
      });
    });
    return this.#requireEditorialRevisionSummary(revisionId);
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
    const revisionId = await this.#sql.begin(async (transaction) => {
      const [draft] = await transaction<{
        id: string;
        collectionId: string;
      }[]>`
        SELECT
          revision.id,
          revision.collection_id AS "collectionId"
        FROM content_editorial_revisions revision
        JOIN content_editorial_collections collection
          ON collection.id = revision.collection_id
        WHERE collection.key = ${key} AND revision.status = 'draft'
        FOR UPDATE OF revision
      `;
      if (!draft) {
        throw new ContentRepositoryError("EDITORIAL_DRAFT_NOT_FOUND");
      }
      await transaction`
        UPDATE content_editorial_revisions
        SET snapshot = ${transaction.json(input.items)},
            updated_at = ${new Date(updatedAt)}
        WHERE id = ${draft.id}
      `;
      await this.#insertEditorialAdminEvent(transaction, {
        eventType: "editorial.draft_updated",
        actorUserId,
        collectionId: draft.collectionId,
        revisionId: draft.id,
        sourceRevisionId: null,
        reason: null,
        createdAt: updatedAt
      });
      return draft.id;
    });
    const revision = await this.#getEditorialRevisionById(revisionId);
    if (!revision) {
      throw new ContentRepositoryError("EDITORIAL_DRAFT_NOT_FOUND");
    }
    return revision;
  }

  async publishEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    reason: string,
    publishedAt: string
  ) {
    const revisionId = await this.#sql.begin(async (transaction) => {
      const [row] = await transaction<EditorialRevisionRow[]>`
        SELECT
          collection.key AS "key",
          revision.id AS "id",
          revision.revision_number AS "number",
          revision.status AS "status",
          revision.snapshot AS "snapshot",
          revision.created_by_user_id AS "createdByUserId",
          revision.created_at AS "createdAt",
          revision.updated_at AS "updatedAt",
          revision.published_at AS "publishedAt"
        FROM content_editorial_revisions revision
        JOIN content_editorial_collections collection
          ON collection.id = revision.collection_id
        WHERE collection.key = ${key} AND revision.status = 'draft'
        FOR UPDATE OF revision
      `;
      if (!row) throw new ContentRepositoryError("EDITORIAL_DRAFT_NOT_FOUND");
      const revision = mapEditorialRevision(row);
      if (revision.key === "navigation") {
        await this.#assertNavigationDestinations(transaction, revision);
      }
      const [collection] = await transaction<{ id: string }[]>`
        SELECT id FROM content_editorial_collections WHERE key = ${key}
      `;
      await transaction`
        UPDATE content_editorial_revisions
        SET status = 'published',
            updated_at = ${new Date(publishedAt)},
            published_at = ${new Date(publishedAt)}
        WHERE id = ${revision.id}
      `;
      await this.#insertEditorialAdminEvent(transaction, {
        eventType: "editorial.revision_published",
        actorUserId,
        collectionId: collection!.id,
        revisionId: revision.id,
        sourceRevisionId: null,
        reason,
        createdAt: publishedAt
      });
      return revision.id;
    });
    return this.#requireEditorialRevisionSummary(revisionId);
  }

  async createEditorialRollbackDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    sourceRevisionNumber: number,
    reason: string,
    createdAt: string
  ) {
    const revisionId = await this.#sql.begin(async (transaction) => {
      const [collection] = await transaction<{ id: string }[]>`
        SELECT id FROM content_editorial_collections
        WHERE key = ${key} FOR UPDATE
      `;
      if (!collection) {
        throw new ContentRepositoryError("EDITORIAL_COLLECTION_NOT_FOUND");
      }
      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM content_editorial_revisions
        WHERE collection_id = ${collection.id} AND status = 'draft'
      `;
      if (existing) throw new ContentRepositoryError("EDITORIAL_DRAFT_EXISTS");
      const [source] = await transaction<{
        id: string;
        snapshot: unknown[] | string;
      }[]>`
        SELECT id, snapshot
        FROM content_editorial_revisions
        WHERE collection_id = ${collection.id}
          AND revision_number = ${sourceRevisionNumber}
          AND status = 'published'
      `;
      if (!source) {
        throw new ContentRepositoryError("EDITORIAL_REVISION_NOT_FOUND");
      }
      const [numberRow] = await transaction<{ nextNumber: number }[]>`
        SELECT (max(revision_number) + 1)::integer AS "nextNumber"
        FROM content_editorial_revisions
        WHERE collection_id = ${collection.id}
      `;
      return this.#copyEditorialRevisionToDraft(transaction, {
        actorUserId,
        collectionId: collection.id,
        sourceRevisionId: source.id,
        revisionNumber: numberRow!.nextNumber,
        snapshot: parseJsonArray(source.snapshot),
        eventType: "editorial.rollback_draft_created",
        reason,
        createdAt
      });
    });
    return this.#requireEditorialRevisionSummary(revisionId);
  }

  async close() {
    await this.#sql.end({ timeout: 5 });
  }

  async #getEditorialRevision(
    key: EditorialCollectionKey,
    selector: { status: "draft" | "published" } | { revisionNumber: number }
  ) {
    const byNumber = "revisionNumber" in selector;
    const status = byNumber ? null : selector.status;
    const revisionNumber = byNumber ? selector.revisionNumber : null;
    const rows = await this.#sql<EditorialRevisionRow[]>`
      SELECT
        collection.key AS "key",
        revision.id AS "id",
        revision.revision_number AS "number",
        revision.status AS "status",
        revision.snapshot AS "snapshot",
        revision.created_by_user_id AS "createdByUserId",
        revision.created_at AS "createdAt",
        revision.updated_at AS "updatedAt",
        revision.published_at AS "publishedAt"
      FROM content_editorial_revisions revision
      JOIN content_editorial_collections collection
        ON collection.id = revision.collection_id
      WHERE collection.key = ${key}
        AND (${status}::text IS NULL OR revision.status = ${status})
        AND (${revisionNumber}::integer IS NULL
          OR revision.revision_number = ${revisionNumber})
      ORDER BY revision.revision_number DESC
      LIMIT 1
    `;
    return rows[0] ? mapEditorialRevision(rows[0]) : null;
  }

  async #getEditorialRevisionById(revisionId: string) {
    const rows = await this.#sql<EditorialRevisionRow[]>`
      SELECT
        collection.key AS "key",
        revision.id AS "id",
        revision.revision_number AS "number",
        revision.status AS "status",
        revision.snapshot AS "snapshot",
        revision.created_by_user_id AS "createdByUserId",
        revision.created_at AS "createdAt",
        revision.updated_at AS "updatedAt",
        revision.published_at AS "publishedAt"
      FROM content_editorial_revisions revision
      JOIN content_editorial_collections collection
        ON collection.id = revision.collection_id
      WHERE revision.id = ${revisionId}
      LIMIT 1
    `;
    return rows[0] ? mapEditorialRevision(rows[0]) : null;
  }

  async #copyEditorialRevisionToDraft(
    transaction: postgres.TransactionSql,
    input: {
      actorUserId: string;
      collectionId: string;
      sourceRevisionId: string;
      revisionNumber: number;
      snapshot: postgres.JSONValue;
      eventType: Extract<
        EditorialAdminEventType,
        "editorial.draft_created" | "editorial.rollback_draft_created"
      >;
      reason: string | null;
      createdAt: string;
    }
  ) {
    const revisionId = randomUUID();
    const createdAt = new Date(input.createdAt);
    await transaction`
      INSERT INTO content_editorial_revisions (
        id, collection_id, revision_number, status, snapshot,
        created_by_user_id, created_at, updated_at, published_at
      ) VALUES (
        ${revisionId}, ${input.collectionId}, ${input.revisionNumber}, 'draft',
        ${transaction.json(input.snapshot)}, ${input.actorUserId}, ${createdAt},
        ${createdAt}, ${null}
      )
    `;
    await this.#insertEditorialAdminEvent(transaction, {
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      collectionId: input.collectionId,
      revisionId,
      sourceRevisionId: input.sourceRevisionId,
      reason: input.reason,
      createdAt: input.createdAt
    });
    return revisionId;
  }

  async #insertEditorialAdminEvent(
    transaction: postgres.TransactionSql,
    input: {
      eventType: EditorialAdminEventType;
      actorUserId: string;
      collectionId: string;
      revisionId: string;
      sourceRevisionId: string | null;
      reason: string | null;
      createdAt: string;
    }
  ) {
    await transaction`
      INSERT INTO content_editorial_admin_events (
        id, event_type, actor_user_id, collection_id, revision_id,
        source_revision_id, reason, metadata, created_at
      ) VALUES (
        ${randomUUID()}, ${input.eventType}, ${input.actorUserId},
        ${input.collectionId}, ${input.revisionId}, ${input.sourceRevisionId},
        ${input.reason}, ${transaction.json({ schemaVersion: 1 })},
        ${new Date(input.createdAt)}
      )
    `;
  }

  async #requireEditorialRevisionSummary(revisionId: string) {
    const revision = await this.#getEditorialRevisionById(revisionId);
    if (!revision) {
      throw new ContentRepositoryError("EDITORIAL_REVISION_NOT_FOUND");
    }
    return editorialSummary(revision);
  }

  async #assertNavigationDestinations(
    sql: postgres.Sql | postgres.TransactionSql,
    revision: Extract<AdminEditorialRevision, { key: "navigation" }>
  ) {
    const routes = await sql<{ key: ContentPageKey; locale: ContentLocale }[]>`
      SELECT page.key AS "key", localization.locale AS "locale"
      FROM content_pages page
      JOIN content_page_localizations localization
        ON localization.page_id = page.id
    `;
    const available = new Set(routes.map(({ key, locale }) => `${key}:${locale}`));
    const broken = revision.items.some((item) =>
      item.enabled &&
      item.destination !== "home" &&
      item.destination !== "opt_out" &&
      (["en", "de"] as const).some((locale) =>
        !available.has(`${item.destination}:${locale}`)
      )
    );
    if (broken) {
      throw new ContentRepositoryError("EDITORIAL_DESTINATION_UNAVAILABLE");
    }
  }

  async #copyRevisionToDraft(
    transaction: postgres.TransactionSql,
    input: {
      actorUserId: string;
      pageId: string;
      sourceRevisionId: string;
      revisionNumber: number;
      requiresReacceptance: boolean;
      eventType: Extract<
        ContentAdminEventType,
        "content.draft_created" | "content.rollback_draft_created"
      >;
      reason: string | null;
      createdAt: string;
    }
  ) {
    const localizations = await transaction<RevisionLocalizationCopyRow[]>`
      SELECT
        locale,
        title,
        summary,
        sections,
        seo_title AS "seoTitle",
        seo_description AS "seoDescription",
        source_revision_number AS "sourceRevisionNumber"
      FROM content_page_revision_localizations
      WHERE revision_id = ${input.sourceRevisionId}
      ORDER BY locale
    `;
    if (!localizations.length) {
      throw new ContentRepositoryError("CONTENT_REVISION_NOT_FOUND");
    }
    const revisionId = randomUUID();
    const createdAt = new Date(input.createdAt);
    await transaction`
      INSERT INTO content_page_revisions (
        id, page_id, revision_number, status, requires_reacceptance,
        created_by_user_id, created_at, updated_at, published_at
      ) VALUES (
        ${revisionId}, ${input.pageId}, ${input.revisionNumber}, 'draft',
        ${input.requiresReacceptance}, ${input.actorUserId}, ${createdAt},
        ${createdAt}, ${null}
      )
    `;
    for (const localization of localizations) {
      const sections = typeof localization.sections === "string"
        ? JSON.parse(localization.sections) as AdminContentLocalizedRevision["sections"]
        : localization.sections;
      await transaction`
        INSERT INTO content_page_revision_localizations (
          id, revision_id, locale, title, summary, sections,
          seo_title, seo_description, source_revision_number,
          created_at, updated_at
        ) VALUES (
          ${randomUUID()}, ${revisionId}, ${localization.locale},
          ${localization.title}, ${localization.summary},
          ${transaction.json(sections)}, ${localization.seoTitle},
          ${localization.seoDescription}, ${localization.sourceRevisionNumber},
          ${createdAt}, ${createdAt}
        )
      `;
    }
    await this.#insertAdminEvent(transaction, {
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      pageId: input.pageId,
      revisionId,
      sourceRevisionId: input.sourceRevisionId,
      locale: null,
      reason: input.reason,
      createdAt: input.createdAt
    });
    return revisionId;
  }

  async #insertAdminEvent(
    transaction: postgres.TransactionSql,
    input: {
      eventType: ContentAdminEventType;
      actorUserId: string;
      pageId: string;
      revisionId: string;
      sourceRevisionId: string | null;
      locale: ContentLocale | null;
      reason: string | null;
      createdAt: string;
    }
  ) {
    await transaction`
      INSERT INTO content_admin_events (
        id, event_type, actor_user_id, page_id, revision_id,
        source_revision_id, locale, reason, metadata, created_at
      ) VALUES (
        ${randomUUID()}, ${input.eventType}, ${input.actorUserId},
        ${input.pageId}, ${input.revisionId}, ${input.sourceRevisionId},
        ${input.locale}, ${input.reason},
        ${transaction.json({ schemaVersion: 1 })}, ${new Date(input.createdAt)}
      )
    `;
  }

  async #revisionSummaryForKey(
    key: ContentPageKey,
    status: "draft" | "published"
  ) {
    const rows = await this.#sql<RevisionSummaryRow[]>`
      SELECT
        revision.id AS "id",
        revision.revision_number AS "number",
        revision.status AS "status",
        revision.requires_reacceptance AS "requiresReacceptance",
        revision.created_by_user_id AS "createdByUserId",
        revision.created_at AS "createdAt",
        revision.updated_at AS "updatedAt",
        revision.published_at AS "publishedAt",
        array_agg(revision_localization.locale ORDER BY revision_localization.locale)
          AS "locales"
      FROM content_page_revisions revision
      JOIN content_pages page ON page.id = revision.page_id
      JOIN content_page_revision_localizations revision_localization
        ON revision_localization.revision_id = revision.id
      WHERE page.key = ${key} AND revision.status = ${status}
      GROUP BY revision.id
      ORDER BY revision.revision_number DESC
      LIMIT 1
    `;
    return rows[0] ? mapRevisionSummary(rows[0]) : null;
  }

  async #requireRevisionSummary(revisionId: string) {
    const rows = await this.#sql<RevisionSummaryRow[]>`
      SELECT
        revision.id AS "id",
        revision.revision_number AS "number",
        revision.status AS "status",
        revision.requires_reacceptance AS "requiresReacceptance",
        revision.created_by_user_id AS "createdByUserId",
        revision.created_at AS "createdAt",
        revision.updated_at AS "updatedAt",
        revision.published_at AS "publishedAt",
        array_agg(revision_localization.locale ORDER BY revision_localization.locale)
          AS "locales"
      FROM content_page_revisions revision
      JOIN content_page_revision_localizations revision_localization
        ON revision_localization.revision_id = revision.id
      WHERE revision.id = ${revisionId}
      GROUP BY revision.id
    `;
    if (!rows[0]) throw new ContentRepositoryError("CONTENT_REVISION_NOT_FOUND");
    return mapRevisionSummary(rows[0]);
  }

  async #legalReferences(
    sql: postgres.Sql | postgres.TransactionSql,
    locale: ContentLocale
  ) {
    const rows = await sql<LegalReferenceRow[]>`
      SELECT
        revision.id AS "id",
        page.key AS "key",
        revision.revision_number AS "revisionNumber",
        localization.locale AS "locale",
        localization.slug AS "slug",
        revision_localization.title AS "title",
        revision.published_at AS "publishedAt"
      FROM content_pages page
      JOIN content_page_localizations localization
        ON localization.page_id = page.id AND localization.locale = ${locale}
      JOIN LATERAL (
        SELECT * FROM content_page_revisions candidate
        WHERE candidate.page_id = page.id
          AND candidate.status = 'published'
          AND candidate.requires_reacceptance
        ORDER BY candidate.revision_number DESC
        LIMIT 1
      ) revision ON true
      JOIN content_page_revision_localizations revision_localization
        ON revision_localization.revision_id = revision.id
        AND revision_localization.locale = localization.locale
      WHERE page.key IN ('terms', 'acceptable_use')
    `;
    const terms = rows.find(({ key }) => key === "terms");
    const acceptableUse = rows.find(({ key }) => key === "acceptable_use");
    if (!terms || !acceptableUse) {
      throw new ContentRepositoryError("LEGAL_CONTENT_UNAVAILABLE");
    }
    return {
      terms: mapLegalReference(terms),
      acceptableUse: mapLegalReference(acceptableUse)
    };
  }
}

function mapPublishedPage(row: PublishedPageRow): PublishedContentPage {
  return {
    key: row.key,
    pageType: row.pageType,
    sourceLocale: row.sourceLocale,
    locale: row.locale,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    sections: typeof row.sections === "string"
      ? JSON.parse(row.sections) as PublishedContentPage["sections"]
      : row.sections,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    revision: {
      id: row.revisionId,
      number: row.revisionNumber,
      requiresReacceptance: row.requiresReacceptance,
      sourceRevisionNumber: row.sourceRevisionNumber,
      publishedAt: toIso(row.publishedAt)
    }
  };
}

function mapAdminRevision(row: AdminRevisionRow): AdminContentLocalizedRevision {
  return {
    key: row.key,
    pageType: row.pageType,
    sourceLocale: row.sourceLocale,
    locale: row.locale,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    sections: typeof row.sections === "string"
      ? JSON.parse(row.sections) as AdminContentLocalizedRevision["sections"]
      : row.sections,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    revision: {
      id: row.revisionId,
      number: row.revisionNumber,
      status: row.revisionStatus,
      requiresReacceptance: row.requiresReacceptance,
      sourceRevisionNumber: row.sourceRevisionNumber,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null
    }
  };
}

function mapRevisionSummary(row: RevisionSummaryRow): AdminContentRevisionSummary {
  return {
    ...row,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null
  };
}

function mapEditorialRevision(row: EditorialRevisionRow): AdminEditorialRevision {
  return adminEditorialRevisionSchema.parse({
    key: row.key,
    id: row.id,
    number: row.number,
    status: row.status,
    items: parseJsonArray(row.snapshot),
    createdByUserId: row.createdByUserId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null
  });
}

function editorialSummary(
  revision: AdminEditorialRevision
): EditorialRevisionSummary {
  const { key: _key, items: _items, ...summary } = revision;
  return summary;
}

function parseJsonArray(value: unknown[] | string): postgres.JSONValue {
  return (typeof value === "string" ? JSON.parse(value) : value) as postgres.JSONValue;
}

function byEditorialSortOrder(
  left: { sortOrder: number },
  right: { sortOrder: number }
) {
  return left.sortOrder - right.sortOrder;
}

function navigationHref(
  destination: PublishedNavigation["items"][number]["destination"],
  locale: ContentLocale,
  index: PublishedContentIndex
) {
  if (destination === "home") return `/${locale}`;
  if (destination === "opt_out") return `/${locale}/opt-out`;
  const localization = index.pages
    .find(({ key }) => key === destination)
    ?.localizations.find((candidate) => candidate.locale === locale);
  return localization ? `/${locale}/${localization.slug}` : null;
}

function landingIndex(
  revision: Extract<AdminEditorialRevision, { key: "landing" }>
): NonNullable<PublishedContentIndex["landing"]> {
  const hero = revision.items.find(({ blockType }) => blockType === "hero");
  if (!hero || hero.blockType !== "hero" || !revision.publishedAt) {
    throw new ContentRepositoryError("EDITORIAL_REVISION_NOT_FOUND");
  }
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

function mapLegalReference(row: LegalReferenceRow) {
  return { ...row, publishedAt: toIso(row.publishedAt) };
}

function toIso(value: DatabaseDate) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isForeignKeyViolation(error: unknown) {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "23503"
  );
}
