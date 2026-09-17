import postgres from "postgres";
import { fetchOpenAIBilling, fetchTwilioBilling, saveBillingSnapshots } from "./provider-billing";

export async function syncProviderBilling(env = process.env, now = new Date(), force = false) {
  if (!env.DATABASE_URL) return [];
  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const results: Array<{ provider: string; status: string; days?: number; code?: string }> = [];
  try {
    // One session-level lock covers fetching and atomic snapshot publication.
    const [lock] = await sql`SELECT pg_try_advisory_lock(715927644) AS acquired`;
    if (!lock?.acquired) return [{ provider: "all", status: "already_running" }];
    for (const provider of ["twilio", "openai"] as const) {
      const scope = provider === "twilio" ? env.TWILIO_ACCOUNT_SID : env.OPENAI_PROJECT_ID;
      const credential = provider === "twilio" ? env.TWILIO_AUTH_TOKEN : env.OPENAI_ADMIN_API_KEY;
      if (!scope || !credential) { results.push({ provider, status: "not_configured" }); continue; }
      const [latest] = await sql`SELECT max(observed_at) AS at FROM provider_billing_snapshots WHERE provider=${provider} AND scope_key=${scope}`;
      if (!force && latest?.at && now.getTime() - new Date(latest.at).getTime() < 3_600_000) continue;
      try {
        const snapshots = provider === "twilio"
          ? await fetchTwilioBilling(scope, credential, from, to)
          : await fetchOpenAIBilling(credential, scope, from, to);
        await saveBillingSnapshots(sql, snapshots, new Date().toISOString());
        results.push({ provider, status: "synced", days: snapshots.length });
      } catch (error) {
        // Credentials and provider response bodies must never enter application logs.
        results.push({ provider, status: "sync_failed", code: error instanceof Error && /^BILLING_[A-Z0-9_]+$/.test(error.message) ? error.message : "BILLING_FETCH_FAILED" });
      }
    }
    return results;
  } finally {
    await sql`SELECT pg_advisory_unlock(715927644)`.catch(() => undefined);
    await sql.end();
  }
}

export function startProviderBillingSync(onResult: (result: Awaited<ReturnType<typeof syncProviderBilling>>) => void) {
  let running: Promise<void> | null = null;
  let stopped = false;
  const run = () => {
    if (running || stopped) return;
    running = syncProviderBilling().then(onResult).catch(() => onResult([{ provider: "all", status: "sync_failed" }])).finally(() => { running = null; });
  };
  const timer = setInterval(run, 3_600_000);
  timer.unref();
  run();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
