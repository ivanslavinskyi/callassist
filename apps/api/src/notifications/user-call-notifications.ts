import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { EmailDeliveryError, type UserCallEmail, type UserCallEmailProvider } from "../auth/email-provider";
import type { EmailBranding } from "../auth/email-branding";
import { decryptJson, encryptJson, type DataEncryptionMaterial } from "../security/encryption";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";
import type { CallRepository } from "../storage/call-repository";
import { UserCallReportReader, type UserCallEvent } from "./user-call-report";
import { userCallEmail } from "./user-call-email";

type Sql = postgres.Sql | postgres.TransactionSql;
type Delivery = UserCallEvent & { id: string; payload_ciphertext: string | null; send_attempts: number; first_send_at: Date | null };
type FrozenDelivery = { message: UserCallEmail; transcriptRevisionId: string };

export class UserCallNotifications {
  private readonly sql: postgres.Sql;
  private readonly reports: UserCallReportReader;
  private readonly workerId = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  constructor(databaseUrl: string, private readonly key: DataEncryptionMaterial, private readonly email: UserCallEmailProvider,
    private readonly branding: EmailBranding, calls: CallRepository,
    private readonly options: { now?: () => Date; onError?: (error: unknown) => void; keepAlive?: boolean } = {}) {
    this.sql = postgres(databaseUrl, { max: 3, onnotice: () => undefined });
    this.reports = new UserCallReportReader(this.sql, key, calls);
  }
  private now() { return this.options.now?.() ?? new Date(); }
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.tick(); }, 5_000);
    if (!this.options.keepAlive) this.timer.unref();
    void this.tick();
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped) return Promise.resolve();
    this.running = this.drain().catch(error => (this.options.onError ?? (e => writePiiSafeOperationalError("user_call_notification_worker_failed", e)))(error))
      .finally(() => { this.running = null; });
    return this.running;
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
    await this.sql.end();
  }
  private async drain() {
    await this.sql`UPDATE user_call_notifications SET payload_ciphertext=NULL WHERE payload_ciphertext IS NOT NULL
      AND status IN ('accepted','failed','cancelled') AND updated_at<${new Date(this.now().getTime() - 7 * 86400_000)}`;
    for (let index = 0; index < 10 && !this.stopped; index++) {
      const [row] = await this.sql<Delivery[]>`UPDATE user_call_notifications SET status='processing',lease_owner=${this.workerId},
        lease_until=${new Date(this.now().getTime() + 120_000)},updated_at=${this.now()}
        WHERE id=(SELECT id FROM user_call_notifications WHERE run_after<=${this.now()}
          AND (status='queued' OR (status='processing' AND lease_until<=${this.now()}))
          ORDER BY run_after,created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
      if (!row) return;
      try { await this.process(row); }
      catch {
        await this.sql`UPDATE user_call_notifications SET status=CASE WHEN send_attempts>=7 THEN 'failed' ELSE 'queued' END,
          send_attempts=send_attempts+1,last_error_code='PROCESSING_FAILED',run_after=${new Date(this.now().getTime() + 60_000)},
          lease_owner=NULL,lease_until=NULL,updated_at=${this.now()} WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId}`;
      }
    }
  }
  private async process(row: Delivery) {
    let frozen = row.payload_ciphertext ? decryptJson<FrozenDelivery>(row.payload_ciphertext, this.key) : null;
    if (!frozen) {
      const recipient = await this.recipient(this.sql, row);
      if (!recipient) { await this.finish(this.sql, row.id, "cancelled", null, "RECIPIENT_UNAVAILABLE"); return; }
      const report = await this.reports.read(row, this.now());
      if (report === "pending") {
        await this.sql`UPDATE user_call_notifications SET status='queued',run_after=${new Date(this.now().getTime() + 30_000)},
          lease_owner=NULL,lease_until=NULL WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId}`;
        return;
      }
      if (!report) { await this.finish(this.sql, row.id, "cancelled", null, "NO_CONVERSATION_RESULT"); return; }
      frozen = { transcriptRevisionId: report.transcript.id, message: { to: recipient.email, locale: report.locale,
        idempotencyKey: `user-call-result:${row.id}`, content: userCallEmail(report, this.branding) } };
      const saved = await this.sql`UPDATE user_call_notifications SET payload_ciphertext=${encryptJson(frozen, this.key)},first_send_at=COALESCE(first_send_at,${this.now()})
        WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId}`;
      if (!saved.count) return;
    }
    const payload = frozen;
    await this.sql.begin(async tx => {
      // Same lock order as account/call deletion: owner, call, delivery. Locks keep
      // the destination and source valid throughout the bounded provider request.
      await tx`SELECT id FROM users WHERE id=${row.recipient_user_id} FOR SHARE`;
      await tx`SELECT id FROM call_briefs WHERE id=${row.call_brief_id} FOR SHARE`;
      const [current] = await tx<Delivery[]>`SELECT * FROM user_call_notifications WHERE id=${row.id}
        AND status='processing' AND lease_owner=${this.workerId} FOR UPDATE`;
      if (!current) return;
      const recipient = await this.recipient(tx, row);
      const [source] = await tx`SELECT id FROM final_transcript_revisions WHERE id=${payload.transcriptRevisionId}
        AND call_attempt_id=${row.call_attempt_id} AND call_brief_id=${row.call_brief_id} AND payload_ciphertext IS NOT NULL FOR SHARE`;
      if (!recipient || recipient.email !== payload.message.to || !source || !current.payload_ciphertext) {
        await this.finish(tx, row.id, "cancelled", null, "DELIVERY_NO_LONGER_ALLOWED"); return;
      }
      if (current.first_send_at && this.now().getTime() - current.first_send_at.getTime() >= 20 * 3600_000) {
        await this.finish(tx, row.id, "failed", null, "DELIVERY_WINDOW_EXPIRED"); return;
      }
      await tx`UPDATE user_call_notifications SET send_attempts=send_attempts+1,first_send_at=COALESCE(first_send_at,${this.now()}) WHERE id=${row.id}`;
      try {
        const providerId = await this.email.sendUserCallNotification(payload.message);
        await this.finish(tx, row.id, "accepted", providerId, null);
      } catch (error) {
        const retryable = !(error instanceof EmailDeliveryError) || error.retryable;
        const attempt = current.send_attempts + 1;
        if (!retryable || attempt >= 8) await this.finish(tx, row.id, "failed", null, retryable ? "DELIVERY_RETRIES_EXHAUSTED" : "DELIVERY_REJECTED");
        else await tx`UPDATE user_call_notifications SET status='queued',run_after=${new Date(this.now().getTime() + Math.max(Math.min(900_000, 30_000 * 2 ** (attempt - 1)), error instanceof EmailDeliveryError ? error.retryAfterMs : 0))},
          lease_owner=NULL,lease_until=NULL,last_error_code='DELIVERY_RETRY_SCHEDULED',updated_at=${this.now()} WHERE id=${row.id}`;
      }
    });
  }
  private async recipient(sql: Sql, row: UserCallEvent) {
    const [user] = await sql<{ email: string }[]>`SELECT u.email FROM users u JOIN call_briefs b ON b.user_id=u.id
      WHERE u.id=${row.recipient_user_id} AND b.id=${row.call_brief_id} AND u.status='active' AND u.email_verified_at IS NOT NULL
        AND b.data_deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed')`;
    return user;
  }
  private async finish(sql: Sql, id: string, status: "accepted" | "failed" | "cancelled", providerId: string | null, error: string | null) {
    await sql`UPDATE user_call_notifications SET status=${status},provider_id=${providerId},last_error_code=${error},
      payload_ciphertext=CASE WHEN ${status}='failed' THEN payload_ciphertext ELSE NULL END,
      lease_owner=NULL,lease_until=NULL,updated_at=${this.now()} WHERE id=${id} AND status='processing' AND lease_owner=${this.workerId}`;
  }
}
