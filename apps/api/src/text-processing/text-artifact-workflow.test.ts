import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { CallTextArtifact, CreateCallBriefInput } from "@callassist/contracts";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { DurableJobWorker } from "../jobs/durable-job-worker";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { defaultEndpointRateLimitPolicy } from "../config/endpoint-rate-limit-policy";

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
