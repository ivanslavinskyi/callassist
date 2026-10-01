import "../config/load-env";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { callCompilationSchema } from "@callassist/contracts";
import { decryptJson, parseDataEncryptionKeyring, type DataEncryptionMaterial } from "../security/encryption";
import { recordPlanReview } from "../safety/plan-review-publication";

/** No provider calls, current compilation changes, or historical email delivery. */
export async function backfillPlanReviewCases(sql: postgres.Sql, key: DataEncryptionMaterial, execute = false) {
  const counts = { mode: execute ? "execute" : "dry_run", scanned: 0, eligible: 0, inserted: 0, unavailable: 0 };
  let cursor: { callId: string; revision: number } | null = null;
  for (;;) {
    const batch: Array<{ call_id: string; revision: number }> = await sql`SELECT c.call_brief_id AS call_id,c.revision
      FROM call_compilations c JOIN call_briefs b ON b.id=c.call_brief_id WHERE b.data_deleted_at IS NULL
        AND c.compilation_ciphertext IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plan_review_cases p WHERE p.compilation_id=c.id)
        AND (${cursor?.callId ?? null}::uuid IS NULL OR (c.call_brief_id,c.revision)>(${cursor?.callId ?? null}::uuid,${cursor?.revision ?? 0}))
      ORDER BY c.call_brief_id,c.revision LIMIT 200`;
    if (!batch.length) return counts;
    for (const item of batch) {
      counts.scanned++;
      await sql.begin(async tx => {
        if (!execute) await tx`SET TRANSACTION READ ONLY`;
        // Serialize apply with source deletion and normal publication (brief first).
        const rows = execute
          ? await tx`SELECT id FROM call_briefs WHERE id=${item.call_id} AND data_deleted_at IS NULL FOR SHARE`
          : await tx`SELECT id FROM call_briefs WHERE id=${item.call_id} AND data_deleted_at IS NULL`;
        if (!rows.length) { counts.unavailable++; return; }
        const [row] = await tx`SELECT compilation_ciphertext FROM call_compilations WHERE call_brief_id=${item.call_id} AND revision=${item.revision}`;
        if (!row?.compilation_ciphertext) { counts.unavailable++; return; }
        let compilation;
        try { compilation = callCompilationSchema.parse(decryptJson(String(row.compilation_ciphertext), key)); }
        catch { counts.unavailable++; return; }
        if (compilation.policyDecision.status === "ready_for_review") return;
        counts.eligible++;
        if (execute && await recordPlanReview(tx, item.call_id, compilation, { historical: true })) counts.inserted++;
      });
      cursor = { callId: item.call_id, revision: item.revision };
    }
  }
}
export async function backfillPlanReviews(args = process.argv.slice(2), environment = process.env) {
  if (args.some(arg => arg !== "--execute")) throw new Error("Only --execute is accepted");
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = postgres(environment.DATABASE_URL, { max: 1, onnotice: () => undefined });
  try { return await backfillPlanReviewCases(sql, parseDataEncryptionKeyring(environment), args.includes("--execute")); }
  finally { await sql.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillPlanReviews().then(result => { console.log(JSON.stringify(result)); if (result.unavailable) process.exitCode = 1; })
    .catch(() => { console.error("PLAN_REVIEW_BACKFILL_FAILED"); process.exitCode = 1; });
}
