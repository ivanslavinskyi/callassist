import { registrationPolicySchema, type RegistrationPolicy, analyticsSettingsSchema, type AnalyticsSettingsView, type AnalyticsSettings } from "@callassist/contracts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { betaSettingsSchema, type BetaSettings, type BetaSettingsUpdate, type BetaControlsView } from "@callassist/contracts";
import { readBetaSpend, readBetaReservations, postCallCommittedMicros, postCallReserveSlots } from "./beta-spend-accounting";
import { betaCreditPolicySchema, type BetaCreditPolicy, type PublicBetaAccess, type BetaCreditTransitionInput, type BetaCreditTransitionPreview } from "@callassist/contracts";
import { betaCreditPeriod } from "../credits/beta-credit-period";
import { ensureBetaCredits } from "../credits/postgres-beta-credits";

export type SpendKind = "call" | "text" | "transcription" | "sms" | "email";
export class BetaControlError extends Error {
  constructor(readonly code: "BETA_REGISTRATION_FULL" | "BETA_INVITATION_INVALID" | "BETA_SPENDING_PAUSED" |
    "BETA_BUDGET_UNCONFIGURED" | "BETA_BUDGET_EXHAUSTED" | "BETA_CONCURRENCY_LIMIT" |
    "BETA_RECIPIENT_LIMIT" | "BETA_SETTINGS_STALE" | "BETA_ADMIN_FORBIDDEN") { super(code); }
}
export interface BetaControls {
  getPublicRegistration?(): Promise<PublicBetaAccess>;
  updateCreditPolicy?(policy: BetaCreditPolicy, expectedRevision: number, actor: string, reason: string): Promise<void>;
  previewCreditTransition?(): Promise<BetaCreditTransitionPreview>;
  applyCreditTransition?(input: BetaCreditTransitionInput, actor: string): Promise<{ updated: number }>;
  getView(): Promise<BetaControlsView>;
  getRegistrationPolicy(): Promise<import("@callassist/contracts").RegistrationPolicy>;
  getAnalytics(): Promise<AnalyticsSettingsView>;
  updateRegistration(settings: RegistrationPolicy, expectedRevision: number, actor: string, reason: string): Promise<void>;
  updateAnalytics(settings: AnalyticsSettings, expectedRevision: number, actor: string): Promise<void>;
  update(settings: BetaSettingsUpdate["settings"], expectedRevision: number, actor: string, reason: string): Promise<void>;
  createInvitation(actor: string, reason: string): Promise<{ id: string; code: string; expiresAt: string }>;
  revokeInvitation(id: string, actor: string, reason: string): Promise<void>;
  reserve(kind: SpendKind, key: string): Promise<void>;
  assertAvailable(kind: SpendKind): Promise<void>;
}
type Row = { settings: BetaSettings; revision: number; public_accounts: number; invited_accounts: number; updated_at: Date; reason: string; credit_policy_id: string };
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
export async function reserveBetaSpend(tx: postgres.TransactionSql, kind: SpendKind, key: string, settings?: BetaSettings, minimumReserveMicros = 0) {
  const policy = settings ?? (await lockBetaControls(tx)).settings;
  if (!policy.spendingEnabled) throw new BetaControlError("BETA_SPENDING_PAUSED");
  if (policy.rollingDayBudgetMicros === null) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
  const existing = await tx`SELECT reservation_key FROM beta_spend_reservations WHERE reservation_key=${key} AND kind=${kind}`;
  if (existing.count) return;
  const configuredAmount = kind === "call" ? Math.ceil(policy.maxDurationSeconds / 60) * policy.callMinuteReserveMicros + 10_000 :
    kind === "text" ? policy.textRequestReserveMicros : kind === "transcription" ? policy.transcriptionRequestReserveMicros * (key.startsWith("postcall:") ? postCallReserveSlots : 1) :
    kind === "sms" ? policy.smsReserveMicros : policy.emailReserveMicros;
  if (!Number.isSafeInteger(minimumReserveMicros) || minimumReserveMicros < 0) throw new Error("Invalid request reserve");
  const amount = Math.max(configuredAmount, minimumReserveMicros);
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
export async function reservePostCallProviderSpend(tx: postgres.TransactionSql, attemptId: string, operationId: string, policy: BetaSettings) {
  if (!policy.spendingEnabled) throw new BetaControlError("BETA_SPENDING_PAUSED");
  if (policy.rollingDayBudgetMicros === null) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
  const pool = (await readBetaReservations(tx)).find(r => r.key === `postcall:${attemptId}`);
  // The original pool fixes the size of each unknown request's allowance even if
  // an administrator changes settings later. Existing ledger rows make retries idempotent.
  if (pool?.postCallPending && (pool.operations.some(o => o.id === operationId) ||
      postCallCommittedMicros(pool) + pool.amount / postCallReserveSlots <= pool.amount)) return;
  // Legacy calls and overruns still pass the normal monetary admission gate.
  await reserveBetaSpend(tx, "transcription", `provider:${operationId}`, policy);
}
function budgetSignal(event: string, reservedMicros: number, limitMicros: number, currency: string) {
  process.stderr.write(`${JSON.stringify({ level: "warn", time: new Date().toISOString(), event, reservedMicros, limitMicros, currency })}\n`);
}
// Admission counts observed expenses plus reservations for unresolved expenses.
export class PostgresBetaControls implements BetaControls {
  constructor(readonly sql: postgres.Sql) {}
  async getPublicRegistration(): Promise<PublicBetaAccess> {
    const [row] = await this.sql<Row[]>`SELECT settings,public_accounts FROM beta_controls WHERE id=true`;
    if (!row) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
    const settings = betaSettingsSchema.parse(row.settings);
    const remaining = Math.max(0, settings.publicAccountLimit - row.public_accounts);
    return { state: remaining ? "open" : "full", remaining: settings.showRegistrationRemaining ? remaining : null,
      allowance: settings.creditAllowance, timeZone: "UTC" };
  }
  async updateCreditPolicy(policy: BetaCreditPolicy, expectedRevision: number, actor: string, reason: string) {
    const parsed = betaCreditPolicySchema.parse(policy);
    await this.sql.begin(async tx => {
      const row = await lockBetaControls(tx); await requireBetaAdmin(tx, actor);
      if (row.revision !== expectedRevision) throw new BetaControlError("BETA_SETTINGS_STALE");
      if (row.settings.creditAllowance.amount === parsed.amount && row.settings.creditAllowance.period === parsed.period) return;
      const id = randomUUID(), next = { ...row.settings, creditAllowance: parsed };
      await tx`INSERT INTO beta_credit_policies(id,amount,period) VALUES(${id},${parsed.amount},${parsed.period})`;
      await tx`UPDATE beta_controls SET credit_policy_id=${id},settings=${tx.json(next)},revision=revision+1,updated_at=now(),reason=${reason} WHERE id=true`;
      await tx`INSERT INTO beta_control_audit(id,actor_user_id,action,reason,previous_settings,next_settings,target_id)
        VALUES(${randomUUID()},${actor},'credits.default_updated',${reason},${tx.json(row.settings)},${tx.json(next)},${id})`;
    });
  }
  async previewCreditTransition() {
    return this.sql.begin(async tx => {
      const row = await lockBetaControls(tx);
      return (await creditTransitionPreview(tx, row, new Date())).preview;
    });
  }
  async applyCreditTransition(input: BetaCreditTransitionInput, actor: string) {
    return this.sql.begin(async tx => {
      const row = await lockBetaControls(tx); await requireBetaAdmin(tx, actor);
      if (row.revision !== input.expectedRevision || row.credit_policy_id !== input.policyId) throw new BetaControlError("BETA_SETTINGS_STALE");
      const now = new Date(), { preview, accounts } = await creditTransitionPreview(tx, row, now);
      if (preview.previewToken !== input.previewToken) throw new BetaControlError("BETA_SETTINGS_STALE");
      for (const account of accounts) {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${account.id},0))`;
        const active = await tx`SELECT id FROM users WHERE id=${account.id} AND status='active' AND role='user' AND phone_verified_at IS NOT NULL FOR SHARE`;
        if (!active.count) throw new BetaControlError("BETA_SETTINGS_STALE");
        // Preserve owed lifetime grants and the current period before scheduling.
        await ensureBetaCredits(tx, account.id, now, true);
        if (account.effectiveAt > now.toISOString()) {
          await tx`UPDATE beta_credit_enrollments SET pending_policy_id=${row.credit_policy_id},pending_effective_at=${account.effectiveAt}
            WHERE user_id=${account.id}`;
        } else {
          await tx`INSERT INTO beta_credit_enrollments(user_id,policy_id,effective_at,lifetime_grant_allowed)
            VALUES(${account.id},${row.credit_policy_id},${now},false)
            ON CONFLICT (user_id) DO UPDATE SET policy_id=EXCLUDED.policy_id,effective_at=EXCLUDED.effective_at,
              lifetime_grant_allowed=false,pending_policy_id=NULL,pending_effective_at=NULL`;
        }
      }
      await tx`UPDATE beta_controls SET revision=revision+1,updated_at=now(),reason=${input.reason} WHERE id=true`;
      await tx`INSERT INTO beta_control_audit(id,actor_user_id,action,reason,target_id,previous_settings,next_settings)
        VALUES(${randomUUID()},${actor},'credits.existing_applied',${input.reason},${row.credit_policy_id},
        ${tx.json({ previewToken: preview.previewToken })},${tx.json({ policy: preview.policy, accounts: accounts.map(a => ({ userId: a.id, effectiveAt: a.effectiveAt })) })})`;
      return { updated: accounts.length };
    });
  }
  async getRegistrationPolicy() {
    const [row] = await this.sql<Row[]>`SELECT settings FROM beta_controls WHERE id=true`;
    if (!row) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
    return betaSettingsSchema.parse(row.settings).registration;
  }
  async getAnalytics(): Promise<AnalyticsSettingsView> {
    const [row] = await this.sql<Row[]>`SELECT settings,revision FROM beta_controls WHERE id=true`;
    return { settings: betaSettingsSchema.parse(row?.settings).analytics, revision: row!.revision };
  }
  async updateRegistration(settings: RegistrationPolicy, expectedRevision: number, actor: string, reason: string) {
    const registration = registrationPolicySchema.parse(settings);
    await this.sql.begin(async tx => {
      const row = await lockBetaControls(tx);
      await requireBetaAdmin(tx, actor);
      if (row.revision !== expectedRevision) throw new BetaControlError("BETA_SETTINGS_STALE");
      const next = { ...row.settings, registration };
      await tx`UPDATE beta_controls SET settings=${tx.json(next)},revision=revision+1,updated_at=now(),reason=${reason} WHERE id=true`;
      await tx`INSERT INTO beta_control_audit(id,actor_user_id,action,reason,previous_settings,next_settings)
        VALUES(${randomUUID()},${actor},'settings.updated',${reason},${tx.json(row.settings)},${tx.json(next)})`;
    });
  }
  async updateAnalytics(settings: AnalyticsSettings, expectedRevision: number, actor: string) {
    const parsed = analyticsSettingsSchema.parse(settings);
    await this.sql.begin(async tx => {
      const row = await lockBetaControls(tx);
      const actors = await tx`SELECT id FROM users WHERE id=${actor} AND role IN ('admin','superadmin') AND status='active' FOR SHARE`;
      if (!actors.count) throw new BetaControlError("BETA_ADMIN_FORBIDDEN");
      if (row.revision !== expectedRevision) throw new BetaControlError("BETA_SETTINGS_STALE");
      const next = { ...row.settings, analytics: parsed };
      await tx`UPDATE beta_controls SET settings=${tx.json(next)},revision=revision+1,updated_at=now(),reason='Analytics settings' WHERE id=true`;
      await tx`INSERT INTO beta_control_audit(id,actor_user_id,action,reason,previous_settings,next_settings)
        VALUES(${randomUUID()},${actor},'settings.updated','Analytics settings',${tx.json(row.settings)},${tx.json(next)})`;
    });
  }
  async reserve(kind: SpendKind, key: string) {
    await this.sql.begin(tx => reserveBetaSpend(tx, kind, key));
  }
  async assertAvailable(kind: SpendKind) {
    const view = await this.getView(), s = view.settings;
    if (!s.spendingEnabled) throw new BetaControlError("BETA_SPENDING_PAUSED");
    if (s.rollingDayBudgetMicros === null) throw new BetaControlError("BETA_BUDGET_UNCONFIGURED");
    const amount = kind === "text" ? s.textRequestReserveMicros : kind === "sms" ? s.smsReserveMicros :
      kind === "email" ? s.emailReserveMicros : kind === "transcription" ? s.transcriptionRequestReserveMicros : Math.ceil(s.maxDurationSeconds / 60) * s.callMinuteReserveMicros + 10_000 + postCallReserveSlots * s.transcriptionRequestReserveMicros;
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
      const [{ unverified }] = await tx<{ unverified: number }[]>`SELECT count(*)::int AS unverified FROM users WHERE role='user' AND phone_verified_at IS NULL AND status<>'deleted'`;
      return { settings: s, revision: row.revision, creditPolicyId: row.credit_policy_id, unverifiedAccounts: unverified, publicAccounts: row.public_accounts, invitedAccounts: row.invited_accounts,
        activeCalls: active, ...spending, updatedAt: row.updated_at.toISOString(), reason: row.reason,
        budgetState: !s.spendingEnabled ? "paused" : s.rollingDayBudgetMicros === null ? "unconfigured" :
          reserved >= s.rollingDayBudgetMicros ? "exhausted" : reserved >= s.rollingDayBudgetMicros * .8 ? "warning" : "available",
        invitations: invitations.map(i => ({ id: i.id, createdAt: i.created_at.toISOString(), expiresAt: i.expires_at.toISOString(), status: i.status })) };
    });
  }
  async update(settings: BetaSettingsUpdate["settings"], expectedRevision: number, actor: string, reason: string) {
    const parsed = betaSettingsSchema.parse(settings);
    await this.sql.begin(async tx => {
      const row = await lockBetaControls(tx);
      await requireBetaAdmin(tx, actor);
      if (row.revision !== expectedRevision) throw new BetaControlError("BETA_SETTINGS_STALE");
      parsed.registration = row.settings.registration; // Separate endpoint protects policies from older settings clients.
      parsed.analytics = row.settings.analytics; // Analytics has its own update endpoint; older settings clients cannot reset it.
      parsed.creditAllowance = row.settings.creditAllowance; // A separate action creates immutable credit policy versions.
      if (settings.showRegistrationRemaining === undefined) parsed.showRegistrationRemaining = row.settings.showRegistrationRemaining;
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
async function creditTransitionPreview(tx: postgres.TransactionSql, row: Row, now: Date) {
  const users = await tx<{ id: string; policy_id: string | null; pending_policy_id: string | null;
    pending_effective_at: Date | null; period: BetaCreditPolicy["period"] | null; pending_period: BetaCreditPolicy["period"] | null }[]>`
    SELECT u.id,e.policy_id,e.pending_policy_id,e.pending_effective_at,p.period,pending.period AS pending_period
    FROM users u LEFT JOIN beta_credit_enrollments e ON e.user_id=u.id
    LEFT JOIN beta_credit_policies p ON p.id=e.policy_id LEFT JOIN beta_credit_policies pending ON pending.id=e.pending_policy_id
    WHERE u.status='active' AND u.role='user' AND u.phone_verified_at IS NOT NULL ORDER BY u.id`;
  const accounts = users.flatMap(user => {
    const due = user.pending_effective_at && user.pending_effective_at <= now;
    const currentPolicy = due ? user.pending_policy_id : user.policy_id;
    if (user.pending_policy_id === row.credit_policy_id || (currentPolicy === row.credit_policy_id && !user.pending_policy_id)) return [];
    const period = (due ? user.pending_period : user.period) ?? "lifetime";
    const effectiveAt = betaCreditPeriod(period, now)?.endsAt ?? now.toISOString();
    return [{ id: user.id, currentPolicy, pendingPolicy: user.pending_policy_id, effectiveAt }];
  });
  const ids = accounts.map(a => a.id);
  const [totals] = ids.length ? await tx<{ persistent: number; reserved: number }[]>`
    SELECT COALESCE(sum(amount) FILTER(WHERE beta_period_id IS NULL),0)::int AS persistent,
      count(*) FILTER(WHERE type='call_reservation' AND NOT EXISTS(SELECT 1 FROM credit_transactions s
        WHERE s.call_attempt_id=t.call_attempt_id AND s.type IN ('call_charge','call_refund')))::int AS reserved
    FROM credit_transactions t WHERE user_id=ANY(${ids}::uuid[])` : [{ persistent: 0, reserved: 0 }];
  // Immediate transitions use a stable sentinel so the preview survives time passing.
  const previewToken = createHash("sha256").update(JSON.stringify({ revision: row.revision, policyId: row.credit_policy_id,
    accounts: accounts.map(a => ({ ...a, effectiveAt: a.effectiveAt === now.toISOString() ? "immediate" : a.effectiveAt })) })).digest("hex");
  const preview: BetaCreditTransitionPreview = { policyId: row.credit_policy_id, revision: row.revision, policy: row.settings.creditAllowance,
    previewToken, accounts: accounts.length, immediate: accounts.filter(a => a.effectiveAt === now.toISOString()).length,
    atNextBoundary: accounts.filter(a => a.effectiveAt !== now.toISOString()).length,
    persistentCredits: totals!.persistent, activeReservations: totals!.reserved };
  return { preview, accounts };
}
function hashInvitation(code: string) { return createHash("sha256").update(code).digest("hex"); }
async function requireBetaAdmin(tx: postgres.TransactionSql, actor: string) {
  const rows = await tx`SELECT id FROM users WHERE id=${actor} AND role='superadmin' AND status='active' FOR SHARE`;
  if (!rows.count) throw new BetaControlError("BETA_ADMIN_FORBIDDEN");
}
