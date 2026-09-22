import postgres from "postgres";
import type { OgImageVersion, OgLocaleState, PublishedOgImage, UiLocale } from "@callassist/contracts";
import { emptyOgState, OgError, type OgRepository } from "./og-repository";

export class PostgresOgRepository implements OgRepository {
  private sql: ReturnType<typeof postgres>;
  constructor(url: string) { this.sql = postgres(url, { max: 3 }); }
  async published(): Promise<PublishedOgImage[]> {
    return this.sql<PublishedOgImage[]>`SELECT l.locale, v.asset_hash AS hash, v.alt
      FROM home_og_locales l JOIN home_og_versions v ON v.id = l.published_id ORDER BY l.locale`;
  }
  async state(locale: UiLocale): Promise<OgLocaleState> {
    // One statement/snapshot keeps pointers and versions consistent during publication.
    const rows = await this.sql`
      SELECT l.revision, l.published_id, l.previous_id, l.draft_id,
        COALESCE((SELECT jsonb_agg(v ORDER BY v."createdAt" DESC) FROM (
          SELECT id, locale, asset_hash AS hash, source, slogan, alt,
            template_version AS "templateVersion", created_at AS "createdAt"
          FROM home_og_versions WHERE locale = l.locale
          ORDER BY created_at DESC LIMIT 50
        ) v), '[]'::jsonb) AS history,
        (SELECT row_to_json(v) FROM home_og_versions v WHERE v.id = l.published_id) AS published,
        (SELECT row_to_json(v) FROM home_og_versions v WHERE v.id = l.previous_id) AS previous,
        (SELECT row_to_json(v) FROM home_og_versions v WHERE v.id = l.draft_id) AS draft
      FROM home_og_locales l WHERE l.locale = ${locale}`;
    if (!rows[0]) return emptyOgState(locale);
    const row = rows[0];
    const version = (v: Record<string, unknown> | null): OgImageVersion | null => v ? {
      id: String(v.id), locale, hash: String(v.asset_hash), source: v.source as OgImageVersion["source"],
      slogan: v.slogan as string | null, alt: String(v.alt), templateVersion: v.template_version as string | null,
      createdAt: new Date(String(v.created_at)).toISOString()
    } : null;
    return { locale, revision: row.revision, published: version(row.published), previous: version(row.previous),
      draft: version(row.draft), history: row.history };
  }
  async saveDraft(version: OgImageVersion, png: Buffer, actorId: string, expectedRevision: number) {
    await this.sql.begin(async sql => {
      await sql`INSERT INTO home_og_locales(locale) VALUES (${version.locale}) ON CONFLICT DO NOTHING`;
      const [state] = await sql`SELECT revision FROM home_og_locales WHERE locale = ${version.locale} FOR UPDATE`;
      if (state!.revision !== expectedRevision) throw new OgError("OG_REVISION_CONFLICT", 409);
      await sql`INSERT INTO home_og_assets(hash, png) VALUES (${version.hash}, ${png}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO home_og_versions(id, locale, asset_hash, source, slogan, alt, template_version, created_by, created_at)
        VALUES (${version.id}, ${version.locale}, ${version.hash}, ${version.source}, ${version.slogan}, ${version.alt},
          ${version.templateVersion}, ${actorId}, ${version.createdAt})`;
      await sql`UPDATE home_og_locales SET draft_id = ${version.id}, revision = revision + 1 WHERE locale = ${version.locale}`;
      await sql`INSERT INTO home_og_audit(locale, actor_user_id, action, version_id)
        VALUES (${version.locale}, ${actorId}, 'draft', ${version.id})`;
    });
  }
  async publish(locale: UiLocale, versionId: string, actorId: string, expectedRevision: number) {
    await this.sql.begin(async sql => {
      const [state] = await sql`SELECT * FROM home_og_locales WHERE locale = ${locale} FOR UPDATE`;
      if ((state?.revision ?? 0) !== expectedRevision) throw new OgError("OG_REVISION_CONFLICT", 409);
      const [version] = await sql`SELECT id FROM home_og_versions WHERE id = ${versionId} AND locale = ${locale}`;
      if (!version || !state) throw new OgError("OG_VERSION_NOT_FOUND", 404);
      await sql`UPDATE home_og_versions SET ever_published = true WHERE id = ${versionId}`;
      await sql`UPDATE home_og_locales SET
        previous_id = CASE WHEN published_id IS DISTINCT FROM ${versionId}::uuid THEN published_id ELSE previous_id END,
        published_id = ${versionId}, draft_id = CASE WHEN draft_id = ${versionId}::uuid THEN NULL ELSE draft_id END,
        revision = revision + 1 WHERE locale = ${locale}`;
      await sql`INSERT INTO home_og_audit(locale, actor_user_id, action, version_id, previous_version_id)
        VALUES (${locale}, ${actorId}, 'publish', ${versionId}, ${state.published_id})`;
    });
  }
  async image(locale: UiLocale, hash: string, includeDrafts = false) {
    const [row] = await this.sql`SELECT a.png FROM home_og_assets a WHERE a.hash = ${hash} AND EXISTS (
      SELECT 1 FROM home_og_versions v WHERE v.asset_hash = a.hash AND v.locale = ${locale}
        AND (${includeDrafts} OR v.ever_published))`;
    return row ? Buffer.from(row.png) : null;
  }
  async close() { await this.sql.end(); }
}
