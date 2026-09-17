import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export type BillingComponent = { key: string; amountMicros: number };
export function parseBillingComponents(value: unknown): BillingComponent[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row.key !== "string" || !Number.isSafeInteger(row.amountMicros))) throw new Error("BILLING_COMPONENT_INVALID");
  return value;
}
export type BillingSnapshot = {
  provider: "twilio" | "openai"; scopeKey: string; day: string; currency: string;
  totalMicros: number; components: BillingComponent[]; source: "usage_api" | "costs_api" | "verified_import";
};

// These are independent categories. Never sum parent + child (e.g. SMS/Authy).
export const twilioBillingCategories = ["calls-outbound", "calls-inbound", "calls-media-stream-minutes", "sms", "authy-phone-verifications", "phonenumbers", "recordingstorage"] as const;
export function twilioBillingComponents(totalMicros: number, amounts: Map<string, number>): BillingComponent[] {
  const components = twilioBillingCategories.filter(key => amounts.has(key)).map(key => ({ key, amountMicros: amounts.get(key)! }));
  const remainder = totalMicros - components.reduce((sum, item) => sum + item.amountMicros, 0);
  if (remainder !== 0) components.push({ key: "other_or_adjustments" as typeof twilioBillingCategories[number], amountMicros: remainder });
  return components;
}

export function decimalMicros(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("BILLING_AMOUNT_INVALID");
  const raw = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error("BILLING_AMOUNT_INVALID");
  const [whole, decimal = ""] = raw.replace(/^-/, "").split(".");
  const micros = BigInt(whole!) * 1_000_000n + BigInt(decimal.slice(0, 6).padEnd(6, "0")) + (Number(decimal[6] ?? 0) >= 5 ? 1n : 0n);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("BILLING_AMOUNT_INVALID");
  return Number(micros) * (raw.startsWith("-") ? -1 : 1);
}

async function getJson(url: URL, authorization: string) {
  const response = await fetch(url, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`BILLING_HTTP_${response.status}`);
  return response.json();
}

export async function fetchTwilioBilling(account: string, token: string, from: string, to: string): Promise<BillingSnapshot[]> {
  const days = new Map<string, Map<string, number>>();
  for (const category of ["totalprice", ...twilioBillingCategories]) {
    let url: URL | null = new URL(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Usage/Records/Daily.json`);
    url.search = new URLSearchParams({ StartDate: from, EndDate: to, Category: category, PageSize: "1000" }).toString();
    let pages = 0;
    while (url) {
      if (++pages > 100 || url.origin !== "https://api.twilio.com" || !url.pathname.startsWith(`/2010-04-01/Accounts/${account}/Usage/Records/`)) throw new Error("BILLING_PAGE_INVALID");
      const body = await getJson(url, `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}`);
      if (!Array.isArray(body.usage_records)) throw new Error("BILLING_RESPONSE_INVALID");
      for (const row of body.usage_records) {
        const day = new Date(row.start_date).toISOString().slice(0, 10);
        if (day < from || day > to || row.category !== category || row.price_unit?.toUpperCase() !== "USD") throw new Error("BILLING_SCOPE_INVALID");
        const values = days.get(day) ?? new Map<string, number>();
        if (values.has(category)) throw new Error("BILLING_DUPLICATE_CATEGORY");
        values.set(category, decimalMicros(row.price));
        days.set(day, values);
      }
      url = body.next_page_uri ? new URL(body.next_page_uri, "https://api.twilio.com") : null;
    }
  }
  return [...days].filter(([, values]) => values.has("totalprice")).map(([day, values]) => ({
    provider: "twilio", scopeKey: account, day, currency: "USD", totalMicros: values.get("totalprice")!,
    components: twilioBillingComponents(values.get("totalprice")!, values), source: "usage_api"
  }));
}

export async function fetchOpenAIBilling(key: string, project: string, from: string, to: string): Promise<BillingSnapshot[]> {
  const url = new URL("https://api.openai.com/v1/organization/costs");
  url.search = new URLSearchParams({ start_time: String(Date.parse(`${from}T00:00:00Z`) / 1000),
    end_time: String(Date.parse(`${to}T00:00:00Z`) / 1000 + 86400), bucket_width: "1d", limit: "180" }).toString();
  url.searchParams.append("project_ids[]", project);
  url.searchParams.append("group_by[]", "line_item");
  url.searchParams.append("group_by[]", "project_id");
  const snapshots: BillingSnapshot[] = [];
  let page: string | null = null;
  for (let count = 0; count < 100; count++) {
    if (page) url.searchParams.set("page", page);
    const body = await getJson(url, `Bearer ${key}`);
    if (!Array.isArray(body.data)) throw new Error("BILLING_RESPONSE_INVALID");
    for (const bucket of body.data) {
      const day = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
      if (day < from || day > to || !Array.isArray(bucket.results)) throw new Error("BILLING_SCOPE_INVALID");
      const amounts = new Map<string, number>();
      for (const row of bucket.results) {
        if (row.project_id !== project || row.amount?.currency?.toUpperCase() !== "USD") throw new Error("BILLING_SCOPE_INVALID");
        const item = row.line_item || "other";
        amounts.set(item, (amounts.get(item) ?? 0) + decimalMicros(row.amount.value));
      }
      const components = [...amounts].map(([key, amountMicros]) => ({ key, amountMicros }));
      snapshots.push({ provider: "openai", scopeKey: project, day, currency: "USD", source: "costs_api",
        totalMicros: components.reduce((sum, item) => sum + item.amountMicros, 0), components });
    }
    if (!body.has_more) return snapshots;
    if (!body.next_page || body.next_page === page) throw new Error("BILLING_PAGE_INVALID");
    page = body.next_page;
  }
  throw new Error("BILLING_PAGE_LIMIT");
}

export async function saveBillingSnapshots(sql: postgres.Sql, snapshots: BillingSnapshot[], observedAt: string) {
  await sql.begin(async tx => {
    for (const row of snapshots) await tx`
      INSERT INTO provider_billing_snapshots(id,provider,scope_key,day,currency,total_micros,components,source,observed_at)
      VALUES(${randomUUID()},${row.provider},${row.scopeKey},${row.day}::date,${row.currency},${row.totalMicros},
        ${tx.json(row.components)},${row.source},${observedAt}::timestamptz) ON CONFLICT DO NOTHING`;
  });
}
