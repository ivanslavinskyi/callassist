/** Read-only aggregate preflight; safe before or after the allowance migration. */
import "../src/config/load-env";
import postgres from "postgres";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const report = await sql.begin("read only", async tx => {
    const [ledger] = await tx`SELECT count(DISTINCT user_id)::int AS accounts,
      COALESCE(sum(amount),0)::bigint AS ledger_units,
      count(*) FILTER(WHERE type='call_reservation' AND NOT EXISTS(SELECT 1 FROM credit_transactions s
        WHERE s.call_attempt_id=t.call_attempt_id AND s.type IN ('call_charge','call_refund')))::int AS pending_reservations
      FROM credit_transactions t`;
    const [anomalies] = await tx`SELECT count(*) FILTER(WHERE units<0)::int AS negative_account_ledgers,
      COALESCE(min(units),0)::bigint AS minimum_account_ledger_units
      FROM (SELECT user_id,sum(amount) AS units FROM credit_transactions GROUP BY user_id) balances`;
    const [shape] = await tx`SELECT to_regclass('beta_credit_periods') IS NOT NULL AS allowance_schema`;
    const [accounts] = await tx`SELECT count(*) FILTER(WHERE phone_verified_at IS NULL AND role='user' AND status<>'deleted')::int AS unverified,
      count(*) FILTER(WHERE phone_verified_at IS NOT NULL AND status='active' AND role='user')::int AS eligible_accounts FROM users`;
    const funding = shape!.allowance_schema ? await tx`SELECT CASE WHEN beta_period_id IS NULL THEN 'persistent' ELSE 'periodic' END AS source,
      count(*)::int AS transactions,COALESCE(sum(amount),0)::bigint AS ledger_units FROM credit_transactions GROUP BY 1` : null;
    return { generatedAt: new Date().toISOString(), mode: "read_only", migrationRule: "Existing ledger rows remain persistent; compare aggregates before and after deployment.",
      ledger, accounts, anomalies, funding, note: "Periodic historical ledger units include expired periods; they are not a spendable balance. Existing untagged credits remain persistent." };
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally { await sql.end(); }
