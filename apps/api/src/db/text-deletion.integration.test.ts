import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { AccountDeletionService } from "../auth/account-deletion-service";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { CallService } from "../call-service";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { OpenAITextProcessor } from "../text-processing/openai-text-processor";
import { planReviewFields } from "../text-processing/plan-review-fields";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { isolatedTestDatabase } from "./isolated-test-database";

const database = isolatedTestDatabase();
const sql = postgres(database.url, { max: 1, onnotice: () => undefined });
beforeAll(() => database.setup(), 15_000);
afterAll(async () => { await sql.end(); await database.teardown(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it.each(["pending", "completed"] as const)("does not restore translated payload when a provider responds while account deletion is %s", async (phase) => {
  const repository = new PostgresCallRepository(database.url, Buffer.alloc(32, 14));
  const authRepository = new PostgresAuthRepository(database.url);
  const providerStarted = deferred<void>();
  const providerResponse = deferred<Response>();
  const fetchImplementation = vi.fn<typeof fetch>(async () => {
    providerStarted.resolve();
    return providerResponse.promise;
  });
  const processor = new OpenAITextProcessor({ apiKey: "test-only", model: "test-only", fetchImplementation });
  const callService = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, {
    durableWorkerEnabled: false, textProcessor: processor,
    textCapabilities: { enabled: true, directions: [{ kind: "plan_review", sourceLanguage: "*", targetLanguage: "ru" }] }
  });
  const onError = vi.fn();
  const deletion = new AccountDeletionService({ authRepository, callService, workerEnabled: false, onError });
  try {
    const userId = randomUUID();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at)
      VALUES (${userId},${`${userId}@example.test`},'test-only',${`fixture:${userId}`},'Delete','Test','user','active','en',now())`;
    await sql`UPDATE users SET phone_verified_at=now() WHERE id=${userId}`;
    const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41710000001",
      objective: "Ask office opening hours", assistantProfileId: "sebastian", representedPersonFirstName: "Delete",
      representedPersonLastName: "Test", assistanceReason: "none", locale: "en-GB", allowLanguageSwitch: false,
      allowedFacts: ["Personal reference: AB-123"] });
    const compilation = await new DeterministicBriefCompiler().compile(input);
    // A previous completed call supplies all four retained text/evidence families for account-wide deletion.
    const retained = await repository.create(input, compilation, userId);
    await repository.approveCompilation(retained.id, await originalPlanReview(repository, retained.id));
    const attempt = await repository.startAttempt(retained.id, { provider: "twilio" });
    const providerCallId = `CA-${randomUUID()}`, providerRecordingId = `RE-${randomUUID()}`;
    await repository.attachProviderCall(attempt.attempt.id, providerCallId, "in-progress");
    const recording = await repository.beginRecording(retained.id);
    await repository.attachProviderRecording(recording.recording.id, providerRecordingId, "in-progress");
    await repository.applyRecordingStatus({ callBriefId: retained.id, recordingId: recording.recording.id,
      providerCallId, providerRecordingId, providerStatus: "completed", durationSeconds: 20, channels: 2 });
    await repository.claimFinalTranscript(recording.recording.id, "test-only");
    await repository.completeFinalTranscript(recording.recording.id, "We have received reference AB-123.", []);
    const transcript = await repository.getCurrentTranscriptRevision(retained.id);
    const retainedArtifact = await repository.enqueueTextArtifact({ callId: retained.id, kind: "transcript_translation",
      transcriptRevisionId: transcript!.id, sourceHash: transcript!.sourceHash, targetLanguage: "ru", generatorVersion: "test-only" });
    const retainedJob = await repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: "retained-text",
      now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    const retainedLease = { jobId: retainedJob!.id, workerId: "retained-text", generation: retainedJob!.generation,
      attemptNumber: retainedJob!.attemptCount, checkedAt: new Date().toISOString() };
    await repository.claimTextArtifact(retainedArtifact.id, retainedLease);
    const retainedPayload = { text: "Мы получили обращение AB-123.",
      segments: transcript!.segments.map((segment) => ({ ...segment, text: "Мы получили обращение AB-123." })) };
    await repository.saveTextArtifactChunk(retainedArtifact.id, 0, retainedPayload, retainedLease);
    await repository.completeTextArtifact(retainedArtifact.id, retainedPayload, retainedLease);
    await repository.completeDurableJob(retainedJob!.id, "retained-text", new Date().toISOString());
    await repository.applyProviderStatus(providerCallId, "completed", "completed", retained.id);
    const brief = await repository.create(input, compilation, userId);
    const source = await repository.getPlanSource(brief.id);
    const artifact = await callService.textArtifacts.requestPlanReview(brief.id, { ...source, targetLanguage: "ru" });
    const job = await repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: "deletion-test",
      now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(job?.textArtifactId).toBe(artifact.id);
    // The adapter records its outgoing request before entering this locally mocked, deferred fetch.
    const processing = callService.textArtifacts.process(job!, { jobId: job!.id, workerId: "deletion-test",
      checkedAt: new Date().toISOString(), generation: job!.generation, attemptNumber: job!.attemptCount });
    const rejected = expect(processing).rejects.toMatchObject({ code: "CALL_NOT_FOUND", retryable: false });
    await Promise.race([providerStarted.promise, processing]);
    await deletion.request(userId, randomUUID());
    if (phase === "completed") await deletion.runOnce();
    else {
      expect(await deletion.getForUser(userId)).toMatchObject({ status: "queued" });
      expect(await repository.getCurrentTranscriptRevision(retained.id)).toEqual(transcript);
      expect((await repository.get(brief.id))?.brief.objective).toBe(input.objective);
      const requestId = randomUUID();
      await expect(repository.reserveTextArtifactProviderRequest({ id: requestId, artifactId: artifact.id,
        provider: "openai", operationType: "text_translation", stage: "plan_review.0", requestedModel: "test-only",
        clientRequestId: requestId, startedAt: new Date().toISOString(), maxRequests: 3,
        durableJobGeneration: job!.generation }, { jobId: job!.id, workerId: "deletion-test",
        checkedAt: new Date().toISOString(), generation: job!.generation, attemptNumber: job!.attemptCount }))
        .rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
    }
    const [before] = await sql<{ status: string; payload: string | null }[]>`
      SELECT status, payload_ciphertext AS payload FROM call_text_artifacts WHERE id=${artifact.id}`;
    expect(before).toEqual({ status: "cancelled", payload: null });
    providerResponse.resolve(Response.json({ id: `response-after-deletion-${userId}`, model: "test-only", status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        fields: planReviewFields(compilation).map(({ id, text }) => ({ id, text: `[MOCK ru: untranslated source] ${text}` }))
      }) }] }], usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
    }, { headers: { "x-request-id": `request-after-deletion-${userId}` } }));
    await rejected;
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [after] = await sql<{ status: string; payload: string | null }[]>`
      SELECT status, payload_ciphertext AS payload FROM call_text_artifacts WHERE id=${artifact.id}`;
    expect(after).toEqual(before);
    expect(await sql`SELECT 1 FROM call_text_artifact_chunks WHERE artifact_id=${artifact.id}`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM call_text_artifacts WHERE call_brief_id=${brief.id} AND payload_ciphertext IS NOT NULL`).toHaveLength(0);
    const [jobAfter] = await sql<{ status: string }[]>`SELECT status FROM durable_jobs WHERE id=${job!.id}`;
    expect(jobAfter?.status).toBe("cancelled");
    // Accounting records the real attempt, without restoring request/response text.
    const [accounting] = await sql<{ outcome: string }[]>`SELECT r.outcome FROM provider_operation_results r
      JOIN provider_operations o ON o.id=r.operation_id WHERE o.call_brief_id=${brief.id} AND o.operation_type='text_translation'`;
    expect(accounting?.outcome).toBe("succeeded");
    if (phase === "pending") await deletion.runOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(await deletion.getForUser(userId)).toMatchObject({ status: "completed" });
    await expect(repository.exportCallTextData(brief.id)).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
    for (const table of ["call_text_artifacts", "call_text_artifact_chunks", "final_transcript_revisions", "call_plan_review_receipts"]) {
      // Each fixture is fully deleted before the next case starts in this dedicated database.
      expect(await sql.unsafe(`SELECT 1 FROM ${table} WHERE payload_ciphertext IS NOT NULL`)).toHaveLength(0);
    }
  } finally {
    providerResponse.resolve(Response.json({ error: "test ended" }, { status: 503 }));
    await deletion.close();
    await callService.close();
    await authRepository.close();
  }
}, 30_000);
