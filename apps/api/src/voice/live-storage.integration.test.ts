import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { approvedCall, authorization, proposal } from "./voice-test-helpers";
import { decryptJson } from "../security/encryption";
import { genericCiphertextColumns } from "../db/encrypted-columns";
import { exportSources } from "../telemetry-export/sources";
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
  it("projects the frozen full disclosure of this attempt without regenerating approved data", async () => {
    const snapshot = await repository.get(call.brief.id);
    expect(snapshot?.initialDisclosure).toEqual({ callAttemptId: call.attempt.id,
      version: "assistance-inline-v1", locale: call.snapshot.plan.callLocale, text: call.snapshot.runtime.initialDisclosure?.text });
    expect(snapshot?.initialDisclosure?.text).toContain("Nina Keller");
  });
  it("recovers one encrypted action conservatively and projects its current attempt state", async () => {
    const fixtureCall = await approvedCall(authorization, repository, "en-GB", "CA-RECOVERY");
      const input = { callBriefId: fixtureCall.brief.id, callAttemptId: fixtureCall.attempt.id,
        snapshotHash: fixtureCall.snapshot.compilationSnapshotHash, proposal: { ...proposal, operation: "book" as const },
        content: "Approved appointment", evidence: [],
        delivery: { kind: "request" as const, status: "not_sent" as const, attempt: 1 } };
      const action = (await repository.beginVoiceAction(input))!;
      const uncertain = (await repository.transitionVoiceAction({ id: action.id, version: action.version, state: "uncertain", evidence: [],
        delivery: { ...input.delivery, status: "unacknowledged" } }))!;
      expect((await repository.get(input.callBriefId))?.appointmentAction).toMatchObject({
        callAttemptId: input.callAttemptId, state: "uncertain", delivery: { status: "unacknowledged", attempt: 1 } });
      expect(await repository.transitionVoiceAction({ id: action.id, version: uncertain.version, state: "sending", evidence: [],
        delivery: { kind: "request", status: "not_sent", attempt: 2 } })).toBeNull();
      const recovery = (await repository.transitionVoiceAction({ id: action.id, version: uncertain.version, state: "sending", evidence: [],
        delivery: { kind: "status_check", status: "not_sent", attempt: 2 } }))!;
      const delivered = (await repository.transitionVoiceAction({ id: action.id, version: recovery.version, state: "delivered", evidence: [],
        delivery: { kind: "status_check", status: "played", attempt: 2 } }))!;
      const confirmed = await repository.transitionVoiceAction({ id: action.id, version: delivered.version, state: "confirmed", evidence: ["later-exact-reply"] });
      expect(confirmed).toMatchObject({ id: action.id, state: "confirmed", proposal: input.proposal,
        delivery: { kind: "status_check", status: "played", attempt: 2 } });
      expect((await repository.get(input.callBriefId))?.appointmentAction?.state).toBe("confirmed");
      expect((await repository.exportCallTextData(input.callBriefId)).voiceActions).toEqual([confirmed]);
      const [row] = await sql`SELECT payload_ciphertext FROM call_voice_actions WHERE id=${action.id}`;
      expect(decryptJson(row!.payload_ciphertext, Buffer.alloc(32, 7))).toMatchObject({ delivery: confirmed!.delivery });
  });
  it("persists the approved voice and content-free confirmations for the same attempt", async () => {
    expect((await repository.getLatestAttempt(call.brief.id))?.executionSnapshot?.runtime.liveVoice).toBe("marin");
    await repository.appendCallTelemetryEvent(call.brief.id, { callAttemptId: call.attempt.id, idempotencyKey: "voice-confirmed", payload: {
      name: "realtime.voice", metadata: { requestedVoice: "marin", confirmedVoice: "marin", sessionId: "live-storage",
        model: "gpt-live-1", phase: "consent", result: "confirmed" }
    } });
    expect((await repository.listCallTelemetryEvents(call.brief.id)).find(e => e.payload.name === "realtime.voice")?.payload.metadata)
      .toMatchObject({ requestedVoice: "marin", confirmedVoice: "marin", sessionId: "live-storage" });
  });
  it("journals one immutable action per attempt, uses versioned transitions, and redacts its encrypted content", async () => {
    const fixtureCall = await approvedCall(authorization, repository, "en-GB", "CA-ACTION");
    const input = { callBriefId: fixtureCall.brief.id, callAttemptId: fixtureCall.attempt.id,
      snapshotHash: fixtureCall.snapshot.compilationSnapshotHash, proposal: { ...proposal, operation: "book" as const },
      content: "Please confirm the approved appointment.", evidence: ["turn-1"] };
    expect(await repository.beginVoiceAction({ ...input, snapshotHash: "stale" })).toBeNull();
    const raced = await Promise.all([repository.beginVoiceAction(input), repository.beginVoiceAction(input)]);
    expect(raced.filter(Boolean)).toHaveLength(1);
    const action = raced.find(value => value)!;
    const [row] = await sql`SELECT * FROM call_voice_actions WHERE id=${action.id}`;
    expect(row!.payload_ciphertext).not.toContain(input.content);
    expect(decryptJson(row!.payload_ciphertext, Buffer.alloc(32, 7))).toEqual(input);
    expect(genericCiphertextColumns).toContainEqual(["call_voice_actions", "payload_ciphertext"]);
    expect(exportSources.find(source => source.table === "call_voice_actions")?.fields).not.toContain("payload_ciphertext");
    expect(await repository.transitionVoiceAction({ id: action.id, version: 1, state: "confirmed", evidence: ["invented"] })).toBeNull();
    const delivered = await repository.transitionVoiceAction({ id: action.id, version: 1, state: "delivered", evidence: [] });
    expect(delivered?.version).toBe(2);
    expect(await repository.transitionVoiceAction({ id: action.id, version: 1, state: "uncertain", evidence: [] })).toBeNull();
    const confirmed = await repository.transitionVoiceAction({ id: action.id, version: 2, state: "confirmed", evidence: ["turn-2"] });
    expect(confirmed).toMatchObject({ version: 3, state: "confirmed", evidence: ["turn-1", "turn-2"] });
    expect((await repository.exportCallTextData(input.callBriefId)).voiceActions).toEqual([confirmed]);
    const owner = randomUUID();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
      VALUES (${owner},${`${owner}@example.com`},'test-only','+41710000002',now(),'Test','Owner','user','active','en',now())`;
    await sql`UPDATE call_briefs SET user_id=${owner},status='completed' WHERE id=${input.callBriefId}`;
    await repository.setNativeTranscriptCapture(input.callBriefId, input.callAttemptId, {
      version: 1, status: "complete", sessionId: "deleted-session", model: "gpt-live-1", updatedAt: new Date().toISOString()
    });
    await repository.deleteCallData({ callId: input.callBriefId, userId: owner, requestId: randomUUID(),
      providerRecordingDisposition: "not_present", deletedAt: new Date().toISOString() });
    expect((await sql`SELECT payload_ciphertext FROM call_voice_actions WHERE id=${action.id}`)[0]?.payload_ciphertext).toBeNull();
    expect((await sql`SELECT native_transcript_capture FROM call_attempts WHERE id=${input.callAttemptId}`)[0]?.native_transcript_capture).toBeNull();
    expect(await repository.beginVoiceAction(input)).toBeNull();
    expect(await repository.transitionVoiceAction({ id: action.id, version: 3, state: "confirmed", evidence: [] })).toBeNull();
    await expect(repository.exportCallTextData(input.callBriefId)).rejects.toThrow("CALL_NOT_FOUND");
  });
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
