import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { defaultPreparationRuntimePolicy, type CallTextArtifact, type CreateCallBriefInput } from "@callassist/contracts";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { DurableJobWorker } from "../jobs/durable-job-worker";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { defaultEndpointRateLimitPolicy } from "../config/endpoint-rate-limit-policy";
import { TextArtifactService } from "./text-artifact-service";
import { textGeneratorVersion } from "./text-processor";

const input: CreateCallBriefInput = {
  recipientName: "Fixture Office", phoneNumber: "+41523686688", objective: "Ask which documents are needed. Do not book an appointment.",
  assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "de-CH", allowedFacts: []
};
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });

async function fixture(textArtifactLimit?: number) {
  const repository = new InMemoryCallRepository();
  const service = new CallService(repository, undefined, () => undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  const app = buildApp({ service, logger: false, allowAnonymousCallsForTesting: true,
    ...(textArtifactLimit === undefined ? {} : { endpointRateLimitPolicy: {
      ...defaultEndpointRateLimitPolicy,
      textArtifactGeneration: { userLimit: textArtifactLimit, ipLimit: textArtifactLimit, windowMs: 60_000 }
    } })
  });
  closers.push(() => app.close());
  const call = await service.create(input);
  const context = await repository.getLanguageContext(call.id);
  await repository.updateContentLanguage(call.id, "ru", context!.selectionRevision);
  const source = await repository.getPlanSource(call.id);
  const worker = new DurableJobWorker(repository, { text_artifact_generation: (job, lease) => service.textArtifacts.process(job, lease) }, () => undefined);
  closers.push(() => worker.close());
  return { repository, service, app, call, source, worker };
}

describe("plan translation and review API workflow", () => {
  async function historicalReview(h: Awaited<ReturnType<typeof fixture>>, failed = false) {
    const artifact = await h.repository.enqueueTextArtifact({ callId: h.call.id, kind: "plan_review",
      compilationId: h.source.compilationId, sourceHash: h.source.snapshotHash, targetLanguage: "ru",
      generatorVersion: h.service.textArtifacts.processor.generatorVersion });
    if (failed) {
      const job = (await h.repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: randomUUID(),
        now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }))!;
      const lease = { jobId: job.id, workerId: job.leaseOwner!, generation: job.generation,
        attemptNumber: job.attemptCount, checkedAt: new Date().toISOString() };
      await h.repository.claimTextArtifact(artifact.id, lease);
      await h.repository.failTextArtifact(artifact.id, "TEXT_RESPONSE_INVALID", lease, true);
      await h.repository.failDurableJob(job.id, lease.workerId, "TEXT_RESPONSE_INVALID", lease.checkedAt, lease.checkedAt, false);
    }
    return (await h.repository.getTextArtifact(h.call.id, artifact.id))!;
  }

  it("finishes historical queued reviews under their pinned rules and reuses the ready result", async () => {
    const h = await fixture();
    const old = await historicalReview(h);
    const process = vi.spyOn(h.service.textArtifacts.processor, "process");
    expect((await h.service.textArtifacts.requestPlanReview(h.call.id, { ...h.source, targetLanguage: "ru" })).id).toBe(old.id);
    await h.worker.runOnce();
    expect(process).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ legacyReviewValidation: true }));
    const ready = (await h.repository.getTextArtifact(h.call.id, old.id))!;
    expect(ready).toMatchObject({ status: "ready", generatorVersion: old.generatorVersion });
    expect(await h.service.textArtifacts.requestPlanReview(h.call.id, { ...h.source, targetLanguage: "ru" })).toEqual(ready);
    expect(await h.service.textArtifacts.retry(h.call.id, old.id)).toEqual(ready);
  });

  it("retries a failed historical review once under the new version without changing its plan or failure evidence", async () => {
    const h = await fixture();
    const old = await historicalReview(h, true);
    const compilation = (await h.repository.get(h.call.id))!.compilation;
    const process = vi.spyOn(h.service.textArtifacts.processor, "process");
    const next = await h.service.textArtifacts.retry(h.call.id, old.id);
    expect(next.id).not.toBe(old.id);
    expect(next).toMatchObject({ status: "queued", compilationId: old.compilationId, sourceHash: old.sourceHash,
      generatorVersion: textGeneratorVersion(h.service.textArtifacts.processor, "plan_review") });
    expect((await h.service.textArtifacts.retry(h.call.id, old.id)).id).toBe(next.id);
    await h.worker.runOnce();
    expect((await h.repository.getTextArtifact(h.call.id, next.id))?.status).toBe("ready");
    expect(process.mock.calls[0]?.[1]?.legacyReviewValidation).toBeUndefined();
    expect(await h.repository.getTextArtifact(h.call.id, old.id)).toEqual(old);
    expect((await h.repository.get(h.call.id))!.compilation).toEqual(compilation);
    expect(await h.repository.getCurrentReviewReceipt(h.call.id)).toBeNull();
  });

  it("rejects migration of a failed translation belonging to an older plan", async () => {
    const h = await fixture();
    const old = await historicalReview(h, true);
    vi.spyOn(h.repository, "getPlanSource").mockResolvedValue({ ...h.source, compilationId: randomUUID() });
    await expect(h.service.textArtifacts.retry(h.call.id, old.id)).rejects.toMatchObject({ code: "TEXT_ARTIFACT_STALE" });
    expect(await h.repository.listTextArtifacts(h.call.id)).toHaveLength(1);
  });

  it("uses the compilation's pinned review model for new generation and retry", async () => {
    const h = await fixture();
    const mock = h.service.textArtifacts.processor;
    const process = vi.fn(mock.process.bind(mock));
    const policy = { ...defaultPreparationRuntimePolicy, review: { model: "gpt-6-luna" as const, serviceTier: "default" as const } };
    vi.spyOn(h.repository, "getCompilationPreparationPolicy").mockResolvedValue(policy);
    const service = new TextArtifactService(h.repository, {
      driver: "openai", model: "gpt-5.6", generatorVersion: "text-processing-v2:openai:gpt-5.6", process
    }, h.service.textArtifacts.capabilities);
    const artifact = await service.requestPlanReview(h.call.id, { ...h.source, targetLanguage: "ru" });
    expect(artifact.generatorVersion).toBe("review-translation-v1:text-processing-v2:openai:gpt-6-luna");
    await expect(service.retry(h.call.id, artifact.id)).resolves.toMatchObject({ id: artifact.id });
    const worker = new DurableJobWorker(h.repository, { text_artifact_generation: (job, lease) => service.process(job, lease) });
    closers.push(() => worker.close());
    await worker.runOnce();
    expect(process).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ profile: policy.review }));
    expect((await h.repository.getTextArtifact(h.call.id, artifact.id))?.status).toBe("ready");
  });

  it("does not translate a failed compiler plan or hide its preparation recovery behind translation", async () => {
    const { service, repository, call } = await fixture();
    const current = (await repository.get(call.id))!;
    vi.spyOn(repository, "get").mockResolvedValue({ ...current, compilation: { ...current.compilation!,
      policyDecision: { ...current.compilation!.policyDecision, status: "blocked", reasonCodes: ["plan_constraint_failure"] }
    } });
    const enqueue = vi.spyOn(repository, "enqueueTextArtifact");
    await service.preparePlanReview(call.id);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("shares the generation budget with automatic translation on language changes", async () => {
    const { repository, app, call, source } = await fixture(1);
    const before = await repository.getLanguageContext(call.id);
    const first = await app.inject({ method: "POST", url: `/api/call-briefs/${call.id}/plan-review`, payload: {
      compilationId: source.compilationId, revision: source.revision, snapshotHash: source.snapshotHash, targetLanguage: "ru"
    } });
    expect(first.statusCode).toBe(202);
    const changed = await app.inject({ method: "PATCH", url: `/api/call-briefs/${call.id}/content-language`, payload: {
      targetLanguage: "uk", expectedSelectionRevision: before!.selectionRevision
    } });
    expect(changed.statusCode).toBe(429);
    expect(changed.json()).toEqual({ error: "RATE_LIMITED" });
    expect(await repository.getLanguageContext(call.id)).toEqual(before);
    expect((await repository.listTextArtifacts(call.id)).map((artifact) => artifact.targetLanguage)).toEqual(["ru"]);
  });

  it.each(["disabled", "direction_removed"])("stops queued provider work when %s without erasing existing artifacts", async (mode) => {
    const { service, repository, source, call, worker } = await fixture();
    const artifact = await service.textArtifacts.requestPlanReview(call.id, { ...source, targetLanguage: "ru" });
    const process = vi.spyOn(service.textArtifacts.processor, "process");
    if (mode === "disabled") service.textArtifacts.capabilities.enabled = false;
    else service.textArtifacts.capabilities.directions = [];
    await worker.runOnce();
    expect(process).not.toHaveBeenCalled();
    expect(await repository.getTextArtifact(call.id, artifact.id)).toMatchObject({ status: "failed", failureCode: mode === "disabled" ? "TEXT_GENERATION_DISABLED" : "TEXT_DIRECTION_UNSUPPORTED" });
  });
  it("deduplicates two tabs, binds the approved translation and keeps that receipt when another language is read", async () => {
    const { repository, service, app, call, source, worker } = await fixture();
    const request = () => app.inject({ method: "POST", url: `/api/call-briefs/${call.id}/plan-review`, payload: { ...source, reviewPolicyVersion: undefined, targetLanguage: "ru" } });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode)).toEqual([202, 202]);
    const first = responses[0]!.json<CallTextArtifact>();
    expect(responses[1]!.json().id).toBe(first.id);
    await worker.runOnce();
    const ready = (await repository.getTextArtifact(call.id, first.id))!;
    expect(ready.status).toBe("ready");
    expect(ready.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    const noReview = await app.inject({ method: "POST", url: `/api/call-briefs/${call.id}/approve`, payload: { revision: source.revision, snapshotHash: source.snapshotHash } });
    expect(noReview.statusCode).toBe(409);
    expect(noReview.json().error).toBe("CALL_REVIEW_REQUIRED");
    await expect(service.start(call.id)).rejects.toMatchObject({ code: "CALL_NOT_READY" });
    const review = { mode: "translated", language: "ru", artifactId: ready.id, artifactHash: ready.payloadHash,
      selectionRevision: (await repository.getLanguageContext(call.id))!.selectionRevision };
    const approved = await app.inject({ method: "POST", url: `/api/call-briefs/${call.id}/approve`, payload: { revision: source.revision, snapshotHash: source.snapshotHash, review } });
    expect(approved.statusCode).toBe(200);
    const receipt = await repository.getCurrentReviewReceipt(call.id);
    expect(receipt?.evidence).toEqual(review);
    const other = await service.textArtifacts.requestPlanReview(call.id, { ...source, targetLanguage: "uk" });
    await worker.runOnce();
    expect((await repository.getTextArtifact(call.id, other.id))?.status).toBe("ready");
    expect(await repository.getCurrentReviewReceipt(call.id)).toEqual(receipt);
    const started = await service.start(call.id);
    expect(started.brief.status).toBe("dialing");
    expect(await service.getLatestAttempt(call.id)).toMatchObject({ reviewReceiptId: receipt!.id, contentLanguage: "ru", compilationSnapshotHash: source.snapshotHash });
  });

  it("rejects a foreign artifact and keeps saved readers available when generation is disabled", async () => {
    const { repository, service, app, call, source, worker } = await fixture();
    const artifact = await service.textArtifacts.requestPlanReview(call.id, { ...source, targetLanguage: "ru" });
    await worker.runOnce();
    const other = await service.create({ ...input, recipientName: "Other fixture" });
    const foreign = await app.inject({ method: "GET", url: `/api/call-briefs/${other.id}/text-artifacts/${artifact.id}` });
    expect(foreign.statusCode).toBe(404);
    service.textArtifacts.capabilities.enabled = false;
    expect((await service.textArtifacts.requestPlanReview(call.id, { ...source, targetLanguage: "ru" })).id).toBe(artifact.id);
    await expect(service.textArtifacts.requestPlanReview(call.id, { ...source, targetLanguage: "uk" })).rejects.toMatchObject({ code: "TEXT_GENERATION_DISABLED" });
    expect((await app.inject({ method: "GET", url: `/api/call-briefs/${call.id}/text-artifacts/${artifact.id}` })).headers["cache-control"]).toBe("private, no-store");
    const original = await originalPlanReview(service, call.id);
    const bad = { ...original, review: { mode: "translated" as const, language: "ru" as const, artifactId: randomUUID(), artifactHash: "a".repeat(64), selectionRevision: original.review!.selectionRevision } };
    await expect(repository.approveCompilation(call.id, bad)).rejects.toMatchObject({ code: "CALL_REVIEW_STALE" });
    await service.approveCompilation(call.id, original);
    expect((await repository.getCurrentReviewReceipt(call.id))?.evidence.mode).toBe("original");
  });
});
