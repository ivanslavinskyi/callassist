import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { approvedCall } from "./voice-test-helpers";
import { liveDurationUsage, liveResponsesUsage } from "./live-usage";
import { buildAdminCostOverview } from "../admin-operations";
import { unavailableOperationalCostPolicy } from "../config/operational-cost-policy";
import { openAIPublicPricingVersion } from "../config/provider-pricing-policy";

const fixture = isolatedTestDatabase();
let call: Awaited<ReturnType<typeof approvedCall>>;
let repository: PostgresCallRepository;
let sql: postgres.Sql;
beforeAll(async () => {
  await fixture.setup();
  sql = postgres(fixture.url, { max: 1 });
  repository = new PostgresCallRepository(fixture.url, Buffer.alloc(32, 7));
  call = await approvedCall(undefined, repository);
});
afterAll(async () => { await call?.service.close(); await repository?.close(); await sql?.end(); await fixture.teardown(); });

describe("native Live persisted evidence", () => {
  it("roundtrips exact, late fragments with native timing and retains legacy transcripts", async () => {
    const timing = { sessionId: "live-storage", eventId: "late", sessionStartedAt: "2026-09-25T00:00:00.000Z", startMs: 1000, endMs: 1500 };
    await call.service.addRealtimeTranscript(call.brief.id, "assistant", "Legacy opening", "opening");
    await call.service.addNativeLiveTranscript(call.brief.id, "recipient", " Yes", "late", timing);
    const transcript = (await repository.get(call.brief.id))!.transcript;
    expect(transcript.filter(t => t.text === " Yes")).toHaveLength(1);
    expect(transcript.find(t => t.text === " Yes")).toMatchObject({ nativeTiming: timing, createdAt: "2026-09-25T00:00:01.000Z" });
    expect(transcript.find(t => t.text === "Legacy opening")?.nativeTiming).toBeUndefined();
  });
  it("persists final voice seconds and Responses tokens once with versioned prices in admin reporting", async () => {
    const parent = randomUUID(), child = randomUUID();
    const startedAt = new Date().toISOString();
    await call.service.startRealtimeProviderSessions([{ id: parent, provider: "openai", operationType: "realtime_session",
      stage: "live_conversation", requestedModel: "gpt-live-1", clientRequestId: parent, startedAt,
      callBriefId: call.brief.id, callAttemptId: call.attempt.id }]);
    await call.service.recordRealtimeProviderOperation({ id: child, parentOperationId: parent, provider: "openai", operationType: "realtime_response",
      stage: "live_delegation", requestedModel: "gpt-6-luna", clientRequestId: child, startedAt,
      callBriefId: call.brief.id, callAttemptId: call.attempt.id, result: null });
    for (const [id, model, usage] of [
      [child, "gpt-6-luna", liveResponsesUsage({ input_tokens: 1000, output_tokens: 100, total_tokens: 1100 })],
      [parent, "gpt-live-1", liveDurationUsage(90.5, true)]
    ] as const) {
      const completion = { operationId: id, outcome: "succeeded" as const, providerRequestId: null, providerResponseId: id,
        providerModel: model, statusCode: null, completedAt: new Date().toISOString(), durationMs: 90_500, errorCode: null, usage };
      await call.service.completeProviderOperation(completion);
      await call.service.completeProviderOperation(completion);
    }
    const rows = await sql`SELECT pricing_version, duration_seconds, raw_usage FROM provider_usage_records WHERE operation_id IN (${parent}, ${child})`;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.pricing_version === openAIPublicPricingVersion)).toBe(true);
    expect(rows.find(r => r.duration_seconds !== null)?.raw_usage).toMatchObject({ seconds: 90.5, finalized: true });
    const from = new Date(Date.now() - 60_000).toISOString(), to = new Date(Date.now() + 60_000).toISOString();
    const cost = buildAdminCostOverview(await repository.getAdminOperationsFacts(from, to, call.brief.id), unavailableOperationalCostPolicy);
    expect(cost.providerUsage.components.realtimeAudio.calculatedUsdMicros).toBe(75_417);
    expect(cost.providerUsage.components.realtimeText.calculatedUsdMicros).toBe(150);
    expect(cost.providerUsage.components.realtime.calculatedUsdMicros).toBe(75_567);
    expect(cost.providerUsage.calculatedUsdMicros).toBe(75_567);
  });
});
