import "../config/load-env";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPreparationRuntimePolicy, normalizeCreateCallBriefInput, type CallCompilation } from "@callassist/contracts";
import { nativeAction } from "../test-helpers/native-appointment";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { PostgresCallRepository } from "./postgres-call-repository";
import type { CallRepository } from "./call-repository";
import { CallService } from "../call-service";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { createCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { originalPlanReview } from "../test-helpers/original-plan-review";

const closers: Array<() => Promise<unknown>> = [];
let preparedDatabase: ReturnType<typeof isolatedTestDatabase> | null = null;
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function fixture(driver: "memory" | "postgres", status = "no-answer", legacy = false, native = false) {
  const db = driver === "postgres" ? preparedDatabase : null;
  if (driver === "postgres" && !db) throw Error("POSTGRES_FIXTURE_NOT_READY");
  const repository: CallRepository = db ? new PostgresCallRepository(db.url, Buffer.alloc(32, 15)) : new InMemoryCallRepository();
  let owner: string = randomUUID();
  if (db) {
    const auth = new PostgresAuthRepository(db.url); closers.push(() => auth.close());
    owner = (await auth.createUser({ email: `${owner}@example.com`, passwordHash: "test-only", phoneE164: "+41790000001", firstName: "Test", lastName: "Owner", uiLocale: "en" })).id;
    await auth.markPhoneVerified(owner, new Date().toISOString(), "+41790000001");
  }
  const compiler = new DeterministicBriefCompiler();
  const originalCompile = compiler.compile.bind(compiler);
  const compile = vi.spyOn(compiler, "compile");
  // Pin both generations explicitly; legacy retry tests must not silently
  // inherit the current native compiler's default schema.
  compile.mockImplementation((input,revision,options)=>originalCompile(input,revision,{...options,
    policy:{...defaultPreparationRuntimePolicy,promptVersion:native?"preparation-live-native-actions-2026-11-06":"preparation-2026-10-05"}}));
  const service = new CallService(repository, undefined, undefined, undefined, compiler, undefined, undefined, { durableWorkerEnabled: false });
  closers.push(() => service.close());
  await repository.grantSignupCredits(owner);
  const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41523686688", objective: "Ask when the office opens tomorrow",
    assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Owner", locale: "en-GB", allowedFacts: [],
    ...(legacy ? { addressingMode: "informal", tonePreference: "friendly", resultHandling: "request_external_delivery", deliveryInstruction: "Ask for delivery to test@example.com." } as const : {}) });
  const source = await service.create(input, owner);
  await repository.approveCompilation(source.id, await originalPlanReview(repository, source.id));
  const started = await repository.startAttempt(source.id, { provider: "twilio", userId: owner });
  const providerId = `CA${randomUUID().replaceAll("-", "")}`;
  await repository.attachProviderCall(started.attempt.id, providerId, "queued");
  if (status !== "queued") await repository.applyProviderStatus(providerId, status, status === "in-progress" ? "in_progress" : "failed", source.id);
  return { repository, service, source, owner, compile, providerId, started, input };
}

describe.each(["memory", "postgres"] as const)("repeat unanswered calls on %s", driver => {
  // Database creation/migrations use the hook budget, not the runtime assertion timeout.
  beforeEach(async()=>{
    preparedDatabase=null;
    if(driver==="postgres") { const db=isolatedTestDatabase();preparedDatabase=db;closers.push(()=>db.teardown());await db.setup(); }
  });
  async function nativeMachine() {
    const f=await fixture(driver,"in-progress",false,true),now=new Date().toISOString();
    await f.repository.nativeLive.reserve(f.source.id,f.started.attempt.id);
    await f.repository.nativeLive.bind(f.started.attempt.id,f.providerId);
    const binding={attemptId:f.started.attempt.id,providerCallId:f.providerId,snapshotHash:f.started.attempt.compilationSnapshotHash!,now};
    await f.service.recordTelemetry(f.source.id,{callAttemptId:f.started.attempt.id,idempotencyKey:"native-amd-pending",
      payload:{name:"answering.updated",metadata:{phase:"pending",policyVersion:"twilio-async-live-inconclusive-v3",execution:"async",
        mode:"Enable",answeredBy:null,decision:null,streamAdmitted:false,observedAt:now,durationMs:null,message:"not_requested",failure:null}}});
    expect((await f.repository.transitionAnswering(f.source.id,{...binding,kind:"admit"})).applied).toBe(true);
    await f.service.recordTelemetry(f.source.id,{callAttemptId:f.started.attempt.id,idempotencyKey:"native-recording",
      payload:{name:"recording.started",metadata:{providerStatus:"in-progress",recordingBasis:"declarative_local"}}});
    await f.service.recordTelemetry(f.source.id,{callAttemptId:f.started.attempt.id,idempotencyKey:"native-greeting",payload:{name:"conversation.started",metadata:{}}});
    expect((await f.repository.transitionAnswering(f.source.id,{...binding,kind:"resolve",answeredBy:"machine_start",durationMs:2977})).applied).toBe(true);
    expect((await f.repository.transitionAnswering(f.source.id,{...binding,kind:"dispatch"})).applied).toBe(true);
    await f.repository.applyProviderStatus(f.providerId,"completed","completed",f.source.id);
    return f;
  }
  it("retries a recorded native machine leg as one fresh review, keeping the source recording",async()=>{
    const f=await nativeMachine(),before=(await f.repository.get(f.source.id))!;
    expect(before.brief.lifecycle).toMatchObject({result:"automated_answer",credit:"returned",consent:"not_requested"});
    expect(before.recording).toMatchObject({recordingBasis:"declarative_local"});
    expect(before.compilation?.compiledBrief?.schemaVersion).toBe("9");
    const count=f.compile.mock.calls.length;
    const [first,second]=await Promise.all([f.service.repeatUnansweredCall(f.source.id,f.owner),f.service.repeatUnansweredCall(f.source.id,f.owner)]);
    expect(first.id).toBe(second.id);expect(first.status).toBe("review_required");expect(f.compile).toHaveBeenCalledTimes(count);
    const copy=(await f.repository.get(first.id))!;
    expect(copy.compilation?.snapshotHash).toBe(before.compilation?.snapshotHash);expect(copy.compilation?.approvedAt).toBeNull();
    expect(copy.recording).toBeNull();expect(copy.transcript).toEqual([]);expect(copy.nativeAppointmentAction).toBeNull();
    expect(await f.repository.getLatestAttempt(first.id)).toBeNull();expect(await f.repository.getCurrentReviewReceipt(first.id)).toBeNull();
    expect((await f.repository.get(f.source.id))?.recording?.id).toBe(before.recording?.id);
    await expect(f.repository.startAttempt(first.id,{provider:"twilio",userId:f.owner})).rejects.toMatchObject({code:"CALL_NOT_READY"});
  });
  it("rejects a native machine retry when an action exists, including at the repository boundary",async()=>{
    const f=await nativeMachine();
    await f.repository.nativeLive.saveAction(nativeAction(f.source.id,f.started.attempt.id,f.started.attempt.compilationSnapshotHash!));
    await expect(f.service.repeatUnansweredCall(f.source.id,f.owner)).rejects.toMatchObject({code:"CALL_RETRY_NOT_AVAILABLE"});
    const snapshot=(await f.repository.get(f.source.id))!,compilation={...structuredClone(snapshot.compilation!),approvedAt:null,compilerResponseId:null};
    await expect(f.repository.create(compilation.rawBrief,compilation,f.owner,f.started.attempt.id,undefined,
      {callId:f.source.id,attemptId:f.started.attempt.id})).rejects.toMatchObject({code:"CALL_RETRY_NOT_AVAILABLE"});
  });
  it("prepares a normalized legacy copy while preserving its source approval and delivery intent", async () => {
    const f = await fixture(driver, "no-answer", true);
    const source = await f.repository.get(f.source.id);
    const enqueue = vi.spyOn(f.repository, "enqueueCallRecompilation");
    const repeated = await f.service.repeatUnansweredCall(f.source.id, f.owner);
    expect(repeated.status).toBe("queued");
    const request = enqueue.mock.calls[0][0];
    expect(request.input).toMatchObject({ addressingMode: "formal", tonePreference: "neutral", resultHandling: "capture_in_callassist", deliveryInstruction: "" });
    expect(request.input.context).toContain("test@example.com");
    expect(request.callBriefId).not.toBe(f.source.id);
    expect(await f.repository.getLatestAttempt(request.callBriefId)).toBeNull();
    expect((await f.repository.get(f.source.id))!.compilation).toEqual(source!.compilation);
    const replay = await f.service.repeatUnansweredCall(f.source.id, f.owner);
    expect(replay.id).toBe(repeated.id);
  });
  it("reuses a completed pre-consent connection without copying disclosure or dialing automatically", async () => {
    const f = await fixture(driver, "in-progress");
    await f.repository.appendCallTelemetryEvent(f.source.id, { callAttemptId: f.started.attempt.id,
      idempotencyKey: "consent-missing", payload: { name: "consent.failed", metadata: { reason: "stream_ended_before_consent" } } });
    await f.repository.applyProviderStatus(f.providerId, "completed", "completed", f.source.id);
    expect((await f.repository.get(f.source.id))?.brief.lifecycle).toMatchObject({ connected: true, result: "consent_not_received" });
    const calls = f.compile.mock.calls.length;
    const [first, second] = await Promise.all([f.service.repeatUnansweredCall(f.source.id, f.owner), f.service.repeatUnansweredCall(f.source.id, f.owner)]);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("review_required");
    expect(f.compile).toHaveBeenCalledTimes(calls);
    expect(await f.repository.getLatestAttempt(first.id)).toBeNull();
    expect(await f.repository.getCurrentReviewReceipt(first.id)).toBeNull();
    const snapshot = (await f.repository.get(first.id))!;
    expect(snapshot.recording).toBeNull();
    expect(snapshot.transcript).toEqual([]);
    expect(snapshot.compilation?.approvedAt).toBeNull();
    await expect(f.repository.startAttempt(first.id, { provider: "twilio", userId: f.owner })).rejects.toMatchObject({ code: "CALL_NOT_READY" });
    await f.repository.applyProviderStatus(f.providerId, "completed", "completed", f.source.id);
    expect((await f.repository.get(first.id))?.brief.status).toBe("review_required");
  });

  it.each(["granted", "declined"] as const)("rejects completed calls with %s consent", async consent => {
    const f = await fixture(driver, "in-progress");
    await f.repository.appendCallTelemetryEvent(f.source.id, { callAttemptId: f.started.attempt.id, idempotencyKey: "consent-result",
      payload: consent === "granted" ? { name: "consent.granted", metadata: { method: "voice", decision: "affirmative", locale: "en-GB" } }
        : { name: "consent.failed", metadata: { reason: "negative" } } });
    await f.repository.applyProviderStatus(f.providerId, "completed", "completed", f.source.id);
    await expect(f.service.repeatUnansweredCall(f.source.id, f.owner)).rejects.toMatchObject({ code: "CALL_RETRY_NOT_AVAILABLE" });
  });

  it("reuses compilation without provider/LLM work and creates one fresh review for concurrent requests", async () => {
    const f = await fixture(driver);
    const before = await f.repository.get(f.source.id);
    const compilationCalls = f.compile.mock.calls.length;
    const [first, second] = await Promise.all([f.service.repeatUnansweredCall(f.source.id, f.owner), f.service.repeatUnansweredCall(f.source.id, f.owner)]);
    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(f.source.id);
    expect(first.status).toBe("review_required");
    if ("failureCode" in first) throw new Error("Unchanged retry should reuse its compilation");
    expect(first.retrySourceCallId).toBe(f.source.id);
    expect(f.compile).toHaveBeenCalledTimes(compilationCalls);
    const next = (await f.repository.get(first.id))!;
    expect(next.compilation?.snapshotHash).toBe(before!.compilation?.snapshotHash);
    expect(next.compilation?.approvedAt).toBeNull();
    expect(next.transcript).toEqual([]);
    expect(next.recording).toBeNull();
    expect(next.pendingApproval).toBeNull();
    expect(await f.repository.getLatestAttempt(first.id)).toBeNull();
    await expect(f.repository.startAttempt(first.id, { provider: "twilio", userId: f.owner })).rejects.toMatchObject({ code: "CALL_NOT_READY" });
    await f.repository.approveCompilation(first.id, await originalPlanReview(f.repository, first.id));
    const newAttempt = await f.repository.startAttempt(first.id, { provider: "twilio", userId: f.owner });
    expect(newAttempt.attempt.executionSnapshot?.callBriefId).toBe(first.id);
    expect(newAttempt.attempt.id).not.toBe(f.started.attempt.id);
    await f.repository.applyProviderStatus(f.providerId, "no-answer", "failed", f.source.id);
    expect((await f.repository.get(first.id))?.brief.status).toBe("dialing");
    expect((await f.repository.get(f.source.id))?.brief.status).toBe("failed");
  });

  it.each(["queued", "in-progress"])("rejects %s provider state and cross-account requests", async status => {
    const f = await fixture(driver, status);
    await expect(f.service.repeatUnansweredCall(f.source.id, f.owner)).rejects.toMatchObject({ code: "CALL_RETRY_NOT_AVAILABLE" });
    await expect(f.service.repeatUnansweredCall(f.source.id, randomUUID())).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
  });

  it("does not charge compiler telemetry again and keeps history in the source language", async () => {
    const f = await fixture(driver, "busy");
    const repeat = await f.service.repeatUnansweredCall(f.source.id, f.owner);
    const events = await f.repository.listCallTelemetryEvents(repeat.id);
    expect(events.filter(event => event.payload.name.startsWith("compilation."))).toEqual([]);
    const history = await f.repository.list({ userId: f.owner, limit: 20 });
    expect(history.items).toHaveLength(2);
    expect(history.items.every(item => item.displayObjective === f.input.objective)).toBe(true);
  });

  it("copies only ready plan translations, requires a new receipt and never schedules translation work", async () => {
    const f = await fixture(driver);
    const source = await f.repository.getPlanSource(f.source.id);
    const artifact = await f.repository.enqueueTextArtifact({ callId: f.source.id, kind: "plan_review", compilationId: source.compilationId,
      sourceHash: source.snapshotHash, targetLanguage: "en", generatorVersion: "test-v1" });
    const job = (await f.repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: randomUUID(), useDatabaseTime:true,
      now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }))!;
    const lease = { jobId: job.id, workerId: job.leaseOwner!, checkedAt: job.leasedAt!, generation: job.generation, attemptNumber: job.attemptCount };
    await f.repository.claimTextArtifact(artifact.id, lease);
    const ready = await f.repository.completeTextArtifact(artifact.id, { fields: [{ id: "localizedObjective", text: "Ask office opening hours" }] }, lease);
    await f.repository.completeDurableJob(job.id, job.leaseOwner!, new Date().toISOString());
    const repeated = await f.service.repeatUnansweredCall(f.source.id, f.owner);
    const artifacts = await f.repository.listTextArtifacts(repeated.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.id).not.toBe(ready.id);
    expect(artifacts[0]?.payloadHash).toBe(ready.payloadHash);
    expect(artifacts[0]?.payload).toEqual(ready.payload);
    expect(artifacts[0]?.compilationId).toBe((await f.repository.getPlanSource(repeated.id)).compilationId);
    expect(await f.repository.getCurrentReviewReceipt(repeated.id)).toBeNull();
    expect(await f.repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: randomUUID(),
      now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() })).toBeNull();
    await f.repository.deleteCallData({ callId: f.source.id, userId: f.owner, requestId: randomUUID(), providerRecordingDisposition: "deleted", deletedAt: new Date().toISOString() });
    await expect(f.service.repeatUnansweredCall(f.source.id, f.owner)).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
    expect((await f.repository.get(repeated.id))?.compilation).not.toBeNull();
  });

  it("requires correction of an expired appointment before starting", async () => {
    const f = await fixture(driver);
    const compilation: CallCompilation = structuredClone((await f.repository.get(f.source.id))!.compilation!);
    if (compilation.compiledBrief?.schemaVersion !== "4") throw new Error("Expected current compilation");
    compilation.compiledBrief.appointmentAuthorization = { operation: "book", serviceDescription: "Office visit", providerScope: "called_recipient", timeZone: "Europe/Zurich",
      windows: [{ date: "2000-01-01", startTime: "09:00", endTime: "10:00" }], selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms" };
    compilation.snapshotHash = createCompilationSnapshotHash(compilation);
    compilation.approvedAt = null;
    const brief = await f.repository.create(compilation.rawBrief, compilation, f.owner);
    await f.repository.approveCompilation(brief.id, await originalPlanReview(f.repository, brief.id));
    await expect(f.repository.startAttempt(brief.id, { provider: "twilio", userId: f.owner })).rejects.toMatchObject({ code: "CALL_APPOINTMENT_EXPIRED" });
  });
});
