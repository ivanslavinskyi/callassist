import "../config/load-env";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCreateCallBriefInput, type CallCompilation } from "@callassist/contracts";
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
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function fixture(driver: "memory" | "postgres", status = "no-answer") {
  const db = driver === "postgres" ? isolatedTestDatabase() : null;
  if (db) { closers.push(() => db.teardown()); await db.setup(); }
  const repository: CallRepository = db ? new PostgresCallRepository(db.url, Buffer.alloc(32, 15)) : new InMemoryCallRepository();
  let owner: string = randomUUID();
  if (db) {
    const auth = new PostgresAuthRepository(db.url); closers.push(() => auth.close());
    owner = (await auth.createUser({ email: `${owner}@example.com`, passwordHash: "test-only", phoneE164: "+41790000001", firstName: "Test", lastName: "Owner", uiLocale: "en" })).id;
    await auth.markPhoneVerified(owner, new Date().toISOString(), "+41790000001");
  }
  const compiler = new DeterministicBriefCompiler();
  const compile = vi.spyOn(compiler, "compile");
  const service = new CallService(repository, undefined, undefined, undefined, compiler, undefined, undefined, { durableWorkerEnabled: false });
  closers.push(() => service.close());
  await repository.grantSignupCredits(owner);
  const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41523686688", objective: "Ask when the office opens tomorrow",
    assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Owner", locale: "en-GB", allowedFacts: [] });
  const source = await service.create(input, owner);
  await repository.approveCompilation(source.id, await originalPlanReview(repository, source.id));
  const started = await repository.startAttempt(source.id, { provider: "twilio", userId: owner });
  const providerId = `CA${randomUUID().replaceAll("-", "")}`;
  await repository.attachProviderCall(started.attempt.id, providerId, "queued");
  if (status !== "queued") await repository.applyProviderStatus(providerId, status, status === "in-progress" ? "in_progress" : "failed", source.id);
  return { repository, service, source, owner, compile, providerId, started, input };
}

describe.each(["memory", "postgres"] as const)("repeat unanswered calls on %s", driver => {
  it("reuses compilation without provider/LLM work and creates one fresh review for concurrent requests", async () => {
    const f = await fixture(driver);
    const before = await f.repository.get(f.source.id);
    const compilationCalls = f.compile.mock.calls.length;
    const [first, second] = await Promise.all([f.service.repeatUnansweredCall(f.source.id, f.owner), f.service.repeatUnansweredCall(f.source.id, f.owner)]);
    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(f.source.id);
    expect(first.status).toBe("review_required");
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
    const job = (await f.repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: randomUUID(),
      now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }))!;
    const lease = { jobId: job.id, workerId: job.leaseOwner!, checkedAt: new Date().toISOString(), generation: job.generation, attemptNumber: job.attemptCount };
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
