import type postgres from "postgres";
import type { AdminOperationsOverview } from "@callassist/contracts";
import { parseBillingComponents } from "./provider-billing";

export async function readProviderBilling(sql: postgres.Sql, from: string, to: string, env = process.env): Promise<AdminOperationsOverview["cost"]["billing"]> {
  const reports: AdminOperationsOverview["cost"]["billing"] = [];
  for (const provider of ["openai", "twilio"] as const) {
    const scope = provider === "twilio" ? env.TWILIO_ACCOUNT_SID : env.OPENAI_PROJECT_ID;
    const supported = new Date(from).getUTCHours() === 0 && from.slice(11, 23) === "00:00:00.000";
    const firstDay = from.slice(0, 10);
    const lastDay = new Date(Date.parse(to) - 1).toISOString().slice(0, 10);
    const days = Math.floor((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(from)) / 86400000) + 1;
    const base = { provider, scope: scope ?? null, from, to, currency: "USD", totalMicros: null,
      observedAt: null, days: 0, expectedDays: Math.max(0, days), source: null, components: [] };
    if (!scope || !supported || days > 62) {
      reports.push({ ...base, status: !scope ? "not_configured" : "unsupported_window" });
      continue;
    }
    const rows = await sql<Array<{ day: string; total: number; observedAt: Date; source: "usage_api" | "costs_api" | "verified_import"; components: unknown }>>`
      SELECT DISTINCT ON (day) day::text, total_micros::double precision AS total,
        observed_at AS "observedAt", source, components
      FROM provider_billing_snapshots WHERE provider=${provider} AND scope_key=${scope}
        AND day>=${firstDay}::date AND day<=${lastDay}::date AND currency='USD'
      ORDER BY day,observed_at DESC`;
    if (!rows.length) { reports.push({ ...base, status: "awaiting_sync" }); continue; }
    const amounts = new Map<string, number>();
    for (const row of rows) for (const item of parseBillingComponents(row.components)) amounts.set(item.key, (amounts.get(item.key) ?? 0) + item.amountMicros);
    const observedAt = new Date(Math.min(...rows.map(row => row.observedAt.getTime()))).toISOString();
    reports.push({ ...base, totalMicros: rows.reduce((sum, row) => sum + row.total, 0), observedAt,
      source: rows[0]!.source, days: rows.length,
      status: rows.length < days ? "partial" : Date.now() - Date.parse(observedAt) > 2 * 3_600_000 ? "stale" : "available",
      components: [...amounts].map(([key, amountMicros]) => ({ key, amountMicros })) });
  }
  return reports;
}
