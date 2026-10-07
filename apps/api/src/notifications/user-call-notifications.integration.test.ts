import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCreateCallBriefInput, type CallAssessmentDecision, type GoalAssessmentStatus } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { EmailDeliveryError, MockEmailProvider } from "../auth/email-provider";
import { UserCallNotifications } from "./user-call-notifications";

const db = isolatedTestDatabase(), key = Buffer.alloc(32, 24);
let sql: postgres.Sql, calls: PostgresCallRepository, email: MockEmailProvider, now: Date, service: UserCallNotifications;
let sequence = 0;
const workers: UserCallNotifications[] = [];
beforeAll(async () => { await db.setup(); sql = postgres(db.url, { max: 4 }); calls = new PostgresCallRepository(db.url, key); }, 30000);
afterAll(async () => { await calls?.close(); await sql?.end(); await db.teardown(); });
afterEach(async () => { vi.restoreAllMocks(); for (const worker of workers.splice(0)) await worker.close(); });
function worker() {
  const value = new UserCallNotifications(db.url, key, email, { siteUrl: "https://example.test" }, calls, { now: () => now, onError: error => { throw error; } });
  workers.push(value); return value;
}
beforeEach(async () => { await sql`TRUNCATE user_call_notifications`; email = new MockEmailProvider(); now = new Date(Date.now() + 60_000); service = worker(); });

async function fixture(withTranscript = true, withAssessment = true, goal: GoalAssessmentStatus = "achieved") {
  const owner = randomUUID();
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,email_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${owner},${`${owner}@example.test`},'test-only',${`+417500${String(++sequence).padStart(5, '0')}`},now(),now(),'Nina','Example','user','active','ru',now())`;
  await calls.grantSignupCredits(owner);
  const input = normalizeCreateCallBriefInput({ recipientName: "Gemeinde", phoneNumber: "+41523686688", objective: "Ask whether my application arrived",
    assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Example", locale: "de-CH", allowLanguageSwitch: false, allowedFacts: [] });
  const compilation = await new DeterministicBriefCompiler().compile(input);
  const brief = await calls.create(input, compilation, owner);
  await calls.updateContentLanguage(brief.id, "uk", 1);
  await calls.approveCompilation(brief.id, await originalPlanReview(calls, brief.id));
  const { attempt } = await calls.startAttempt(brief.id, { userId: owner, provider: "twilio" });
  await calls.attachProviderCall(attempt.id, `CA-${attempt.id}`, "in-progress");
  await sql`UPDATE users SET ui_locale='fr' WHERE id=${owner}`;
  if (withTranscript) {
    const { recording } = await calls.beginRecording(brief.id);
    await calls.attachProviderRecording(recording.id, `RE-${recording.id}`, "in-progress");
    await calls.applyRecordingStatus({ callBriefId: brief.id, recordingId: recording.id, providerCallId: `CA-${attempt.id}`,
      providerRecordingId: `RE-${recording.id}`, providerStatus: "completed", durationSeconds: 35, channels: 2 });
    await calls.claimFinalTranscript(recording.id, "fixture");
    await calls.completeFinalTranscript(recording.id, "Ist der Antrag da? Ja, er ist angekommen.", [
      { role: "assistant", text: "Ist der Antrag da?", startSeconds: 1, endSeconds: 3 },
      { role: "recipient", text: "Ja, er ist angekommen.", startSeconds: 4, endSeconds: 6 }
    ]);
    if (withAssessment) {
      const revision = (await calls.getCurrentTranscriptRevision(brief.id))!;
      const answer = revision.segments[1]!.id;
      const decision: CallAssessmentDecision = { conversation: { status: "confirmed", category: "task_answer", questionSegmentId: revision.segments[0]!.id,
        answerSegmentId: answer, answerQuote: "Ja, er ist angekommen." }, goal: { status: goal, sourceSegmentIds: [answer] },
        criteria: compilation.compiledBrief!.successCriteria.map((_, i) => ({ id: `criterion.${i}`, status: "achieved", sourceSegmentIds: [answer] })) };
      const artifact = await calls.enqueueTextArtifact({ callId: brief.id, kind: "call_summary", compilationId: attempt.compilationId!, transcriptRevisionId: revision.id,
        sourceHash: revision.sourceHash, targetLanguage: "uk", generatorVersion: "summary-v3:test:openai:fixture" });
      const job = (await calls.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: randomUUID(), now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }))!;
      const lease = { jobId: job.id, workerId: job.leaseOwner!, checkedAt: new Date().toISOString(), generation: job.generation, attemptNumber: job.attemptCount };
      await calls.claimTextArtifact(artifact.id, lease);
      await calls.completeTextArtifact(artifact.id, { schemaVersion: 2, assessment: decision,
        overview: [{ label: "Результат", text: "Заяву отримано.", findingIds: ["receipt"] }],
        findings: [{ id: "receipt", label: "Заява", text: "Заяву отримано.", certainty: "reported", sourceSegmentIds: [answer] }], nextSteps: [], unresolved: [] }, lease);
      await calls.completeDurableJob(job.id, job.leaseOwner!, new Date().toISOString(), lease);
    }
  }
  await calls.updateStatus(brief.id, "completed");
  return { owner, brief, attempt };
}

describe("owner result delivery", () => {
  it("uses creation UI language, exact source prose and transcript, independently of admin settings", async () => {
    const f = await fixture();
    expect(f.brief.creationUiLocale).toBe("ru");
    await service.tick();
    expect(email.userCallMessages).toHaveLength(1);
    const mail = email.userCallMessages[0]!;
    expect(mail.locale).toBe("ru"); expect(mail.content.subject).toBe("Результат вашего звонка");
    expect(mail.content.text).toContain("Результат: Заяву отримано.");
    expect(mail.content.text).toContain("Ja, er ist angekommen.");
    expect(mail.content.text).toContain(`/ru/app/calls/${f.brief.id}`);
    expect(email.adminMessages).toHaveLength(0);
    const [row] = await sql`SELECT status,payload_ciphertext FROM user_call_notifications`;
    expect(row).toMatchObject({ status: "accepted", payload_ciphertext: null });
  });
  it("deduplicates terminal updates and concurrent workers", async () => {
    const f = await fixture(); await calls.updateStatus(f.brief.id, "completed");
    await Promise.all([service.tick(), worker().tick()]); await worker().tick();
    expect(email.userCallMessages).toHaveLength(1);
    expect(await sql`SELECT id FROM user_call_notifications`).toHaveLength(1);
  });
  it("freezes encrypted payload and key across an uncertain send and restart", async () => {
    const send = vi.spyOn(email, "sendUserCallNotification").mockRejectedValueOnce(new EmailDeliveryError(true));
    await fixture(); await service.tick();
    const [row] = await sql`SELECT * FROM user_call_notifications`;
    expect(row!.status).toBe("queued"); expect(row!.payload_ciphertext).not.toContain("example.test");
    expect(row!.first_send_at).not.toBeNull();
    now = new Date(now.getTime() + 60_000); await worker().tick();
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    expect(email.userCallMessages).toHaveLength(1);
  });
  it.each(["email", "call", "account", "deletion_request"])("cancels and redacts frozen delivery on %s changes", async mode => {
    vi.spyOn(email, "sendUserCallNotification").mockRejectedValueOnce(new EmailDeliveryError(true));
    const f = await fixture(); await service.tick();
    if (mode === "email") await sql`UPDATE users SET email=${`${randomUUID()}@example.test`} WHERE id=${f.owner}`;
    if (mode === "call") await sql`UPDATE call_briefs SET data_deleted_at=now() WHERE id=${f.brief.id}`;
    if (mode === "account") await sql`UPDATE users SET status='deleted' WHERE id=${f.owner}`;
    if (mode === "deletion_request") await sql`INSERT INTO account_deletion_requests(id,user_id,status,max_attempts,run_after,requested_at,updated_at)
      VALUES(${randomUUID()},${f.owner},'queued',8,now(),now(),now())`;
    now = new Date(now.getTime() + 60_000); await service.tick();
    expect(email.userCallMessages).toHaveLength(0);
    expect((await sql`SELECT status,payload_ciphertext FROM user_call_notifications`)[0]).toMatchObject({ status: "cancelled", payload_ciphertext: null });
  });
  it("does not mistake a connected attempt without consent for a conversation", async () => {
    await fixture(false); await service.tick(); expect(email.userCallMessages).toHaveLength(0);
    expect((await sql`SELECT status FROM user_call_notifications`)[0]!.status).toBe("cancelled");
  });
  it("bounds unavailable evidence waiting and does not invent an assessment", async () => {
    await fixture(true, false); await service.tick(); expect(email.userCallMessages).toHaveLength(0);
    now = new Date(now.getTime() + 25 * 3600_000); await service.tick();
    expect((await sql`SELECT status FROM user_call_notifications`)[0]!.status).toBe("cancelled");
  });
  it("never changes a call's creation locale on account changes or direct mutation", async () => {
    const f = await fixture();
    await expect(sql`UPDATE call_briefs SET creation_ui_locale='de' WHERE id=${f.brief.id}`).rejects.toThrow("immutable");
    expect((await calls.get(f.brief.id))?.brief.creationUiLocale).toBe("ru");
  });
  it.each(["partial", "not_achieved", "uncertain"] as const)("delivers a confirmed conversation when its goal is %s", async goal => {
    await fixture(true, true, goal); await service.tick(); expect(email.userCallMessages).toHaveLength(1);
  });
  it("waits for a delayed assessment and uses it when published", async () => {
    await fixture(); const pending = vi.spyOn(calls, "getCallAssessment").mockResolvedValue(null);
    await service.tick(); expect(email.userCallMessages).toHaveLength(0);
    pending.mockRestore(); now = new Date(now.getTime() + 60_000); await service.tick();
    expect(email.userCallMessages[0]!.content.text).toContain("Цель достигнута");
  });
  it("sends an unavailable assessment after five minutes only with admitted two-party dialogue", async () => {
    const f = await fixture(true, false);
    await sql`INSERT INTO call_events(id,call_brief_id,call_attempt_id,user_id,sequence,schema_version,event_name,source,stage,severity,idempotency_key,occurred_at)
      SELECT ${randomUUID()},${f.brief.id},${f.attempt.id},${f.owner},max(sequence)+1,1,'conversation.started','realtime','conversation','info','fixture:conversation',now()
      FROM call_events WHERE call_brief_id=${f.brief.id}`;
    await service.tick(); expect(email.userCallMessages).toHaveLength(0);
    now = new Date(now.getTime() + 6 * 60_000); await service.tick();
    expect(email.userCallMessages).toHaveLength(1);
    expect(email.userCallMessages[0]!.content.text).toContain("Оценка ИИ недоступна");
    expect(email.userCallMessages[0]!.content.text).toContain("Ja, er ist angekommen.");
  });
  it("does not retry beyond the provider idempotency window", async () => {
    const send = vi.spyOn(email, "sendUserCallNotification").mockRejectedValue(new EmailDeliveryError(true));
    await fixture(); await service.tick();
    now = new Date(now.getTime() + 21 * 3600_000); await service.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await sql`SELECT status,last_error_code FROM user_call_notifications`)[0]).toMatchObject({ status: "failed", last_error_code: "DELIVERY_WINDOW_EXPIRED" });
  });
  it("recovers an expired worker lease", async () => {
    await fixture();
    await sql`UPDATE user_call_notifications SET status='processing',lease_owner=${randomUUID()},lease_until=${new Date(now.getTime() - 1)}`;
    await worker().tick(); expect(email.userCallMessages).toHaveLength(1);
  });
  it("suppresses mail when the saved assessment says no conversation occurred", async () => {
    const f = await fixture();
    const assessment = (await calls.getCallAssessment(f.brief.id, f.attempt.id))!;
    vi.spyOn(calls, "getCallAssessment").mockResolvedValue({ ...assessment, decision: { ...assessment.decision!,
      conversation: { status: "absent", category: "none", questionSegmentId: null, answerSegmentId: null, answerQuote: "" } } });
    await service.tick(); expect(email.userCallMessages).toHaveLength(0);
    expect((await sql`SELECT status FROM user_call_notifications`)[0]!.status).toBe("cancelled");
  });
  it("cancels a frozen retry if its exact transcript has been redacted", async () => {
    vi.spyOn(email, "sendUserCallNotification").mockRejectedValueOnce(new EmailDeliveryError(true));
    const f = await fixture(); await service.tick();
    await sql`UPDATE final_transcript_revisions SET payload_ciphertext=NULL WHERE call_attempt_id=${f.attempt.id}`;
    now = new Date(now.getTime() + 60_000); await service.tick();
    expect(email.userCallMessages).toHaveLength(0);
    expect((await sql`SELECT status,payload_ciphertext FROM user_call_notifications`)[0]).toMatchObject({status:"cancelled",payload_ciphertext:null});
  });
});
