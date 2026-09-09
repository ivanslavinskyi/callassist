import postgres from "postgres";
import { contentDraftUpdateInputSchema, contentPageKeySchema, editorialDraftUpdateInputSchema, editorialCollectionKeySchema } from "@callassist/contracts";
import { ContentService } from "./content-service";
import { PostgresContentRepository } from "./postgres-content-repository";
import type { buildPublicContentReleaseCandidate } from "./public-content-release";

type Candidate = Awaited<ReturnType<typeof buildPublicContentReleaseCandidate>>;
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function parseCandidate(raw: unknown): Candidate {
  if (!raw || typeof raw !== "object") throw new Error("Invalid release candidate");
  const value = structuredClone(raw) as Candidate;
  if (value.release !== "public-copy-2026-09-09" || !Array.isArray(value.pages) || value.pages.length > 5 ||
      !Array.isArray(value.collections) || value.collections.length > 2) throw new Error("Invalid release targets");
  if (new Set(value.pages.map(page => page.key)).size !== value.pages.length ||
      new Set(value.collections.map(collection => collection.key)).size !== value.collections.length) {
    throw new Error("Duplicate release target");
  }
  for (const page of value.pages) {
    contentPageKeySchema.parse(page.key);
    if (!Array.isArray(page.translations) || page.translations.length !== 2) throw new Error("Release requires EN/DE page payloads");
    for (const translation of page.translations) {
      validateSource(translation);
      if (!["en", "de"].includes(translation.locale)) throw new Error("Unsupported release locale");
      translation.payload = contentDraftUpdateInputSchema.parse(translation.payload);
    }
    if (new Set(page.translations.map(t => t.locale)).size !== 2 || page.translations.some(t => t.locale !== t.payload.locale)) {
      throw new Error("Release requires matching EN/DE page payloads");
    }
  }
  for (const collection of value.collections) {
    validateSource(collection);
    editorialCollectionKeySchema.parse(collection.key);
    if (!["landing", "faq"].includes(collection.key)) throw new Error("Unsupported release collection");
    collection.payload = editorialDraftUpdateInputSchema.parse(collection.payload);
  }
  return value;
}
function validateSource(value: { sourceRevisionId: string; sourceRevisionNumber: number; existingDraftId: string | null }) {
  if (!isUuid(value.sourceRevisionId) || !Number.isInteger(value.sourceRevisionNumber) || value.sourceRevisionNumber < 1 ||
      (value.existingDraftId !== null && !isUuid(value.existingDraftId))) throw new Error("Invalid source revision");
}

type StageRow = { type: "page" | "collection"; key: string; state: "ready" | "draft_preserved" | "source_changed" | "staged";
  sourceRevisionId: string; draftId: string | null; draftNumber?: number };

/** Creates drafts only. Existing drafts/publications and legal acceptances are never updated. */
export async function stagePublicContentRelease(databaseUrl: string, rawCandidate: unknown,
  options: { apply?: boolean; actorUserId?: string } = {}) {
  const candidate = parseCandidate(rawCandidate);
  if (options.apply && !isUuid(options.actorUserId)) throw new Error("Apply requires an explicitly identified content editor/admin actor.");
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    return await sql.begin(async transaction => {
      await transaction`SET LOCAL lock_timeout = '5s'`;
      await transaction`SET LOCAL statement_timeout = '30s'`;
      if (options.apply) {
        const [actor] = await transaction<{ role: string; status: string }[]>`SELECT role,status FROM users WHERE id=${options.actorUserId!} FOR SHARE`;
        if (!actor || actor.status !== "active" || !["content_editor", "admin", "superadmin"].includes(actor.role)) {
          throw new Error("Apply actor is not an active content editor/admin.");
        }
        const pending = await transaction`SELECT id FROM account_deletion_requests WHERE user_id=${options.actorUserId!} AND status<>'completed'`;
        if (pending.count) throw new Error("Apply actor has a pending deletion request.");
        // Block concurrent editorial writes across preflight + create + localized
        // updates. Normal ContentService writes/audit remain the only mutation path.
        await transaction`LOCK TABLE content_pages,content_page_revisions,content_page_revision_localizations,
          content_admin_events,content_editorial_collections,content_editorial_revisions,content_editorial_admin_events
          IN SHARE ROW EXCLUSIVE MODE`;
      } else {
        await transaction`SET TRANSACTION READ ONLY`;
      }
      const service = new ContentService(new PostgresContentRepository(databaseUrl, transaction));
      const rows: StageRow[] = [];
      for (const page of candidate.pages) {
        const current = await Promise.all(page.translations.map(t => service.getAdminPage(page.key, t.locale)));
        const mismatch = current.some((value, index) => value.published?.revision.id !== page.translations[index]!.sourceRevisionId ||
          value.published.revision.number !== page.translations[index]!.sourceRevisionNumber);
        const draft = current.find(value => value.draft)?.draft;
        rows.push({ type: "page", key: page.key, state: mismatch ? "source_changed" : draft ? "draft_preserved" : "ready",
          sourceRevisionId: page.translations[0]!.sourceRevisionId, draftId: draft?.revision.id ?? null });
      }
      for (const collection of candidate.collections) {
        const current = await service.getAdminEditorialCollection(collection.key);
        const mismatch = current.published?.id !== collection.sourceRevisionId || current.published.number !== collection.sourceRevisionNumber;
        rows.push({ type: "collection", key: collection.key, state: mismatch ? "source_changed" : current.draft ? "draft_preserved" : "ready",
          sourceRevisionId: collection.sourceRevisionId, draftId: current.draft?.id ?? null });
      }
      if (options.apply) {
        for (const row of rows.filter(row => row.state === "ready")) {
          if (row.type === "page") {
            const page = candidate.pages.find(page => page.key === row.key)!;
            const created = await service.createDraft(options.actorUserId!, page.key);
            for (const translation of page.translations) await service.updateDraft(options.actorUserId!, page.key,
              { ...translation.payload, sourceRevisionNumber: created.number });
            row.draftId = created.id; row.draftNumber = created.number;
          } else {
            const collection = candidate.collections.find(collection => collection.key === row.key)!;
            const created = await service.createEditorialDraft(options.actorUserId!, collection.key);
            await service.updateEditorialDraft(options.actorUserId!, collection.key, collection.payload);
            row.draftId = created.id; row.draftNumber = created.number;
          }
          row.state = "staged";
        }
      }
      return { release: candidate.release, mode: options.apply ? "apply_drafts" : "dry_run", actorUserId: options.apply ? options.actorUserId : null,
        checkedAt: new Date().toISOString(), published: false, rows };
    });
  } finally { await sql.end({ timeout: 5 }); }
}
