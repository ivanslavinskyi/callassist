import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { buildAdminCostOverview } from "../admin-operations";
import { unavailableOperationalCostPolicy } from "../config/operational-cost-policy";
import { readProviderBilling } from "./read-provider-billing";
import { saveBillingSnapshots } from "./provider-billing";

const fixture = isolatedTestDatabase();
let sql: postgres.Sql;
let repository: PostgresCallRepository;
let callId: string;
const from = "2026-09-01T00:00:00.000Z";
const to = "2026-10-01T00:00:00.000Z";
beforeAll(async () => {
  await fixture.setup();
  sql = postgres(fixture.url, { max: 1 });
  repository = new PostgresCallRepository(fixture.url, Buffer.alloc(32, 7));
  const input = normalizeCreateCallBriefInput({ recipientName: "Expense test", phoneNumber: "+41710000061", objective: "Ask for office hours", assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Keller", assistanceReason: "speech_impairment", locale: "en-GB", allowLanguageSwitch: false, allowedFacts: [] });
  const brief = await repository.create(input, await new DeterministicBriefCompiler().compile(input));
  callId = brief.id;
});
afterAll(async () => { await repository?.close(); await sql?.end(); await fixture.teardown(); });

async function operation(type: string, startedAt: string, provider = "openai", model = "gpt-5.6") {
  const id = randomUUID();
  await sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_brief_id,started_at)
    VALUES(${id},${provider},${type},'test',${model},${id},${callId},${startedAt})`;
  return id;
}
async function usage(id: string, input: number | null, output: number | null, billable: number | null = null) {
  await sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,request_count,input_text_tokens,output_text_tokens,billable_seconds,raw_usage,observed_at)
    VALUES(${randomUUID()},${id},1,1,${input},${output},${billable},'{}',${from})`;
}
describe("expense accounting read model", () => {
  it("attributes late-imported charges to the service month and excludes the upper boundary", async () => {
    for (const [at, amount] of [["2026-07-01T12:00:00Z", 9010000], ["2026-09-16T16:26:59Z", 180200], [to, 9900000]] as const) {
      const id = await operation("telephony_leg", at, "twilio", "programmable_voice");
      await usage(id, null, null);
      await sql`INSERT INTO provider_cost_records(id,operation_id,provider,provider_cost_id,cost_basis,component,amount_micros,currency,raw_cost,observed_at)
        VALUES(${randomUUID()},${id},'twilio',${id},'provider_reported_actual','connectivity',${amount},'USD','{}','2026-09-17T00:00:00Z')`;
    }
    const cost = buildAdminCostOverview(await repository.getAdminOperationsFacts(from, to, callId), unavailableOperationalCostPolicy);
    expect(cost.providerReported.usdMicros).toBe(180200);
    expect(cost.providerReported.recordCount).toBe(1);
    expect(cost.providerUsage.components.telephony.usageRecords).toBe(1);
  });
  it("prices each request before summing and flags missing paid usage but not free moderation", async () => {
    for (let i = 0; i < 2; i++) await usage(await operation("transcription", "2026-09-05T12:00:00Z", "openai", "gpt-4o-transcribe"), 1, 1);
    await operation("brief_compilation", "2026-09-05T12:00:00Z");
    await operation("brief_moderation", "2026-09-05T12:00:00Z", "openai", "omni-moderation-latest");
    const cost = buildAdminCostOverview(await repository.getAdminOperationsFacts(from, to, callId), unavailableOperationalCostPolicy);
    // Each input costs 2.5 micro-dollars, rounded up to 3. Rounding the combined input would give 5.
    expect(cost.providerUsage.calculatedUsdMicros).toBe(26);
    expect(cost.providerUsage.missingUsageOperations).toBe(1);
    expect(cost.providerUsage.status).toBe("partial");
    expect(cost.providerUsage.records.filter(row => row.costBasis === "usage_estimate").reduce((sum, row) => sum + (row.calculatedUsdMicros ?? 0), 0)).toBe(26);
  });
  it("supplements missing measurements once and preserves original immutable facts", async () => {
    const id = await operation("telephony_leg", "2026-09-10T12:00:00Z", "twilio", "programmable_voice");
    await usage(id, null, null);
    for (let i = 0; i < 2; i++) await sql`INSERT INTO provider_usage_supplements(operation_id,observation_key,duration_seconds,billable_seconds,observed_at)
      VALUES(${id},'webhook-1',8,60,'2026-09-11T12:00:00Z') ON CONFLICT DO NOTHING`;
    const [row] = await sql`SELECT billable_seconds FROM effective_provider_usage WHERE operation_id=${id}`;
    expect(Number(row?.billable_seconds)).toBe(60);
    const [original] = await sql`SELECT billable_seconds FROM provider_usage_records WHERE operation_id=${id}`;
    expect(original?.billable_seconds).toBeNull();
    const [count] = await sql`SELECT count(*)::int AS count FROM effective_provider_usage WHERE operation_id=${id}`;
    expect(count?.count).toBe(1);
    await expect(sql`UPDATE provider_usage_supplements SET billable_seconds=120 WHERE operation_id=${id}`).rejects.toThrow("append-only");
  });
  it("uses only the latest billing snapshot per scope/day and marks missing days", async () => {
    const snapshot = { provider: "twilio" as const, scopeKey: "ACtest", day: "2026-09-01", currency: "USD", totalMicros: 10, components: [{ key: "sms", amountMicros: 10 }], source: "usage_api" as const };
    await saveBillingSnapshots(sql, [snapshot], "2026-09-01T12:00:00Z");
    await saveBillingSnapshots(sql, [{ ...snapshot, totalMicros: 20, components: [{ key: "sms", amountMicros: 20 }] }], "2026-09-02T12:00:00Z");
    await saveBillingSnapshots(sql, [{ ...snapshot, scopeKey: "ACother", totalMicros: 999 }], "2026-09-03T12:00:00Z");
    const reports = await readProviderBilling(sql, from, "2026-09-03T00:00:00.000Z", { TWILIO_ACCOUNT_SID: "ACtest" });
    expect(reports.find(r => r.provider === "twilio")).toMatchObject({ totalMicros: 20, days: 1, expectedDays: 2, status: "partial" });
  });
});
