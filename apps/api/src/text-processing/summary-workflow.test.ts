import { randomUUID } from "node:crypto";
import { normalizeCreateCallBriefInput, callSummaryPayloadSchema, type SourceSegment } from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { MockTextProcessor } from "./mock-text-processor";
import { TextArtifactService } from "./text-artifact-service";
import { summaryInput } from "./summary-input";
import { textGeneratorVersion, TextProcessingError, type TextProcessingInput, type TextProcessor } from "./text-processor";
import { allTextDirections } from "./text-capabilities";
import { OpenAITextProcessor } from "./openai-text-processor";

const raw = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41710000001", objective: "Ask about office hours",
  assistantProfileId: "sebastian", representedPersonFirstName: "Anna", representedPersonLastName: "Example", locale: "en-GB",
  audioRetentionDays: 0, allowLanguageSwitch: false, allowedFacts: [] });

async function setup(long = false, failCompaction = false, override?: TextProcessor) {
  const repository = new InMemoryCallRepository();
  const compilation = await new DeterministicBriefCompiler().compile(raw);
  const brief = await repository.create(raw, compilation);
  await repository.approveCompilation(brief.id, { revision: compilation.revision, snapshotHash: compilation.snapshotHash,
    review: { mode: "original", language: "en-GB", selectionRevision: 1 } });
  const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
  await repository.attachProviderCall(attempt.id, "CA-test", "in-progress");
  const { recording } = await repository.beginRecording(brief.id);
  await repository.attachProviderRecording(recording.id, "RE-test", "in-progress");
  await repository.applyRecordingStatus({ callBriefId: brief.id, recordingId: recording.id, providerCallId: "CA-test", providerRecordingId: "RE-test", providerStatus: "completed", durationSeconds: 60, channels: 2 });
  await repository.claimFinalTranscript(recording.id, "test-model");
  const segments = (long ? [0, 1, 2] : [0]).map(index => ({ role: "recipient" as const, text: long ? "Open on weekdays. ".repeat(900) : "Open on weekdays.", startSeconds: index * 10, endSeconds: index * 10 + 9 }));
  await repository.completeFinalTranscript(recording.id, segments.map(s => s.text).join("\n"), segments);
  const mock = new MockTextProcessor();
  const process = vi.fn(async (input: TextProcessingInput) => {
    if (failCompaction && input.kind === "call_summary" && input.extraction) throw new TextProcessingError("TEXT_REQUEST_FAILED");
    return mock.process(input);
  });
  const processor: TextProcessor = override ?? { ...mock, driver: "mock", model: mock.model, generatorVersion: mock.generatorVersion, process };
  const service = new TextArtifactService(repository, processor, { enabled: true, directions: allTextDirections() });
  const revision = (await repository.getCurrentTranscriptRevision(brief.id))!;
  const artifact = await service.requestTranscriptArtifact(brief.id, "call_summary", { sourceRevisionId: revision.id, targetLanguage: "en" });
  const job = (await repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: randomUUID(), now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }))!;
  const lease = { jobId: job.id, workerId: job.leaseOwner!, checkedAt: new Date().toISOString(), generation: job.generation, attemptNumber: job.attemptCount };
  return { repository, service, job, lease, artifact, process, compilation, revision };
}

describe("summary execution", () => {
  it("recovers an information result after 503, timeouts and a manual retry without resetting accounting", async () => {
    let requests = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      requests++;
      if (requests === 1) return new Response("Unavailable", { status: 503 });
      if (requests <= 3) return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      });
      const input = JSON.parse(JSON.parse(String(init!.body)).input[1].content);
      return Response.json({ output_text: JSON.stringify({ schemaVersion: 2, overview: [],
        findings: input.checks.map((check: {id:string}) => ({ id: check.id, label: "Office hours", text: "Open on weekdays.", certainty: "reported", sourceSegmentIds: [input.segments[0].id] })),
        nextSteps: [], unresolved: [] }) });
    });
    const h = await setup(false, false, new OpenAITextProcessor({ apiKey: "fixture", summaryTimeoutMs: 10, fetchImplementation }));
    let job = h.job;
    for (const code of ["TEXT_PROVIDER_UNAVAILABLE", "TEXT_REQUEST_TIMEOUT", "TEXT_REQUEST_TIMEOUT"]) {
      const lease = { ...h.lease, generation: job.generation, attemptNumber: job.attemptCount, workerId: job.leaseOwner! };
      await expect(h.service.process(job, lease)).rejects.toMatchObject({ code, retryable: true });
      expect(await h.repository.getTextArtifact(h.artifact.callId, h.artifact.id)).toMatchObject({ status: "processing", retryable: false });
      await h.repository.failDurableJob(job.id, job.leaseOwner!, code, new Date().toISOString(), new Date().toISOString(), true);
      const projected = await h.repository.getTextArtifact(h.artifact.callId, h.artifact.id);
      expect(projected).toMatchObject(job.attemptCount < 3 ? { status: "queued", failureCode: null, retryable: false } : { status: "failed", retryable: true });
      if (job.attemptCount < 3) job = (await h.repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: h.lease.workerId,
        now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }))!;
    }
    await h.service.retry(h.artifact.callId, h.artifact.id);
    job = (await h.repository.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: h.lease.workerId,
      now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }))!;
    expect(job.generation).toBe(2);
    await h.service.process(job, { ...h.lease, generation: job.generation, attemptNumber: job.attemptCount });
    expect(await h.repository.getTextArtifact(h.artifact.callId, h.artifact.id)).toMatchObject({ status: "ready", retryable: false });
    expect(requests).toBe(4);
    expect(await h.repository.getTranscriptRevision(h.artifact.callId, h.revision.id)).toEqual(h.revision);
  });
  it("checks the goal even without a spoken question and keeps text and voice versions independent", async () => {
    const compilation = await new DeterministicBriefCompiler().compile(raw);
    compilation.compiledBrief!.orderedQuestions = [];
    compilation.compiledBrief!.successCriteria = [];
    const input = summaryInput(compilation, [] as SourceSegment[], "ru");
    expect(input.checks).toEqual([{ id: "goal", text: compilation.compiledBrief!.localizedObjective }]);
    expect(input.context).toMatchObject({ recipient: "Office", representedPerson: "Anna Example" });
    const processor = new MockTextProcessor();
    expect(textGeneratorVersion(processor, "plan_review")).toBe(processor.generatorVersion);
    expect(textGeneratorVersion(processor, "transcript_translation")).toBe(processor.generatorVersion);
    expect(textGeneratorVersion(processor, "call_summary")).toBe(`summary-v2:${processor.generatorVersion}`);
  });

  it("uses one request for an ordinary transcript, persists new format and never regenerates a ready result", async () => {
    const h = await setup();
    await h.service.process(h.job, h.lease);
    const saved = (await h.repository.getTextArtifact(h.artifact.callId, h.artifact.id))!;
    expect(saved.status).toBe("ready");
    expect(callSummaryPayloadSchema.parse(saved.payload).findings[0]?.id).toBe("goal");
    expect(h.process).toHaveBeenCalledTimes(1);
    expect(await h.service.requestTranscriptArtifact(h.artifact.callId, "call_summary", { sourceRevisionId: h.revision.id, targetLanguage: "en" })).toEqual(saved);
  });

  it.each([false, true])("persists multipart compaction or a current-format fallback (provider failure: %s)", async fail => {
    const h = await setup(true, fail);
    await h.service.process(h.job, h.lease);
    expect(h.process).toHaveBeenCalledTimes(4);
    const lastInput = h.process.mock.calls.at(-1)![0];
    expect(lastInput.kind === "call_summary" && lastInput.extraction?.schemaVersion).toBe(2);
    const saved = (await h.repository.getTextArtifact(h.artifact.callId, h.artifact.id))!;
    expect(saved.status).toBe("ready");
    expect(callSummaryPayloadSchema.parse(saved.payload).overview).toEqual([]);
    expect((await h.repository.getTextArtifactChunks(h.artifact.id, h.lease)).map(chunk => chunk.index)).toEqual([0, 1, 2, 3]);
  });
});
