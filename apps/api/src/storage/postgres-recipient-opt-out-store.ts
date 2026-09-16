import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { parseSwissDestinationPhone } from "@callassist/contracts";
import { recipientContactHash, recipientContactStatuses, recipientOptOutReason, type OptOutChallengeInput, type RecipientOptOutStore } from "../safety/recipient-opt-out-store";

export class PostgresRecipientOptOutStore implements RecipientOptOutStore {
  constructor(private readonly sql: postgres.Sql, private readonly hashKey: Buffer) {}
  hash(phone: string) { return recipientContactHash(phone, this.hashKey); }

  async recordContact(tx: postgres.TransactionSql, attemptId: string, providerStatus: string) {
    if (!recipientContactStatuses.some(status => status === providerStatus)) return;
    await tx`INSERT INTO recipient_contact_evidence (recipient_hash, last_contact_at)
      SELECT recipient_contact_hash, now() FROM call_attempts
      WHERE id=${attemptId} AND provider='twilio' AND provider_call_id IS NOT NULL AND recipient_contact_hash IS NOT NULL
      ON CONFLICT (recipient_hash) DO UPDATE SET last_contact_at=GREATEST(recipient_contact_evidence.last_contact_at, EXCLUDED.last_contact_at)`;
  }

  async backfill() {
    // Bounded batches and row locks also allow API and worker startup together.
    while (await this.sql.begin(async tx => {
      const rows = await tx<{ id: string; phone: string; eligible: boolean; contactedAt: Date }[]>`
        SELECT a.id, b.phone_number AS phone, COALESCE(a.ended_at,a.started_at) AS "contactedAt",
          (a.provider_call_id IS NOT NULL AND (
            a.provider_status=ANY(${recipientContactStatuses}::text[]) OR EXISTS (
              SELECT 1 FROM call_events e WHERE e.call_attempt_id=a.id
              AND e.event_name IN ('provider.call_created','provider.status_changed','connection.confirmed')
              AND e.metadata->>'providerStatus'=ANY(${recipientContactStatuses}::text[])
            ))) AS eligible
        FROM recipient_contact_backfill q JOIN call_attempts a ON a.id=q.attempt_id
        JOIN call_briefs b ON b.id=a.call_brief_id
        WHERE a.compilation_id IS NOT DISTINCT FROM b.current_compilation_id
          OR a.recipient_contact_hash IS NOT NULL OR b.data_deleted_at IS NOT NULL
        ORDER BY a.id LIMIT 100 FOR UPDATE OF q,b SKIP LOCKED`;
      for (const row of rows) {
        const phone = parseSwissDestinationPhone(row.phone);
        if (phone) {
          const hash = this.hash(phone);
          await tx`UPDATE call_attempts SET recipient_contact_hash=COALESCE(recipient_contact_hash,${hash}) WHERE id=${row.id}`;
          if (row.eligible) await tx`INSERT INTO recipient_contact_evidence (recipient_hash,last_contact_at)
            SELECT recipient_contact_hash,${row.contactedAt} FROM call_attempts WHERE id=${row.id}
            ON CONFLICT (recipient_hash) DO UPDATE SET last_contact_at=GREATEST(recipient_contact_evidence.last_contact_at,EXCLUDED.last_contact_at)`;
        }
        await tx`DELETE FROM recipient_contact_backfill WHERE attempt_id=${row.id}`;
      }
      return rows.length;
    })) { /* continue until all available batches have been processed */ }
  }

  private async lock(tx: postgres.TransactionSql, phone: string) {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`recipient:${phone}`},0))`;
  }
  private async eligible(tx: postgres.TransactionSql, phone: string, includeSuppressed = false) {
    const [row] = await tx<{ eligible: boolean }[]>`SELECT
      EXISTS(SELECT 1 FROM recipient_contact_evidence WHERE recipient_hash=${this.hash(phone)})
      AND (${includeSuppressed} OR NOT EXISTS(SELECT 1 FROM recipient_suppressions WHERE phone_e164=${phone} AND lifted_at IS NULL)) AS eligible`;
    return row?.eligible === true;
  }
  async reserve(input: OptOutChallengeInput) {
    return this.sql.begin(async tx => {
      await this.lock(tx, input.phoneE164);
      await tx`DELETE FROM recipient_opt_out_challenges WHERE expires_at<=now()`;
      if (!await this.eligible(tx, input.phoneE164)) return false;
      const hash = this.hash(input.phoneE164);
      const recent = await tx`SELECT 1 FROM recipient_opt_out_challenges WHERE recipient_hash=${hash} AND created_at>now()-interval '60 seconds' LIMIT 1`;
      if (recent.count) return false;
      // A new request invalidates older codes/tokens for this purpose and phone.
      await tx`DELETE FROM recipient_opt_out_challenges WHERE recipient_hash=${hash}`;
      await tx`INSERT INTO recipient_opt_out_challenges (token_hash,recipient_hash) VALUES (${input.tokenHash},${hash})`;
      return true;
    });
  }
  async activate(input: OptOutChallengeInput) {
    await this.sql`UPDATE recipient_opt_out_challenges SET sent=true WHERE token_hash=${input.tokenHash} AND recipient_hash=${this.hash(input.phoneE164)} AND expires_at>now()`;
  }
  async claim(input: OptOutChallengeInput) {
    return this.sql.begin(async tx => {
      await this.lock(tx,input.phoneE164);
      if (!await this.eligible(tx,input.phoneE164)) return null;
      const claimId = randomUUID();
      const rows = await tx`UPDATE recipient_opt_out_challenges SET claim_id=${claimId},claim_until=now()+interval '30 seconds',attempts=attempts+1
        WHERE token_hash=${input.tokenHash} AND recipient_hash=${this.hash(input.phoneE164)}
        AND sent AND consumed_at IS NULL AND expires_at>now() AND attempts<8 AND (claim_until IS NULL OR claim_until<=now()) RETURNING token_hash`;
      return rows.count ? claimId : null;
    });
  }
  async finish(input: OptOutChallengeInput, claimId: string, approved: boolean) {
    return this.sql.begin(async tx => {
      await this.lock(tx,input.phoneE164);
      const rows = await tx`UPDATE recipient_opt_out_challenges SET claim_id=NULL,claim_until=NULL,consumed_at=CASE WHEN ${approved} THEN now() ELSE NULL END
        WHERE token_hash=${input.tokenHash} AND recipient_hash=${this.hash(input.phoneE164)} AND claim_id=${claimId}
        AND claim_until>now() AND expires_at>now() AND consumed_at IS NULL RETURNING token_hash`;
      if (!rows.count || !approved) return false;
      if (!await this.eligible(tx,input.phoneE164,true)) return false;
      const inserted = await tx`INSERT INTO recipient_suppressions (id,phone_e164,source,reason,created_by_user_id,created_at)
        VALUES (${randomUUID()},${input.phoneE164},'recipient_request',${recipientOptOutReason},NULL,now())
        ON CONFLICT (phone_e164) WHERE lifted_at IS NULL DO NOTHING RETURNING id`;
      // Staff may have blocked the phone while Verify was checking the code.
      if (!inserted.count) return true;
      await tx`INSERT INTO safety_events (id,event_type,actor_user_id,phone_e164,reason,metadata,created_at)
        VALUES (${randomUUID()},'recipient.suppressed',NULL,${input.phoneE164},${recipientOptOutReason},'{"source":"recipient_request"}'::jsonb,now())`;
      return true;
    });
  }
}
