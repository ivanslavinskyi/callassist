import postgres from "postgres";
import {
  planReviewCaseSchema, planReviewDetailSchema, planReviewEvidenceSchema, planReviewListSchema,
  planReviewFiltersSchema, planReviewUpdateSchema, sensitiveCallAccessInputSchema,
  callCompilationSchema, type PlanReviewFilters, type PlanReviewUpdate
} from "@callassist/contracts";
import { decryptJson, encryptJson, parseDataEncryptionKeyring, type DataEncryptionMaterial } from "../security/encryption";

export class PlanReviewError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export const emptyPlanReviewSummary = { new: 0, inReview: 0, policySignals: 0, emailFailed: 0, emailPending: 0, oldestPendingAt: null };
export interface PlanReviewAdmin {
  list(filters: PlanReviewFilters): ReturnType<PlanReviewService["list"]>;
  get(id: string): ReturnType<PlanReviewService["get"]>;
  evidence(id: string, actor: string, reason: string): ReturnType<PlanReviewService["evidence"]>;
  update(id: string, actor: string, input: PlanReviewUpdate): Promise<void>;
  retryEmail(id: string, deliveryId: string, actor: string, reason: string): Promise<void>;
  close(): Promise<void>;
}

export class PlanReviewService implements PlanReviewAdmin {
  private readonly sql: postgres.Sql;
  constructor(databaseUrl: string, private readonly key: DataEncryptionMaterial) {
    this.sql = postgres(databaseUrl, { max: 3, onnotice: () => undefined });
  }
  async close() { await this.sql.end(); }

  private available(sql: postgres.Sql | postgres.TransactionSql) {
    return sql`b.data_deleted_at IS NULL AND c.compilation_ciphertext IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=b.user_id AND u.status='deleted')
      AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=b.user_id AND d.status<>'completed')`;
  }
  private select(sql: postgres.Sql | postgres.TransactionSql) {
    return sql`SELECT p.*, to_char(p.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
      (SELECT count(*)::int FROM plan_review_cases other WHERE other.call_brief_id=p.call_brief_id AND other.id<>p.id) AS repeats,
      (SELECT count(*)::int FROM superadmin_notifications n WHERE n.kind='plan_review' AND n.source_id=p.id AND n.status='failed') AS email_failed,
      (SELECT count(*)::int FROM superadmin_notifications n WHERE n.kind='plan_review' AND n.source_id=p.id AND n.status IN ('queued','processing')) AS email_pending,
      (SELECT count(*)::int FROM superadmin_notifications n WHERE n.kind='plan_review' AND n.source_id=p.id AND n.status='accepted') AS email_accepted
      FROM plan_review_cases p JOIN call_briefs b ON b.id=p.call_brief_id JOIN call_compilations c ON c.id=p.compilation_id`;
  }
  async list(input: PlanReviewFilters) {
    const f = planReviewFiltersSchema.parse(input), cursor = decodeCursor(f.cursor);
    const rows = await this.sql`${this.select(this.sql)} WHERE ${this.available(this.sql)}
      AND (${f.status ?? null}::text IS NULL OR p.status=${f.status ?? null})
      AND (${f.category ?? null}::text IS NULL OR p.category=${f.category ?? null})
      AND (${f.decision ?? null}::text IS NULL OR p.decision=${f.decision ?? null})
      AND (${f.reason ?? null}::text IS NULL OR ${f.reason ?? null}=ANY(p.reasons))
      AND (${f.userId ?? null}::uuid IS NULL OR p.user_id=${f.userId ?? null})
      AND (${f.callId ?? null}::uuid IS NULL OR p.call_brief_id=${f.callId ?? null})
      AND (${f.from ?? null}::timestamptz IS NULL OR p.occurred_at>=${f.from ?? null})
      AND (${f.to ?? null}::timestamptz IS NULL OR p.occurred_at<=${f.to ?? null})
      AND (${cursor?.id ?? null}::uuid IS NULL OR (p.occurred_at,p.id)<(${cursor?.time ?? null}::text::timestamptz,${cursor?.id ?? null}::uuid))
      ORDER BY p.occurred_at DESC,p.id DESC LIMIT ${f.limit + 1}`;
    const [counts] = await this.sql`SELECT count(*) FILTER(WHERE p.status='new')::int AS new,
      count(*) FILTER(WHERE p.status='in_review')::int AS "inReview",
      count(*) FILTER(WHERE p.status<>'resolved' AND p.category='policy_signal')::int AS "policySignals"
      FROM plan_review_cases p JOIN call_briefs b ON b.id=p.call_brief_id JOIN call_compilations c ON c.id=p.compilation_id WHERE ${this.available(this.sql)}`;
    const [mail] = await this.sql`SELECT count(*) FILTER(WHERE n.status='failed')::int AS "emailFailed",
      count(*) FILTER(WHERE n.status IN ('queued','processing'))::int AS "emailPending",
      min(n.created_at) FILTER(WHERE n.status IN ('queued','processing')) AS oldest
      FROM superadmin_notifications n JOIN plan_review_cases p ON p.id=n.source_id
      JOIN call_briefs b ON b.id=p.call_brief_id JOIN call_compilations c ON c.id=p.compilation_id
      WHERE n.kind='plan_review' AND ${this.available(this.sql)}`;
    const page = rows.slice(0, f.limit), items = page.map(mapCase), last = page.at(-1);
    return planReviewListSchema.parse({ available: true, items,
      // JS Date truncates PostgreSQL microseconds. Keep the database precision in
      // the seek cursor or another case within this millisecond can be skipped.
      nextCursor: rows.length > f.limit && last ? encodeCursor(String(last.cursor_time), String(last.id)) : null,
      summary: { ...counts, emailFailed: mail!.emailFailed, emailPending: mail!.emailPending,
        oldestPendingAt: mail!.oldest instanceof Date ? mail!.oldest.toISOString() : null } });
  }
  async get(id: string) {
    const [row] = await this.sql`${this.select(this.sql)} WHERE p.id=${id} AND ${this.available(this.sql)}`;
    if (!row) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
    const [history, audit, deliveries] = await Promise.all([
      this.sql`${this.select(this.sql)} WHERE p.call_brief_id=${row.call_brief_id} AND ${this.available(this.sql)} ORDER BY p.plan_revision DESC LIMIT 100`,
      this.sql`SELECT id,actor_id AS "actorId",action,created_at FROM plan_review_audit WHERE case_id=${id} ORDER BY created_at DESC,id DESC LIMIT 100`,
      this.sql`SELECT id,status,send_attempts AS attempts,updated_at,last_error_code AS "errorCode"
        FROM superadmin_notifications WHERE kind='plan_review' AND source_id=${id} ORDER BY created_at DESC LIMIT 20`
    ]);
    return planReviewDetailSchema.parse({ item: mapCase(row), history: history.map(mapCase),
      audit: audit.map(a => ({ id: a.id, actorId: a.actorId, action: a.action, createdAt: date(a.created_at) })),
      deliveries: deliveries.map(d => ({ id: d.id, status: d.status, attempts: d.attempts, errorCode: d.errorCode, updatedAt: date(d.updated_at) })) });
  }
  async evidence(id: string, actor: string, reason: string) {
    const parsed = sensitiveCallAccessInputSchema.parse({ reason });
    return this.sql.begin(async tx => {
      await authorize(tx, actor);
      // Lock the brief explicitly first, matching publication and deletion.
      const brief = await tx`SELECT b.id FROM plan_review_cases p JOIN call_briefs b ON b.id=p.call_brief_id
        JOIN call_compilations c ON c.id=p.compilation_id WHERE p.id=${id} AND ${this.available(tx)} FOR SHARE OF b`;
      if (!brief.length) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
      const [row] = await tx`SELECT c.compilation_ciphertext,p.note_ciphertext FROM plan_review_cases p
        JOIN call_briefs b ON b.id=p.call_brief_id JOIN call_compilations c ON c.id=p.compilation_id
        WHERE p.id=${id} AND ${this.available(tx)} FOR SHARE OF p,c`;
      if (!row) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
      await tx`INSERT INTO plan_review_audit(case_id,actor_id,action,reason_ciphertext)
        VALUES(${id},${actor},'evidence.accessed',${encryptJson(parsed.reason, this.key)})`;
      const audit = await tx`SELECT id,reason_ciphertext FROM plan_review_audit WHERE case_id=${id} ORDER BY created_at DESC,id DESC LIMIT 100`;
      return planReviewEvidenceSchema.parse({ compilation: callCompilationSchema.parse(decryptJson(String(row.compilation_ciphertext), this.key)),
        note: row.note_ciphertext ? decryptJson(String(row.note_ciphertext), this.key) : null,
        audit: audit.map(a => ({ id: a.id, reason: a.reason_ciphertext ? decryptJson(String(a.reason_ciphertext), this.key) : null })) });
    });
  }
  async update(id: string, actor: string, input: PlanReviewUpdate) {
    const parsed = planReviewUpdateSchema.parse(input);
    await this.sql.begin(async tx => {
      await authorize(tx, actor);
      const [brief] = await tx`SELECT b.id FROM plan_review_cases p JOIN call_briefs b ON b.id=p.call_brief_id
        JOIN call_compilations c ON c.id=p.compilation_id WHERE p.id=${id} AND ${this.available(tx)} FOR SHARE OF b`;
      if (!brief) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
      if (parsed.assigneeId) await authorize(tx, parsed.assigneeId);
      const changed = await tx`UPDATE plan_review_cases SET status=${parsed.status},resolution=${parsed.resolution},
        assignee_id=${parsed.assigneeId},note_ciphertext=${parsed.note ? encryptJson(parsed.note, this.key) : null},revision=revision+1,updated_at=now()
        WHERE id=${id} AND revision=${parsed.expectedRevision} RETURNING id`;
      if (!changed.length) throw new PlanReviewError("PLAN_REVIEW_STALE");
      await tx`INSERT INTO plan_review_audit(case_id,actor_id,action,reason_ciphertext,metadata)
        VALUES(${id},${actor},'case.updated',${encryptJson(parsed.reason, this.key)},${tx.json({ status: parsed.status,
          resolution: parsed.resolution, assigneeId: parsed.assigneeId, revision: parsed.expectedRevision + 1 })})`;
    });
  }
  async retryEmail(id: string, deliveryId: string, actor: string, reason: string) {
    const parsed = sensitiveCallAccessInputSchema.parse({ reason });
    await this.sql.begin(async tx => {
      await authorize(tx, actor);
      // Do not acquire the source/brief lock here: dispatch locks settings before
      // notification and deletion locks brief before notification. No new email
      // is sent here; the worker rechecks source, recipient, and current settings.
      const [row] = await tx`UPDATE superadmin_notifications n SET status='queued',send_attempts=0,first_send_at=NULL,
        delivery_generation=delivery_generation+1,payload_ciphertext=NULL,run_after=now(),updated_at=now(),last_error_code=NULL
        WHERE n.id=${deliveryId} AND n.kind='plan_review' AND n.source_id=${id} AND n.status='failed'
          AND EXISTS(SELECT 1 FROM plan_review_cases p JOIN call_briefs b ON b.id=p.call_brief_id
            JOIN call_compilations c ON c.id=p.compilation_id WHERE p.id=${id} AND ${this.available(tx)})
        RETURNING n.id`;
      if (!row) throw new PlanReviewError("PLAN_REVIEW_EMAIL_NOT_RETRYABLE");
      await tx`INSERT INTO plan_review_audit(case_id,actor_id,action,reason_ciphertext,metadata)
        VALUES(${id},${actor},'email.retry_requested',${encryptJson(parsed.reason, this.key)},${tx.json({ deliveryId })})`;
      await tx`INSERT INTO superadmin_notification_audit(actor_user_id,notification_id,action,reason)
        VALUES(${actor},${deliveryId},'delivery.retry_requested','See encrypted plan review audit')`;
    });
  }
}
async function authorize(sql: postgres.TransactionSql, id: string) {
  const rows = await sql`SELECT id FROM users WHERE id=${id} AND role='superadmin' AND status='active'
    AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=users.id AND d.status<>'completed') FOR SHARE`;
  if (!rows.length) throw new PlanReviewError("PLAN_REVIEW_FORBIDDEN", 403);
}
function date(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }
function mapCase(r: Record<string, unknown>) {
  return planReviewCaseSchema.parse({ id: r.id, compilationId: r.compilation_id, callId: r.call_brief_id, preparationId: r.preparation_id,
    userId: r.user_id, planRevision: r.plan_revision, snapshotHash: r.snapshot_hash, previousCaseId: r.previous_case_id,
    decision: r.decision, category: r.category, reasons: r.reasons, riskLevel: r.risk_level, callLocale: r.call_locale,
    compilerVersion: r.compiler_version, policyVersion: r.policy_version, model: r.model,
    status: r.status, resolution: r.resolution, assigneeId: r.assignee_id, revision: r.revision, historical: r.historical,
    occurredAt: date(r.occurred_at), updatedAt: date(r.updated_at), repeats: r.repeats,
    emailFailed: r.email_failed, emailPending: r.email_pending, emailAccepted: r.email_accepted });
}
function encodeCursor(time: string, id: string) { return Buffer.from(`${time}|${id}`).toString("base64url"); }
function decodeCursor(value?: string) {
  if (!value) return null;
  const [time, id, extra] = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (extra || !time || !id || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(time) ||
    !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time.replace(/(\.\d{3})\d{3}Z$/, "$1Z") ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new PlanReviewError("PLAN_REVIEW_CURSOR_INVALID", 400);
  return { time, id };
}
export function createPlanReviewsFromEnv() {
  if ((process.env.STORAGE_DRIVER?.trim() || "memory") !== "postgres") return undefined;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for plan review");
  return new PlanReviewService(process.env.DATABASE_URL, parseDataEncryptionKeyring(process.env));
}
