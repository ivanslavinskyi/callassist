import { resolveEmailLocale } from "../auth/communication-locales";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { notificationSettingsSchema, notificationSettingsUpdateSchema, notificationViewSchema,
  type NotificationSettings, type NotificationSettingsUpdate, type NotificationView } from "@callassist/contracts";
import { EmailDeliveryError, type AdminNotificationEmail, type AdminNotificationEmailProvider } from "../auth/email-provider";
import type { EmailBranding } from "../auth/email-branding";
import { decryptJson, encryptJson, type DataEncryptionMaterial } from "../security/encryption";
import type { CallRepository } from "../storage/call-repository";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";
import { NotificationReportReader, type NotificationEvent } from "./notification-report";
import { callNotificationEmail, registrationNotificationEmail } from "./notification-email";

type Sql = postgres.Sql | postgres.TransactionSql;
type Delivery = NotificationEvent & {
  recipient_user_id:string; status:string; lease_owner:string|null; payload_ciphertext:string|null;
  send_attempts:number; first_send_at:Date|null;
};
export class NotificationSettingsError extends Error {
  constructor(readonly code:"NOTIFICATION_SETTINGS_STALE"|"NOTIFICATION_RECIPIENT_INVALID"|"NOTIFICATION_FORBIDDEN") { super(code); }
}
export interface NotificationAdmin {
  getView(): Promise<NotificationView>;
  update(input: NotificationSettingsUpdate, actor: string): Promise<void>;
  close(): Promise<void>;
}

export class SuperadminNotifications implements NotificationAdmin {
  private readonly sql: postgres.Sql;
  private readonly reports: NotificationReportReader;
  private readonly workerId = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  constructor(databaseUrl: string, private readonly key: DataEncryptionMaterial, private readonly email: AdminNotificationEmailProvider,
    private readonly branding: EmailBranding, calls: CallRepository,
    private readonly options: { now?:()=>Date; onError?:(error:unknown)=>void; keepAlive?:boolean } = {}) {
    this.sql=postgres(databaseUrl,{max:3,onnotice:()=>undefined});
    this.reports=new NotificationReportReader(this.sql,key,calls);
  }
  private now() { return this.options.now?.() ?? new Date(); }

  async getView(): Promise<NotificationView> {
    const [[row],recipients,deliveries] = await Promise.all([
      this.sql<{settings:NotificationSettings;revision:number}[]>`SELECT settings,revision FROM superadmin_notification_settings WHERE id=true`,
      this.sql`SELECT id,concat_ws(' ',first_name,last_name) AS name,email FROM users WHERE role='superadmin' AND status='active'
        AND email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=users.id AND d.status<>'completed') ORDER BY created_at`,
      this.sql`SELECT id,kind,source_id AS "sourceId",recipient_user_id AS "recipientUserId",status,send_attempts AS attempts,
        created_at AS "createdAt",updated_at AS "updatedAt",last_error_code AS "errorCode",provider_id AS "providerId"
        FROM superadmin_notifications ORDER BY created_at DESC,id DESC LIMIT 50`
    ]);
    return notificationViewSchema.parse({...row,recipients,deliveries:deliveries.map(d=>({...d,createdAt:d.createdAt.toISOString(),updatedAt:d.updatedAt.toISOString()}))});
  }

  async update(input: NotificationSettingsUpdate, actor: string) {
    const parsed=notificationSettingsUpdateSchema.parse(input), settings=parsed.settings;
    await this.sql.begin(async tx=>{
      if (!await eligibleRecipient(tx,actor)) throw new NotificationSettingsError("NOTIFICATION_FORBIDDEN");
      const [current]=await tx<{settings:NotificationSettings;revision:number}[]>`SELECT settings,revision FROM superadmin_notification_settings WHERE id=true FOR UPDATE`;
      if (current?.revision!==parsed.expectedRevision) throw new NotificationSettingsError("NOTIFICATION_SETTINGS_STALE");
      for (const id of settings.recipientUserIds) if (!await eligibleRecipient(tx,id)) throw new NotificationSettingsError("NOTIFICATION_RECIPIENT_INVALID");
      await tx`UPDATE superadmin_notification_settings SET settings=${tx.json(settings)},revision=revision+1,updated_at=now() WHERE id=true`;
      await tx`UPDATE superadmin_notifications SET status='cancelled',payload_ciphertext=NULL,lease_owner=NULL,lease_until=NULL,
        last_error_code='NOTIFICATIONS_DISABLED',updated_at=now() WHERE status IN ('queued','processing') AND (
          NOT ${settings.enabled} OR (kind='registration' AND NOT ${settings.registrations}) OR (kind='call' AND NOT ${settings.calls})
          OR NOT (recipient_user_id::text IN (SELECT jsonb_array_elements_text(${tx.json(settings.recipientUserIds)}::jsonb))))`;
      await tx`INSERT INTO superadmin_notification_audit(actor_user_id,action,reason,previous_settings,next_settings)
        VALUES(${actor},'settings.updated',${parsed.reason},${tx.json(current.settings)},${tx.json(settings)})`;
    });
  }

  start() {
    if (this.timer || this.stopped) return;
    this.timer=setInterval(()=>{void this.tick();},5_000);
    if (!this.options.keepAlive) this.timer.unref();
    void this.tick();
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped) return Promise.resolve();
    this.running=this.drain().catch(error=>(this.options.onError ?? (e=>writePiiSafeOperationalError("superadmin_notification_worker_failed",e)))(error))
      .finally(()=>{this.running=null;});
    return this.running;
  }
  async close() {
    this.stopped=true;
    if(this.timer) clearInterval(this.timer);
    await this.running;
    await this.sql.end();
  }
  private async drain() {
    const now=this.now();
    // Retain delivery metadata, but expire failed message bodies after seven days.
    await this.sql`UPDATE superadmin_notifications SET payload_ciphertext=NULL WHERE payload_ciphertext IS NOT NULL
      AND status IN ('accepted','failed','cancelled') AND updated_at<${new Date(now.getTime()-7*86400_000)}`;
    for(let index=0;index<10 && !this.stopped;index++) {
      const [row]=await this.sql<Delivery[]>`UPDATE superadmin_notifications SET status='processing',lease_owner=${this.workerId},
        lease_until=${new Date(this.now().getTime()+120_000)},updated_at=${this.now()}
        WHERE id=(SELECT id FROM superadmin_notifications WHERE run_after<=${this.now()}
          AND (status='queued' OR (status='processing' AND lease_until<=${this.now()}))
          ORDER BY run_after,created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
      if(!row) return;
      try { await this.process(row); }
      catch {
        // Never persist raw provider, SQL, source text, or email errors.
        await this.sql`UPDATE superadmin_notifications SET status=CASE WHEN send_attempts>=7 THEN 'failed' ELSE 'queued' END,
          send_attempts=send_attempts+1,last_error_code='NOTIFICATION_PROCESSING_FAILED',run_after=${new Date(this.now().getTime()+60_000)},
          lease_owner=NULL,lease_until=NULL,updated_at=${this.now()} WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId}`;
      }
    }
  }
  private async process(row: Delivery) {
    let message:AdminNotificationEmail|null=row.payload_ciphertext ? decryptJson(row.payload_ciphertext,this.key) : null;
    if(!message) {
      const recipient=await eligibleRecipient(this.sql,row.recipient_user_id);
      if(!recipient) { await this.cancel(row,"RECIPIENT_UNAVAILABLE"); return; }
      const report=row.kind==='registration' ? await this.reports.registration(row) : await this.reports.call(row,this.now());
      if(report==='pending') {
        await this.sql`UPDATE superadmin_notifications SET status='queued',run_after=${new Date(this.now().getTime()+10_000)},
          lease_owner=NULL,lease_until=NULL WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId}`;
        return;
      }
      if(!report) { await this.cancel(row,"SOURCE_UNAVAILABLE"); return; }
      message={to:recipient.email,idempotencyKey:`superadmin-notification:${row.id}`,
        content:'userId' in report ? registrationNotificationEmail(report,this.branding,resolveEmailLocale(recipient.uiLocale)) : callNotificationEmail(report,this.branding,resolveEmailLocale(recipient.uiLocale))};
      const saved=await this.sql`UPDATE superadmin_notifications SET payload_ciphertext=${encryptJson(message,this.key)},
        first_send_at=COALESCE(first_send_at,${this.now()}) WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId}`;
      if(!saved.count) return;
    }
    const frozen=message;
    await this.sql.begin(async tx=>{
      // Settings changes wait only for an already dispatched, bounded provider request.
      const [config]=await tx<{settings:NotificationSettings}[]>`SELECT settings FROM superadmin_notification_settings WHERE id=true FOR SHARE`;
      const [current]=await tx<Delivery[]>`SELECT * FROM superadmin_notifications WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId} FOR UPDATE`;
      if(!current) return;
      const settings=notificationSettingsSchema.parse(config?.settings);
      const recipient=await eligibleRecipient(tx,row.recipient_user_id);
      const source=await sourceAvailable(tx,row);
      if(!settings.enabled || !(row.kind==='registration'?settings.registrations:settings.calls) || !settings.recipientUserIds.includes(row.recipient_user_id)
        || !recipient || recipient.email!==frozen.to || !source || !current.payload_ciphertext) {
        await this.finish(tx,row.id,"cancelled",null,"NOTIFICATION_NO_LONGER_ALLOWED"); return;
      }
      // Automatic retries must stay inside the provider's deduplication horizon.
      if(!current.first_send_at || this.now().getTime()-current.first_send_at.getTime()>20*3600_000) {
        await this.finish(tx,row.id,"failed",null,"DELIVERY_WINDOW_EXPIRED"); return;
      }
      await tx`UPDATE superadmin_notifications SET send_attempts=send_attempts+1 WHERE id=${row.id}`;
      await tx`INSERT INTO superadmin_notification_audit(notification_id,action) VALUES(${row.id},'delivery.attempted')`;
      try {
        const providerId=await this.email.sendAdminNotification(frozen);
        await this.finish(tx,row.id,"accepted",providerId,null);
      } catch(error) {
        const retryable=!(error instanceof EmailDeliveryError) || error.retryable;
        const attempt=current.send_attempts+1;
        if(!retryable || attempt>=8) await this.finish(tx,row.id,"failed",null,retryable?"DELIVERY_RETRIES_EXHAUSTED":"DELIVERY_REJECTED");
        else await tx`UPDATE superadmin_notifications SET status='queued',run_after=${new Date(this.now().getTime()+Math.max(Math.min(900_000,30_000*2**(attempt-1)),error instanceof EmailDeliveryError ? error.retryAfterMs : 0))},
          lease_owner=NULL,lease_until=NULL,last_error_code='DELIVERY_RETRY_SCHEDULED',updated_at=${this.now()} WHERE id=${row.id}`;
      }
    });
  }
  private async finish(sql:Sql,id:string,status:"accepted"|"failed"|"cancelled",providerId:string|null,error:string|null) {
    await sql`UPDATE superadmin_notifications SET status=${status},provider_id=${providerId},last_error_code=${error},
      payload_ciphertext=CASE WHEN ${status}='failed' THEN payload_ciphertext ELSE NULL END,
      lease_owner=NULL,lease_until=NULL,updated_at=${this.now()} WHERE id=${id}`;
  }
  private async cancel(row:Delivery,error:string) {
    await this.sql`UPDATE superadmin_notifications SET status='cancelled',payload_ciphertext=NULL,last_error_code=${error},
      lease_owner=NULL,lease_until=NULL,updated_at=${this.now()} WHERE id=${row.id} AND status='processing' AND lease_owner=${this.workerId}`;
  }
}
async function eligibleRecipient(sql:Sql,id:string) {
  const [user]=await sql<{email:string;uiLocale:string}[]>`SELECT email,ui_locale AS "uiLocale" FROM users WHERE id=${id} AND status='active' AND role='superadmin'
    AND email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=users.id AND d.status<>'completed')`;
  return user ?? null;
}
async function sourceAvailable(sql:Sql,event:NotificationEvent) {
  const [row]=await sql`SELECT 1 WHERE
    (${event.source_user_id}::uuid IS NULL OR EXISTS(SELECT 1 FROM users u WHERE u.id=${event.source_user_id} AND u.status<>'deleted'
      AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed')))
    AND (${event.call_brief_id}::uuid IS NULL OR EXISTS(SELECT 1 FROM call_briefs WHERE id=${event.call_brief_id} AND data_deleted_at IS NULL))`;
  return !!row;
}
