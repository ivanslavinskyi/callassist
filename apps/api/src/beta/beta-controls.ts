import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { betaSettingsSchema, type BetaSettings, type BetaControlsView } from "@callassist/contracts";
import { readBetaSpend } from "./beta-spend-accounting";

export type SpendKind = "call" | "text" | "transcription" | "sms" | "email";
export class BetaControlError extends Error {
  constructor(readonly code: "BETA_REGISTRATION_FULL" | "BETA_INVITATION_INVALID" | "BETA_SPENDING_PAUSED" |
    "BETA_BUDGET_UNCONFIGURED" | "BETA_BUDGET_EXHAUSTED" | "BETA_CONCURRENCY_LIMIT" |
    "BETA_RECIPIENT_LIMIT" | "BETA_SETTINGS_STALE" | "BETA_ADMIN_FORBIDDEN") { super(code); }
}
export interface BetaControls {
  getView(): Promise<BetaControlsView>;
  update(settings: BetaSettings, expectedRevision: number, actor: string, reason: string): Promise<void>;
  createInvitation(actor: string, reason: string): Promise<{ id: string; code: string; expiresAt: string }>;
  revokeInvitation(id: string, actor: string, reason: string): Promise<void>;
  reserve(kind: SpendKind, key: string): Promise<void>;
  assertAvailable(kind: SpendKind): Promise<void>;
}
type Row = { settings: BetaSettings; revision: number; public_accounts: number; invited_accounts: number; updated_at: Date; reason: string };
export function activeBetaCall(sql: postgres.Sql | postgres.TransactionSql) {
  // An uncertain create/stop response may leave a real call alive after a local
  // terminal state. Keep its slot until the provider confirms a terminal state;
  // timeLimit only bounds the connected call, not Twilio's queue wait.
  return sql`(ended_at IS NULL OR (provider='twilio' AND max_duration_seconds IS NOT NULL
    AND COALESCE(provider_status,'unknown') NOT IN ('completed','canceled','busy','failed','no-answer')))`;
}
export async function lockBetaControls(tx: postgres.TransactionSql) {
  const [row] = await tx<Row[]>`SELECT * FROM beta_controls WHERE id=true FOR UPDATE`;
  if (!row) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
  return { ...row, settings: betaSettingsSchema.parse(row.settings) };
}
export async function admitBetaRegistration(tx: postgres.TransactionSql, invitation?: string) {
  const row = await lockBetaControls(tx);
  if (invitation) {
    const consumed = await tx`UPDATE beta_invitations SET consumed_at=now()
      WHERE token_hash=${hashInvitation(invitation)} AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id`;
    if (!consumed.count) throw new BetaControlError("BETA_INVITATION_INVALID");
    await tx`UPDATE beta_controls SET invited_accounts=invited_accounts+1 WHERE id=true`;
  } else {
    if (row.public_accounts >= row.settings.publicAccountLimit) throw new BetaControlError("BETA_REGISTRATION_FULL");
    await tx`UPDATE beta_controls SET public_accounts=public_accounts+1 WHERE id=true`;
  }
}
export async function reserveBetaSpend(tx: postgres.TransactionSql, kind: SpendKind, key: string, settings?: BetaSettings) {
  const policy = settings ?? (await lockBetaControls(tx)).settings;
  if (!policy.spendingEnabled) throw new BetaControlError("BETA_SPENDING_PAUSED");
  if (policy.rollingDayBudgetMicros === null) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
  const existing = await tx`SELECT reservation_key FROM beta_spend_reservations WHERE reservation_key=${key} AND kind=${kind}`;
  if (existing.count) return;
  const amount = kind === "call" ? Math.ceil(policy.maxDurationSeconds / 60) * policy.callMinuteReserveMicros :
    kind === "text" ? policy.textRequestReserveMicros : kind === "transcription" ? policy.transcriptionRequestReserveMicros :
    kind === "sms" ? policy.smsReserveMicros : policy.emailReserveMicros;
  const { reservedMicros: total } = await readBetaSpend(tx);
  if (total + amount > policy.rollingDayBudgetMicros) {
    budgetSignal("beta_budget_request_blocked", total, policy.rollingDayBudgetMicros, policy.currency);
    throw new BetaControlError("BETA_BUDGET_EXHAUSTED");
  }
  await tx`INSERT INTO beta_spend_reservations(reservation_key,kind,amount_micros,currency) VALUES(${key},${kind},${amount},${policy.currency})`;
  if (total < policy.rollingDayBudgetMicros * .8 && total + amount >= policy.rollingDayBudgetMicros * .8) {
    budgetSignal("beta_budget_threshold_reached", total + amount, policy.rollingDayBudgetMicros, policy.currency);
  }
}
function budgetSignal(event: string, reservedMicros: number, limitMicros: number, currency: string) {
  process.stderr.write(`${JSON.stringify({ level: "warn", time: new Date().toISOString(), event, reservedMicros, limitMicros, currency })}\n`);
}
// Admission counts observed expenses plus reservations for unresolved expenses.
export class PostgresBetaControls implements BetaControls {
  constructor(readonly sql: postgres.Sql) {}
  async reserve(kind: SpendKind, key: string) {
    await this.sql.begin(tx => reserveBetaSpend(tx, kind, key));
  }
  async assertAvailable(kind: SpendKind) {
    const view = await this.getView(), s = view.settings;
    if (!s.spendingEnabled) throw new BetaControlError("BETA_SPENDING_PAUSED");
    if (s.rollingDayBudgetMicros === null) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
    const amount = kind === "text" ? s.textRequestReserveMicros : kind === "sms" ? s.smsReserveMicros :
      kind === "email" ? s.emailReserveMicros : kind === "transcription" ? s.transcriptionRequestReserveMicros : Math.ceil(s.maxDurationSeconds / 60) * s.callMinuteReserveMicros;
    if (view.reservedMicros + amount > s.rollingDayBudgetMicros) throw new BetaControlError("BETA_BUDGET_EXHAUSTED");
  }
  async getView(): Promise<BetaControlsView> {
    return this.sql.begin(async tx => {
      const row = await lockBetaControls(tx);
      const spending = await readBetaSpend(tx);
      const reserved = spending.reservedMicros;
      const [{ active }] = await tx<{ active: number }[]>`SELECT count(*)::int AS active FROM call_attempts WHERE ${activeBetaCall(tx)}`;
      const invitations = await tx<{ id: string; created_at: Date; expires_at: Date; status: BetaControlsView["invitations"][number]["status"] }[]>`
        SELECT id,created_at,expires_at,CASE WHEN consumed_at IS NOT NULL THEN 'used' WHEN revoked_at IS NOT NULL THEN 'revoked'
          WHEN expires_at<=now() THEN 'expired' ELSE 'available' END AS status FROM beta_invitations ORDER BY created_at DESC LIMIT 50`;
      const s = row.settings;
      return { settings: s, revision: row.revision, publicAccounts: row.public_accounts, invitedAccounts: row.invited_accounts,
        activeCalls: active, ...spending, updatedAt: row.updated_at.toISOString(), reason: row.reason,
        budgetState: !s.spendingEnabled ? "paused" : s.rollingDayBudgetMicros === null ? "unconfigured" :
          reserved >= s.rollingDayBudgetMicros ? "exhausted" : reserved >= s.rollingDayBudgetMicros * .8 ? "warning" : "available",
        invitations: invitations.map(i => ({ id: i.id, createdAt: i.created_at.toISOString(), expiresAt: i.expires_at.toISOString(), status: i.status })) };
    });
  }
  async update(settings: BetaSettings, expectedRevision: number, actor: string, reason: string) {
    const parsed = betaSettingsSchema.parse(settings);
    await this.sql.begin(async tx => {
      const row = await lockBetaControls(tx);
      await requireBetaAdmin(tx, actor);
      if (row.revision !== expectedRevision) throw new BetaControlError("BETA_SETTINGS_STALE");
      await tx`UPDATE beta_controls SET settings=${tx.json(parsed)},revision=revision+1,updated_at=now(),reason=${reason} WHERE id=true`;
      await tx`INSERT INTO beta_control_audit(id,actor_user_id,action,reason,previous_settings,next_settings)
        VALUES(${randomUUID()},${actor},'settings.updated',${reason},${tx.json(row.settings)},${tx.json(parsed)})`;
    });
  }
  async createInvitation(actor: string, reason: string) {
    const code = randomBytes(32).toString("base64url"), id = randomUUID();
    const expiresAt = new Date(Date.now()+7*86400000).toISOString();
    await this.sql.begin(async tx => {
      await lockBetaControls(tx);
      await requireBetaAdmin(tx, actor);
      await tx`INSERT INTO beta_invitations(id,token_hash,created_by_user_id,reason,expires_at)
        VALUES(${id},${hashInvitation(code)},${actor},${reason},${expiresAt})`;
      await tx`INSERT INTO beta_control_audit(id,actor_user_id,action,reason,target_id) VALUES(${randomUUID()},${actor},'invitation.created',${reason},${id})`;
    });
    return { id, code, expiresAt };
  }
  async revokeInvitation(id: string, actor: string, reason: string) {
    await this.sql.begin(async tx => {
      await lockBetaControls(tx); await requireBetaAdmin(tx, actor);
      const updated = await tx`UPDATE beta_invitations SET revoked_at=now() WHERE id=${id} AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id`;
      if (!updated.count) throw new BetaControlError("BETA_INVITATION_INVALID");
      await tx`INSERT INTO beta_control_audit(id,actor_user_id,action,reason,target_id) VALUES(${randomUUID()},${actor},'invitation.revoked',${reason},${id})`;
    });
  }
}
function hashInvitation(code: string) { return createHash("sha256").update(code).digest("hex"); }
async function requireBetaAdmin(tx: postgres.TransactionSql, actor: string) {
  const rows = await tx`SELECT id FROM users WHERE id=${actor} AND role='superadmin' AND status='active' FOR SHARE`;
  if (!rows.count) throw new BetaControlError("BETA_ADMIN_FORBIDDEN");
}
