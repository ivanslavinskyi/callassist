import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { CallService } from "../call-service";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { createApprovedExecutionSnapshot } from "@callassist/contracts";
import { encryptJson } from "../security/encryption";

it("persists AMD admission, one-time voicemail, usage and late completion across processes", async () => {
  const db = isolatedTestDatabase();
  await db.setup();
  const key = Buffer.alloc(32, 47);
  const repository = new PostgresCallRepository(db.url, key);
  const second = new PostgresCallRepository(db.url, key);
  const sql = postgres(db.url, { max: 1 });
  const service = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  try {
    const brief = await service.create({ recipientName: "Office", phoneNumber: "+41523686688", objective: "Ask when the office opens tomorrow",
      assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Owner", locale: "en-GB", allowedFacts: [], voicemailPolicy: "leave_neutral_message" });
    await repository.approveCompilation(brief.id, await originalPlanReview(repository, brief.id));
    const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
    const providerCallId = `CA${randomUUID().replaceAll("-", "")}`;
    const input = { attemptId: attempt.id, providerCallId, snapshotHash: attempt.compilationSnapshotHash!, now: new Date().toISOString() };
    const resolve = { ...input, kind: "resolve" as const, answeredBy: "machine_end_beep", durationMs: 4100 };
    const raced = await Promise.all([repository.transitionAnswering(brief.id, resolve), second.transitionAnswering(brief.id, resolve)]);
    expect(raced.filter(r => r.applied)).toHaveLength(1);
    // The callback can beat the REST create response. Attaching it later must preserve the decision.
    await repository.attachProviderCall(attempt.id, providerCallId, "queued");
    expect(await second.getLatestAttempt(brief.id)).toMatchObject({ providerCallId, executionSnapshot: { version: 3 } });
    expect((await second.transitionAnswering(brief.id, { ...input, kind: "admit" })).applied).toBe(false);
    const operations = await sql`SELECT o.operation_type, u.request_count FROM provider_operations o
      JOIN provider_usage_records u ON u.operation_id=o.id WHERE o.call_attempt_id=${attempt.id}`;
    expect(operations.map(o => o.operation_type).sort()).toEqual(["answering_detection", "voicemail_tts"]);
    expect(operations.every(o => o.request_count === 1)).toBe(true);
    await repository.applyProviderStatus(providerCallId, "completed", "completed", brief.id);
    expect((await second.get(brief.id))?.brief.lifecycle).toMatchObject({ result: "voicemail_detected", consent: "not_requested", answering: { message: "unknown" } });
    await second.transitionAnswering(brief.id, { ...input, kind: "complete" });
    expect((await repository.get(brief.id))?.brief.lifecycle?.answering?.message).toBe("playback_completed");
    expect((await repository.get(brief.id))?.recording).toBeNull();
    expect((await repository.get(brief.id))?.transcript).toEqual([]);
    expect((await second.transitionAnswering(brief.id, resolve)).applied).toBe(false);
    const repeated = await service.repeatUnansweredCall(brief.id, null);
    expect(repeated.status).toBe("review_required");
    const costs = await service.getAdminCallCostBreakdown(brief.id);
    expect(costs.cost.providerUsage.components.telephony.calculatedUsdMicros).toBe(8_300);
    expect(costs.cost.providerUsage.records?.filter(r => ["answering_detection", "voicemail_tts"].includes(r.operationType)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ operationType: "voicemail_tts", costBasis: "usage_estimate", calculatedUsdMicros: 800 })]));

    // Seed a genuine old immutable approval, rather than modifying one in place.
    const draft = (await repository.get(repeated.id))!;
    const approvedAt = new Date().toISOString();
    const current = createApprovedExecutionSnapshot({ brief: draft.brief, compilation: { ...draft.compilation!, approvedAt } });
    const { answering: _policy, ...legacy } = current as Extract<typeof current, { version: 3 }>;
    const [compilation] = await sql`SELECT current_compilation_id AS id FROM call_briefs WHERE id=${repeated.id}`;
    await sql`INSERT INTO call_compilation_approvals(id,compilation_id,call_brief_id,revision,snapshot_hash,approved_at,execution_snapshot_ciphertext)
      VALUES (${randomUUID()},${compilation.id},${repeated.id},${draft.compilation!.revision},${draft.compilation!.snapshotHash},${approvedAt},${encryptJson({ ...legacy, version: 2 },key)})`;
    await sql`UPDATE call_briefs SET status='ready' WHERE id=${repeated.id}`;
    expect(await repository.refreshAnsweringApproval(repeated.id)).toBe(true);
    const refreshed = (await repository.get(repeated.id))!;
    expect(refreshed.brief.status).toBe("review_required");
    expect(refreshed.compilation?.compiledBrief).toEqual(draft.compilation?.compiledBrief);
    expect(refreshed.compilation?.revision).toBe(draft.compilation!.revision + 1);
    expect((await sql`SELECT id FROM call_compilation_approvals WHERE compilation_id=${compilation.id}`)).toHaveLength(1);
    await repository.approveCompilation(repeated.id, await originalPlanReview(repository,repeated.id));
    expect(await repository.refreshAnsweringApproval(repeated.id)).toBe(false);
  } finally { await service.close(); await second.close(); await sql.end(); await db.teardown(); }
}, 60_000);
