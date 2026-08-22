import type {
  ContentLocale,
  OnboardingAcceptanceInput,
  OnboardingStatus,
  PublishedContentPage
} from "@callassist/contracts";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  ContentRepositoryError,
  type ContentRepository,
  type SeedContentPage
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
            created_by_user_id, created_at, published_at
          ) VALUES (
            ${page.revision.id}, ${page.pageId}, ${page.revision.number},
            'published', ${page.revision.requiresReacceptance}, ${null},
            ${now}, ${now}
          ) ON CONFLICT (id) DO NOTHING
        `;
        await transaction`
          INSERT INTO content_page_revision_localizations (
            id, revision_id, locale, title, summary, sections,
            seo_title, seo_description, source_revision_number, created_at
          ) VALUES (
            ${page.revisionLocalizationId}, ${page.revision.id}, ${page.locale},
            ${page.title}, ${page.summary}, ${transaction.json(page.sections)},
            ${page.seoTitle}, ${page.seoDescription},
            ${page.revision.sourceRevisionNumber}, ${now}
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

  async close() {
    await this.#sql.end({ timeout: 5 });
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
