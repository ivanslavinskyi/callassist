import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { BetaCreditPolicy, CreditFunding } from "@callassist/contracts";
import { betaCreditPeriod } from "./beta-credit-period";

type Enrollment = { policy_id: string; amount: number; period: BetaCreditPolicy["period"]; lifetime_grant_allowed: boolean;
  pending_policy_id: string | null; pending_effective_at: Date | null; pending_amount: number | null; pending_period: BetaCreditPolicy["period"] | null };
/** Caller holds the account advisory lock. Never acquires beta_controls or call locks. */
export async function ensureBetaCredits(tx: postgres.TransactionSql, userId: string, now: Date, grantLegacySignup = false) {
  await tx`UPDATE beta_credit_enrollments SET policy_id=pending_policy_id,effective_at=pending_effective_at,
    pending_policy_id=NULL,pending_effective_at=NULL,lifetime_grant_allowed=false
    WHERE user_id=${userId} AND pending_effective_at<=${now}`;
  const [enrollment] = await tx<Enrollment[]>`SELECT e.*,p.amount,p.period,
    pending.amount AS pending_amount,pending.period AS pending_period
    FROM beta_credit_enrollments e JOIN beta_credit_policies p ON p.id=e.policy_id
    LEFT JOIN beta_credit_policies pending ON pending.id=e.pending_policy_id WHERE e.user_id=${userId}`;
  const [owner] = await tx<{ verified: boolean }[]>`SELECT phone_verified_at IS NOT NULL AS verified FROM users WHERE id=${userId}`;
  if (!owner?.verified) return { enrollment, periodId: null as string | null, window: null as ReturnType<typeof betaCreditPeriod> };
  if ((!enrollment && grantLegacySignup) || (enrollment?.period === "lifetime" && enrollment.lifetime_grant_allowed)) {
    await tx`INSERT INTO credit_transactions(id,user_id,amount,type,reason,idempotency_key,created_at)
      VALUES(${randomUUID()},${userId},${enrollment?.amount ?? 3},'signup_grant','Phone verification signup grant',${`signup:${userId}`},${now})
      ON CONFLICT (idempotency_key) DO NOTHING`;
  }
  const window = enrollment ? betaCreditPeriod(enrollment.period, now) : null;
  if (!enrollment || !window) return { enrollment, periodId: null as string | null, window };
  const [period] = await tx<{ id: string }[]>`INSERT INTO beta_credit_periods(id,user_id,policy_id,starts_at,ends_at,amount)
    VALUES(${randomUUID()},${userId},${enrollment.policy_id},${window.startsAt},${window.endsAt},${enrollment.amount})
    ON CONFLICT (user_id,policy_id,starts_at) DO NOTHING RETURNING id`;
  const periodId = period?.id ?? (await tx<{ id: string }[]>`SELECT id FROM beta_credit_periods
    WHERE user_id=${userId} AND policy_id=${enrollment.policy_id} AND starts_at=${window.startsAt}`)[0]!.id;
  await tx`INSERT INTO credit_transactions(id,user_id,amount,type,reason,idempotency_key,created_at,beta_period_id)
    VALUES(${randomUUID()},${userId},${enrollment.amount},'beta_grant','Beta allowance for UTC calendar period',${`beta:${periodId}`},${now},${periodId})
    ON CONFLICT (idempotency_key) DO NOTHING`;
  return { enrollment, periodId, window };
}

export async function betaCreditFunding(tx: postgres.TransactionSql, userId: string, now: Date, grantLegacySignup = false) {
  const current = await ensureBetaCredits(tx, userId, now, grantLegacySignup);
  const [totals] = await tx<{ persistent: number; available: number; reserved: number; used: number }[]>`
    SELECT COALESCE(sum(t.amount) FILTER(WHERE t.beta_period_id IS NULL),0)::int AS persistent,
      COALESCE(sum(t.amount) FILTER(WHERE t.beta_period_id=${current.periodId}),0)::int AS available,
      count(*) FILTER(WHERE t.beta_period_id=${current.periodId} AND t.type='call_reservation' AND NOT EXISTS
        (SELECT 1 FROM credit_transactions s WHERE s.call_attempt_id=t.call_attempt_id AND s.type IN ('call_charge','call_refund')))::int AS reserved,
      count(*) FILTER(WHERE t.beta_period_id=${current.periodId} AND t.type='call_charge')::int AS used
    FROM credit_transactions t WHERE t.user_id=${userId}`;
  const e = current.enrollment;
  const funding: CreditFunding = { persistent: totals!.persistent, allowance: e ? {
    policyId: e.policy_id, period: e.period, limit: e.amount,
    available: totals!.available, reserved: totals!.reserved, used: totals!.used,
    startsAt: current.window?.startsAt ?? null, endsAt: current.window?.endsAt ?? null,
    lifetimeGrantAllowed: e.lifetime_grant_allowed,
    pending: e.pending_effective_at ? { policy: { amount: e.pending_amount!, period: e.pending_period! }, effectiveAt: e.pending_effective_at.toISOString() } : null
  } : null };
  return { funding, balance: totals!.persistent + totals!.available,
    reservationPeriodId: totals!.available > 0 ? current.periodId : null };
}
