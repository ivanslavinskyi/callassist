import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import postgres from "postgres";
import {
  contentDraftUpdateInputSchema, contentUiLocales, editorialCollectionKeySchema,
  editorialDraftUpdateInputSchema, requiredContentLocales
} from "@callassist/contracts";
import { ContentService } from "./content-service";
import type { ContentRepository } from "./content-repository";
import { PostgresContentRepository } from "./postgres-content-repository";
import { localizePublicPage, publicLocaleResources, publicText } from "./public-localizations";

const translationLocales = contentUiLocales.filter(locale => Object.hasOwn(publicLocaleResources, locale));
const reason = "Complete missing CMS localizations from the current English source";

/** Preserve authored translations and all layout/identity fields; fill only absent text. */
export function fillEditorialLocaleGaps<T>(source: T): T {
  if (Array.isArray(source)) return source.map(fillEditorialLocaleGaps) as T;
  if (!source || typeof source !== "object") return source;
  const values = source as Record<string, unknown>;
  if (typeof values.en === "string" || Array.isArray(values.en) && values.en.every(v => typeof v === "string")) {
    const result = { ...values };
    for (const locale of translationLocales) {
      if (result[locale] !== undefined) continue;
      result[locale] = Array.isArray(values.en)
        ? values.en.map(value => publicText(value, locale)) : publicText(values.en as string, locale);
    }
    return result as T;
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, fillEditorialLocaleGaps(value)])) as T;
}

export async function planCmsLocaleCompletion(repository: ContentRepository) {
  const pages = [];
  for (const page of await repository.listAdminPages()) {
    for (const status of ["published", "draft"] as const) {
      const source = await repository.getAdminRevision(page.key, "en", { status });
      if (!source) continue;
      const additions = [];
      for (const locale of translationLocales) {
        // Looking up the exact revision is essential: an older translation is not current.
        const existing = await repository.getAdminRevision(page.key, locale, { revisionNumber: source.revision.number });
        if (existing) continue;
        const copy = localizePublicPage(source, page.key, locale);
        additions.push(contentDraftUpdateInputSchema.parse({ ...copy,
          slug: page.localizations.find(route => route.locale === locale)?.slug ?? copy.slug,
          locale, sourceRevisionNumber: source.revision.sourceRevisionNumber,
          requiresReacceptance: source.revision.requiresReacceptance
        }));
      }
      if (additions.length) pages.push({ key: page.key, source, additions });
    }
  }
  const collections = [];
  for (const key of editorialCollectionKeySchema.options) {
    const current = await repository.getAdminEditorialCollection(key);
    let usesExistingDraft = false;
    for (const status of ["published", "draft"] as const) {
      if (status === "draft" && usesExistingDraft) continue;
      const source = current[status];
      if (!source) continue;
      const items = fillEditorialLocaleGaps(source.items);
      const requiredLocales = [...new Set([...requiredContentLocales(source), ...contentUiLocales])];
      if (isDeepStrictEqual(items, source.items) && isDeepStrictEqual(requiredLocales, source.requiredLocales)) continue;
      if (status === "published" && current.draft) {
        // A matching working copy can be published normally. Never publish unrelated edits.
        if (!isDeepStrictEqual(fillEditorialLocaleGaps(current.draft.items), items)) throw new Error(`CMS_UNRELATED_EDITORIAL_DRAFT: ${key}`);
        usesExistingDraft = true;
      }
      const payload = editorialDraftUpdateInputSchema.parse({ key, items, requiredLocales });
      collections.push({ key, source, payload, usesExistingDraft });
    }
  }
  return { pages, collections };
}

/** An explicit operator repair, not startup seeding. Never overwrites a translation.
 * Page locales are additive to the same semantic revision, preserving legal acceptance
 * IDs and unrelated drafts. Immutable collection snapshots use normal draft/publication
 * methods, reusing a draft only when its translated content matches the published source. */
export async function completeCmsLocales(databaseUrl: string, options: { apply?: boolean; actorEmail?: string } = {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    return await sql.begin(async transaction => {
      await transaction`SET LOCAL lock_timeout = '5s'`;
      await transaction`SET LOCAL statement_timeout = '30s'`;
      let actorId: string | null = null;
      if (options.apply) {
        if (!options.actorEmail?.trim()) throw new Error("CMS_ACTOR_EMAIL_REQUIRED");
        const [actor] = await transaction<{ id: string }[]>`
          SELECT id FROM users WHERE lower(email)=lower(${options.actorEmail.trim()}) AND status='active'
            AND role IN ('content_editor','admin','superadmin')
            AND NOT EXISTS (SELECT 1 FROM account_deletion_requests d WHERE d.user_id=users.id AND d.status<>'completed')
          FOR SHARE`;
        if (!actor) throw new Error("CMS_ACTOR_NOT_AUTHORIZED");
        actorId = actor.id;
        await transaction`LOCK TABLE content_pages,content_page_localizations,content_page_revisions,
          content_page_revision_localizations,content_admin_events,content_editorial_collections,
          content_editorial_revisions,content_editorial_admin_events IN SHARE ROW EXCLUSIVE MODE`;
      } else {
        await transaction`SET TRANSACTION READ ONLY`;
      }
      const repository = new PostgresContentRepository(databaseUrl, transaction);
      const service = new ContentService(repository);
      // Plan and validate every payload before the first write, under the same lock.
      const plan = await planCmsLocaleCompletion(repository);
      const now = new Date();
      if (options.apply) {
        for (const page of plan.pages) {
          const [row] = await transaction<{ id: string }[]>`SELECT id FROM content_pages WHERE key=${page.key}`;
          if (!row) throw new Error("CMS_PAGE_DISAPPEARED");
          for (const translation of page.additions) {
            await transaction`INSERT INTO content_page_localizations(id,page_id,locale,slug,created_at,updated_at)
              VALUES(${randomUUID()},${row.id},${translation.locale},${translation.slug!},${now},${now})
              ON CONFLICT (page_id,locale) DO NOTHING`;
            await transaction`INSERT INTO content_page_revision_localizations
              (id,revision_id,locale,title,summary,sections,seo_title,seo_description,source_revision_number,created_at,updated_at)
              VALUES(${randomUUID()},${page.source.revision.id},${translation.locale},${translation.title},${translation.summary},
                ${transaction.json(translation.sections)},${translation.seoTitle},${translation.seoDescription},
                ${translation.sourceRevisionNumber},${now},${now})`;
            await transaction`INSERT INTO content_admin_events
              (id,event_type,actor_user_id,page_id,revision_id,source_revision_id,locale,reason,metadata,created_at)
              VALUES(${randomUUID()},${page.source.revision.status === "published" ? "content.revision_published" : "content.draft_updated"},
                ${actorId!},${row.id},${page.source.revision.id},${page.source.revision.id},${translation.locale},${reason},
                ${transaction.json({ schemaVersion: 1, operation: "missing_localization_added", sourceLocale: "en" })},${now})`;
          }
          if (page.source.revision.status === "draft") {
            const required = [...new Set([...requiredContentLocales(page.source.revision), ...contentUiLocales])];
            await transaction`UPDATE content_page_revisions SET required_locales=${transaction.json(required)}
              WHERE id=${page.source.revision.id}`;
          }
        }
        for (const collection of plan.collections) {
          if (collection.source.status === "published" && !collection.usesExistingDraft) await service.createEditorialDraft(actorId!, collection.key);
          await service.updateEditorialDraft(actorId!, collection.key, collection.payload);
          if (collection.source.status === "published") await service.publishEditorialDraft(actorId!, collection.key, reason);
        }
      }
      return { mode: options.apply ? "applied" : "dry_run", actorId, completedAt: now.toISOString(),
        summary: { pageTranslations: plan.pages.reduce((sum, page) => sum + page.additions.length, 0),
          pages: plan.pages.map(page => ({ key: page.key, revision: page.source.revision.number, status: page.source.revision.status,
            locales: page.additions.map(translation => translation.locale) })),
          collections: plan.collections.map(collection => ({ key: collection.key, sourceRevision: collection.source.number,
            status: collection.source.status })) }, plan };
    });
  } finally { await sql.end({ timeout: 5 }); }
}
