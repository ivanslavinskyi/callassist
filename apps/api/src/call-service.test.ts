import { afterEach, describe, expect, it, vi } from "vitest";
import { CallService } from "./call-service";
import {
  BriefCompilerError,
  DeterministicBriefCompiler,
  OpenAIBriefCompiler,
  type BriefCompiler
} from "./brief-compiler/brief-compiler";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import type { TelephonyProvider } from "./telephony/telephony-provider";
import type { PostCallTranscriber } from "./transcription/openai-post-call-transcriber";

const services: CallService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

function createService() {
  const service = new CallService(new InMemoryCallRepository());
  services.push(service);
  return service;
}

async function waitForPreparation(
  service: CallService,
  preparationId: string,
  userId: string
) {
  let preparation = await service.getPreparation(preparationId, userId);
  for (let index = 0; index < 30 && preparation.status !== "succeeded"; index++) {
    await new Promise((resolve) => setImmediate(resolve));
    preparation = await service.getPreparation(preparationId, userId);
  }
  expect(preparation.status).toBe("succeeded");
  return preparation;
}

describe("CallService", () => {
  it("durably compiles one brief for repeated preparation requests", async () => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository, undefined, () => undefined);
    services.push(service);
    await service.initialize();
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const idempotencyKey = "5d006a34-f9e1-4c92-8395-36fd4ae4ab22";
    const input = {
      recipientName: "Reliable office",
      phoneNumber: "+41710000009",
      objective: "Confirm the office opening hours for next Monday",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "en-GB" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };

    const first = await service.prepare(input, userId, idempotencyKey);
    const replay = await service.prepare(input, userId, idempotencyKey);
    expect(replay.id).toBe(first.id);

    let completed = await service.getPreparation(first.id, userId);
    for (let index = 0; index < 20 && completed.status !== "succeeded"; index++) {
      await new Promise((resolve) => setImmediate(resolve));
      completed = await service.getPreparation(first.id, userId);
    }
    expect(completed).toMatchObject({
      status: "succeeded",
      failureCode: null,
      attemptCount: 1
    });
    expect(completed.callBriefId).toBeTypeOf("string");
    await expect(service.list({ limit: 10, userId })).resolves.toMatchObject({
      items: [{ id: completed.callBriefId }]
    });
  });

  it("reports privacy-safe webhook delivery age from the snapshot boundary", async () => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository);
    services.push(service);
    await repository.recordProviderWebhookDelivery({
      kind: "voice",
      outcome: "accepted",
      receivedAt: "2026-08-22T12:33:26.000Z"
    });

    const status = await service.getAdminSystemStatus(
      false,
      new Date("2026-08-22T12:34:56.000Z")
    );

    expect(status.webhooks).toMatchObject({
      since: "2026-08-21T12:00:00.000Z",
      retentionDays: 30,
      voice: {
        accepted: 1,
        rejected: 0,
        unmatched: 0,
        failed: 0,
        lastAcceptedAt: "2026-08-22T12:33:26.000Z",
        lastAcceptedAgeSeconds: 90,
        lastProblemAt: null,
        lastProblemCode: null
      }
    });
    expect(status.callPlanCutover).toEqual({
      recoverableLegacyCalls: 0,
      unavailableLegacyCalls: 0,
      historicalAttemptsWithoutCompilation: 0,
      historicalAttemptsWithoutExecutionSnapshot: 0,
      activeLegacyAttempts: 0,
      activeRecompilations: 0,
      mutableCompilationReadRemovalReady: true,
      legacyMediaAdapterRemovalReady: true
    });
  });

  it("keeps recovery and durable claims out of an external-worker API process", async () => {
    const repository = new InMemoryCallRepository();
    const recover = vi.spyOn(repository, "recoverInterruptedCalls");
    const seed = vi.spyOn(repository, "seedDurableJobs");
    const claim = vi.spyOn(repository, "claimDueDurableJob");
    const service = new CallService(
      repository,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { durableWorkerMode: "external" }
    );
    services.push(service);

    await expect(service.initialize()).resolves.toBe(0);
    await new Promise((resolve) => setImmediate(resolve));

    expect(recover).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    await expect(service.getAdminSystemStatus(false)).resolves.toMatchObject({
      runtime: {
        durableWorkerMode: "external",
        durableWorkerEnabled: false,
        externalWorker: {
          state: "offline",
          healthyInstances: 0,
          staleInstances: 0,
          activeJobs: 0,
          lastSeenAt: null
        }
      }
    });
  });

  it("relays persisted call changes between service processes", async () => {
    const repository = new InMemoryCallRepository();
    const first = new CallService(
      repository,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { durableWorkerMode: "external" }
    );
    const second = new CallService(
      repository,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { durableWorkerMode: "external" }
    );
    services.push(first, second);
    await Promise.all([first.initialize(), second.initialize()]);
    const brief = await first.create({
      recipientName: "Cross-process event test",
      phoneNumber: "+41710000065",
      objective: "Verify live state invalidation",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });
    const localEvents: string[] = [];
    const remoteEvents: string[] = [];
    first.subscribe(brief.id, ({ type }) => localEvents.push(type));
    second.subscribe(brief.id, ({ type }) => remoteEvents.push(type));

    await first.approveCompilation(brief.id);

    await vi.waitFor(() => expect(remoteEvents).toEqual(["call.updated"]));
    expect(localEvents).toEqual(["call.updated"]);
  });

  it("reports fresh and stale external worker heartbeats", async () => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(
      repository,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { durableWorkerMode: "external" }
    );
    services.push(service);
    await repository.reportDurableWorkerHeartbeat({
      workerId: "fresh-worker",
      startedAt: "2026-08-22T12:00:00.000Z",
      seenAt: "2026-08-22T12:00:29.000Z",
      activeJobs: 1
    });
    await repository.reportDurableWorkerHeartbeat({
      workerId: "stale-worker",
      startedAt: "2026-08-22T11:59:00.000Z",
      seenAt: "2026-08-22T12:00:00.000Z",
      activeJobs: 1
    });

    await expect(service.getAdminSystemStatus(
      false,
      new Date("2026-08-22T12:00:30.000Z")
    )).resolves.toMatchObject({
      runtime: {
        externalWorker: {
          state: "healthy",
          healthyInstances: 1,
          staleInstances: 1,
          activeJobs: 1,
          lastSeenAt: "2026-08-22T12:00:29.000Z",
          lastSeenAgeSeconds: 1
        }
      }
    });
  });

  it("closes worker and storage exactly once across concurrent shutdown paths", async () => {
    const repository = new InMemoryCallRepository();
    const closeRepository = vi.spyOn(repository, "close");
    const service = new CallService(repository);
    services.push(service);

    const first = service.close();
    const second = service.close();

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(closeRepository).toHaveBeenCalledOnce();
  });

  it("requires review before a compiled call becomes ready", async () => {
    const service = createService();
    const brief = await service.create({
      recipientName: "Gemeinde Aadorf",
      phoneNumber: "+41523686688",
      objective: "Уточнить возможность отправки документов по электронной почте",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "de-CH",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    expect(brief.status).toBe("review_required");
    expect(brief.locale).toBe("de-CH");
    await expect(service.start(brief.id)).rejects.toMatchObject({
      code: "CALL_NOT_READY"
    });
    const reviewed = await service.approveCompilation(brief.id);
    expect(reviewed.brief.status).toBe("ready");
    expect(reviewed.compilation?.approvedAt).not.toBeNull();
    expect(reviewed.transcript).toEqual([]);
  });

  it("persists compiler operations and returned token usage before publication", async () => {
    const repository = new InMemoryCallRepository();
    const input = {
      recipientName: "Usage office",
      phoneNumber: "+41710000019",
      objective: "Confirm the office opening hours",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "en-GB" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const modelOutput = (await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    )).compiledBrief!;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ results: [{ flagged: false }] }),
        { status: 200, headers: { "x-request-id": "req_moderation_in" } }
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resp_compiler_usage",
        model: "gpt-5.6-2026-08-01",
        output_text: JSON.stringify(modelOutput),
        usage: {
          input_tokens: 250,
          input_tokens_details: { cached_tokens: 50 },
          output_tokens: 80,
          output_tokens_details: { reasoning_tokens: 10 },
          total_tokens: 330
        }
      }), {
        status: 200,
        headers: { "x-request-id": "req_compiler_usage" }
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ results: [{ flagged: false }] }),
        { status: 200, headers: { "x-request-id": "req_moderation_out" } }
      ));
    const compiler = new OpenAIBriefCompiler({
      apiKey: "test-key",
      fetchImplementation: fetchMock
    });
    const service = new CallService(
      repository,
      undefined,
      () => undefined,
      undefined,
      compiler
    );
    services.push(service);
    await service.initialize();
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const preparation = await service.prepare(
      input,
      userId,
      "6d006a34-f9e1-4c92-8395-36fd4ae4ab22"
    );

    let completed = await service.getPreparation(preparation.id, userId);
    for (let index = 0; index < 20 && completed.status !== "succeeded"; index++) {
      await new Promise((resolve) => setImmediate(resolve));
      completed = await service.getPreparation(preparation.id, userId);
    }

    expect(completed.status).toBe("succeeded");
    expect(repository.providerOperationsForTest(preparation.id)).toEqual([
      expect.objectContaining({
        operationType: "brief_moderation",
        result: expect.objectContaining({ outcome: "succeeded", usage: null })
      }),
      expect.objectContaining({
        operationType: "brief_compilation",
        result: expect.objectContaining({
          outcome: "succeeded",
          providerRequestId: "req_compiler_usage",
          providerResponseId: "resp_compiler_usage",
          usage: expect.objectContaining({
            inputTextTokens: 250,
            cachedInputTextTokens: 50,
            outputTextTokens: 80,
            reasoningOutputTokens: 10,
            totalTokens: 330
          })
        })
      }),
      expect.objectContaining({
        operationType: "brief_moderation",
        result: expect.objectContaining({ outcome: "succeeded", usage: null })
      })
    ]);
  });

  it("retains billable compiler usage when structured output fails terminally", async () => {
    const repository = new InMemoryCallRepository();
    const input = {
      recipientName: "Failed usage office",
      phoneNumber: "+41710000029",
      objective: "Confirm the office opening hours",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "en-GB" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const validOutput = (await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    )).compiledBrief!;
    const invalidOutput = { ...validOutput, orderedQuestions: [] };
    const response = (id: string) => new Response(JSON.stringify({
      id,
      model: "gpt-5.6-2026-08-01",
      output_text: JSON.stringify(invalidOutput),
      usage: {
        input_tokens: 200,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 60,
        output_tokens_details: { reasoning_tokens: 5 },
        total_tokens: 260
      }
    }), { status: 200, headers: { "x-request-id": `req_${id}` } });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ results: [{ flagged: false }] }),
        { status: 200 }
      ))
      .mockResolvedValueOnce(response("invalid_one"))
      .mockResolvedValueOnce(response("invalid_two"));
    const service = new CallService(
      repository,
      undefined,
      () => undefined,
      undefined,
      new OpenAIBriefCompiler({
        apiKey: "test-key",
        fetchImplementation: fetchMock
      })
    );
    services.push(service);
    await service.initialize();
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const preparation = await service.prepare(
      input,
      userId,
      "7d006a34-f9e1-4c92-8395-36fd4ae4ab22"
    );

    let completed = await service.getPreparation(preparation.id, userId);
    for (let index = 0; index < 20 && completed.status !== "failed"; index++) {
      await new Promise((resolve) => setImmediate(resolve));
      completed = await service.getPreparation(preparation.id, userId);
    }

    expect(completed).toMatchObject({
      status: "failed",
      failureCode: "BRIEF_COMPILER_RESPONSE_INVALID",
      attemptCount: 1
    });
    const operations = repository.providerOperationsForTest(preparation.id);
    expect(operations).toHaveLength(3);
    expect(operations.filter(({ result }) => result?.usage != null))
      .toHaveLength(2);
    expect(operations.every(({ result }) => result?.outcome === "succeeded"))
      .toBe(true);
    await expect(service.getAdminCallPreparationInspector(preparation.id))
      .resolves.toMatchObject({
        preparation: {
          id: preparation.id,
          status: "failed",
          callBriefId: null,
          failureCode: "BRIEF_COMPILER_RESPONSE_INVALID"
        },
        cost: {
          providerUsage: {
            operationCount: 3,
            usageRecordCount: 2,
            components: {
              briefCompilation: { usageRecords: 2 }
            }
          }
        }
      });
  });

  it("rejects approval when the reviewed revision was replaced", async () => {
    const service = createService();
    await service.initialize();
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const input = {
      recipientName: "Gemeinde Aadorf",
      phoneNumber: "+41523686688",
      objective: "Ask whether the submitted residence form was received",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "de-CH" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const brief = await service.create(input, userId);
    const reviewed = (await service.get(brief.id))!.compilation!;
    const preparation = await service.recompile(brief.id, {
      ...input,
      objective: "Ask whether the updated residence form was received"
    }, userId, "5d006a34-f9e1-4c92-8395-36fd4ae4ab23");
    await waitForPreparation(service, preparation.id, userId);
    const replaced = (await service.get(brief.id))!;

    await expect(service.approveCompilation(brief.id, {
      revision: reviewed.revision,
      snapshotHash: reviewed.snapshotHash
    })).rejects.toMatchObject({ code: "CALL_COMPILATION_STALE" });

    await expect(service.approveCompilation(brief.id, {
      revision: replaced.compilation!.revision,
      snapshotHash: replaced.compilation!.snapshotHash
    })).resolves.toMatchObject({ brief: { status: "ready" } });
  });

  it("durably deduplicates recompilation and preserves the approved revision until publication", async () => {
    const repository = new InMemoryCallRepository();
    const deterministic = new DeterministicBriefCompiler();
    let releaseCompilation!: () => void;
    let markCompilationStarted!: () => void;
    const compilationStarted = new Promise<void>((resolve) => {
      markCompilationStarted = resolve;
    });
    const compilationReleased = new Promise<void>((resolve) => {
      releaseCompilation = resolve;
    });
    const compiler: BriefCompiler = {
      model: deterministic.model,
      async compile(input, revision) {
        if (revision === 2) {
          markCompilationStarted();
          await compilationReleased;
        }
        return deterministic.compile(input, revision);
      }
    };
    const service = new CallService(
      repository,
      undefined,
      () => undefined,
      undefined,
      compiler
    );
    services.push(service);
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const input = {
      recipientName: "Durable office",
      phoneNumber: "+41523686688",
      objective: "Ask whether the original application was received",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "de-CH" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const brief = await service.create(input, userId);
    const approved = await service.approveCompilation(brief.id);
    const approvedHash = approved.compilation!.snapshotHash;
    await service.initialize();

    const idempotencyKey = "5d006a34-f9e1-4c92-8395-36fd4ae4ab28";
    const changed = {
      ...input,
      objective: "Ask whether the updated application was received"
    };
    const preparation = await service.recompile(
      brief.id,
      changed,
      userId,
      idempotencyKey
    );
    const replay = await service.recompile(
      brief.id,
      changed,
      userId,
      idempotencyKey
    );
    expect(replay.id).toBe(preparation.id);
    await compilationStarted;

    await expect(service.get(brief.id)).resolves.toMatchObject({
      brief: { status: "ready" },
      compilation: {
        revision: 1,
        snapshotHash: approvedHash,
        approvedAt: expect.any(String)
      }
    });
    await expect(service.recompile(
      brief.id,
      changed,
      userId,
      "5d006a34-f9e1-4c92-8395-36fd4ae4ab29"
    )).rejects.toMatchObject({ code: "CALL_RECOMPILATION_IN_PROGRESS" });
    await expect(service.approveAndStart(brief.id, userId, {
      revision: 1,
      snapshotHash: approvedHash
    })).rejects.toMatchObject({ code: "CALL_RECOMPILATION_IN_PROGRESS" });

    releaseCompilation();
    await waitForPreparation(service, preparation.id, userId);
    await expect(service.get(brief.id)).resolves.toMatchObject({
      brief: {
        status: "review_required",
        objective: changed.objective
      },
      compilation: {
        revision: 2,
        approvedAt: null,
        rawBrief: { objective: changed.objective }
      }
    });
    expect(await service.getLatestAttempt(brief.id)).toBeNull();
  });

  it("keeps the approved revision executable after a terminal recompilation failure", async () => {
    const repository = new InMemoryCallRepository();
    const deterministic = new DeterministicBriefCompiler();
    const compiler: BriefCompiler = {
      model: deterministic.model,
      async compile(input, revision) {
        if (revision === 2) {
          throw new BriefCompilerError("OPENAI_RESPONSE_INVALID", {
            stage: "compilation",
            validationPaths: ["orderedQuestions"]
          });
        }
        return deterministic.compile(input, revision);
      }
    };
    const service = new CallService(
      repository,
      undefined,
      () => undefined,
      undefined,
      compiler
    );
    services.push(service);
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    await repository.grantSignupCredits(userId);
    const input = {
      recipientName: "Stable approved office",
      phoneNumber: "+41523686688",
      objective: "Ask whether the original request was received",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "de-CH" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const brief = await service.create(input, userId);
    const approved = await service.approveCompilation(brief.id);
    await service.initialize();
    const preparation = await service.recompile(
      brief.id,
      { ...input, objective: "Ask about a replacement request" },
      userId,
      "5d006a34-f9e1-4c92-8395-36fd4ae4ab32"
    );

    let failed = await service.getPreparation(preparation.id, userId);
    for (let index = 0; index < 30 && failed.status !== "failed"; index++) {
      await new Promise((resolve) => setImmediate(resolve));
      failed = await service.getPreparation(preparation.id, userId);
    }
    expect(failed).toMatchObject({
      status: "failed",
      failureCode: "BRIEF_COMPILER_RESPONSE_INVALID",
      attemptCount: 1
    });
    await expect(service.get(brief.id)).resolves.toMatchObject({
      brief: { status: "ready", objective: input.objective },
      compilation: {
        revision: 1,
        snapshotHash: approved.compilation!.snapshotHash,
        approvedAt: expect.any(String)
      }
    });
    await expect(service.approveAndStart(brief.id, userId, {
      revision: 1,
      snapshotHash: approved.compilation!.snapshotHash
    })).resolves.toMatchObject({ brief: { status: "dialing" } });
  });

  it("blocks a legacy foreign destination before reserving or starting a provider call", async () => {
    const startCall = vi.fn();
    const provider: TelephonyProvider = {
      mode: "twilio",
      startCall,
      async stopCall() {},
      async startRecording() {
        throw new Error("not used");
      },
      async getRecordingMedia() {
        throw new Error("not used");
      },
      async deleteRecording() {}
    };
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository, provider);
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Verify the destination policy before provider creation",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });
    await service.approveCompilation(brief.id);
    const originalGet = repository.get.bind(repository);
    vi.spyOn(repository, "get").mockImplementation(async (id) => {
      const snapshot = await originalGet(id);
      if (snapshot) snapshot.brief.phoneNumber = "+442079460000";
      return snapshot;
    });

    await expect(service.start(brief.id)).rejects.toMatchObject({
      code: "SWISS_DESTINATION_REQUIRED"
    });
    expect(startCall).not.toHaveBeenCalled();
  });

  it("refunds a reserved credit when the provider fails before dialing", async () => {
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const repository = new InMemoryCallRepository();
    await repository.grantSignupCredits(userId);
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        throw new Error("provider unavailable");
      },
      async stopCall() {},
      async startRecording() {
        throw new Error("not used");
      },
      async getRecordingMedia() {
        throw new Error("not used");
      },
      async deleteRecording() {}
    };
    const service = new CallService(repository, provider, () => undefined);
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Verify a provider failure refunds the reserved call credit",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    }, userId);
    await service.approveCompilation(brief.id);

    await expect(service.start(brief.id, userId)).rejects.toMatchObject({
      code: "TELEPHONY_START_FAILED"
    });
    const usage = await service.getCreditUsage(userId);
    expect(usage.balance).toBe(3);
    expect(usage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(1);
  });

  it("recompiles the same brief revision and can approve and call in one action", async () => {
    const service = createService();
    await service.initialize();
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const input = {
      recipientName: "Elena",
      phoneNumber: "+41710000001",
      objective: "Ask Elena which book she likes most",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "de-CH" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const brief = await service.create(input, userId);

    const preparation = await service.recompile(brief.id, {
      ...input,
      objective: "Ask Elena which book and country she likes most"
    }, userId, "5d006a34-f9e1-4c92-8395-36fd4ae4ab24");
    await waitForPreparation(service, preparation.id, userId);
    const updated = (await service.get(brief.id))!;

    expect(updated.brief.id).toBe(brief.id);
    expect(updated.brief.status).toBe("review_required");
    expect(updated.compilation).toMatchObject({
      revision: 2,
      approvedAt: null,
      rawBrief: {
        objective: "Ask Elena which book and country she likes most",
        resultHandling: "capture_in_callassist",
        addressingMode: "formal"
      }
    });

    const started = await service.approveAndStart(brief.id);
    expect(started.brief.status).toBe("dialing");
    expect(started.compilation?.approvedAt).not.toBeNull();
    const attempt = await service.getLatestAttempt(brief.id);
    expect(attempt).toMatchObject({
      compilationId: expect.any(String),
      compilationRevision: 2,
      compilationSnapshotHash: started.compilation!.snapshotHash,
      executionSnapshot: {
        compilationRevision: 2,
        compilationSnapshotHash: started.compilation!.snapshotHash,
        plan: {
          localizedObjective:
            "Ask Elena which book and country she likes most"
        }
      }
    });
    expect(JSON.stringify(attempt?.executionSnapshot)).not.toContain(
      "sourceText"
    );
    expect(JSON.stringify(attempt?.executionSnapshot)).not.toContain(
      "rawBrief"
    );

    const repeated = await service.approveAndStart(brief.id);
    expect(repeated.brief.status).toBe("dialing");
    expect(repeated.compilation?.approvedAt).toBe(
      started.compilation?.approvedAt
    );
  });

  it("stops a call without losing its brief", async () => {
    const service = createService();
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Ask whether the application can be submitted by email",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "language_barrier",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    await service.approveCompilation(brief.id);
    await service.start(brief.id);
    const snapshot = await service.stop(brief.id);

    expect(snapshot.brief.status).toBe("stopped");
    expect(snapshot.brief.id).toBe(brief.id);
  });

  it("automatically stops an unanswered call at the configured maximum duration", async () => {
    const userId = "0d908c31-efc4-4f2d-92b9-2f40ec87e898";
    const repository = new InMemoryCallRepository();
    await repository.grantSignupCredits(userId);
    const stopCall = vi.fn().mockResolvedValue(undefined);
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        return { providerCallId: "CA-duration-limit", providerStatus: "queued" };
      },
      stopCall,
      async startRecording() {
        throw new Error("not used");
      },
      async getRecordingMedia() {
        throw new Error("not used");
      },
      async deleteRecording() {}
    };
    const service = new CallService(
      repository,
      provider,
      () => undefined,
      undefined,
      undefined,
      {
        maxStartsPerHour: 3,
        maxStartsPerDay: 10,
        maxStartsPerRecipientPerDay: 2,
        maxDurationSeconds: 1
      }
    );
    services.push(service);
    const brief = await service.create({
      recipientName: "Duration test office",
      phoneNumber: "+41523686688",
      objective: "Verify the hard maximum call duration",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    }, userId);
    await service.approveCompilation(brief.id);

    vi.useFakeTimers();
    try {
      await service.start(brief.id, userId);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(stopCall).toHaveBeenCalledWith("CA-duration-limit");
      expect((await service.get(brief.id))?.brief.status).toBe("stopped");
      expect((await service.getCreditUsage(userId)).balance).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles a lost no-answer callback after restart without charging", async () => {
    const userId = "570d85e7-c72c-4c84-b5c2-a2f13f8a0e75";
    const repository = new InMemoryCallRepository();
    await repository.grantSignupCredits(userId);
    const getCallStatus = vi.fn().mockResolvedValue({
      providerCallId: "CA-reconcile-no-answer",
      status: "no-answer" as const
    });
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        return {
          providerCallId: "CA-reconcile-no-answer",
          providerStatus: "queued"
        };
      },
      async stopCall() {},
      async startRecording() {
        throw new Error("not used");
      },
      async getRecordingMedia() {
        throw new Error("not used");
      },
      async deleteRecording() {},
      getCallStatus
    };
    const beforeRestart = new CallService(
      repository,
      provider,
      () => undefined
    );
    const brief = await beforeRestart.create({
      recipientName: "No-answer reconciliation office",
      phoneNumber: "+41523686688",
      objective: "Verify callback-loss reconciliation without a charge",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    }, userId);
    await beforeRestart.approveCompilation(brief.id);
    await beforeRestart.start(brief.id, userId);
    await beforeRestart.close();

    const afterRestart = new CallService(
      repository,
      provider,
      () => undefined
    );
    services.push(afterRestart);
    await afterRestart.initialize();

    await vi.waitFor(async () => {
      expect((await afterRestart.get(brief.id))?.brief.status).toBe("failed");
      expect((await repository.listDurableJobs()).find(
        ({ type }) => type === "provider_call_reconciliation"
      )?.status).toBe("succeeded");
    });
    const usage = await afterRestart.getCreditUsage(userId);
    expect(getCallStatus).toHaveBeenCalledWith("CA-reconcile-no-answer");
    expect(usage.balance).toBe(3);
    expect(usage.transactions.filter(({ type }) => type === "call_charge"))
      .toHaveLength(0);
    expect(usage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(1);
  });

  it("reconciles lost connected-call and recording callbacks after restart", async () => {
    const userId = "f2bc5a4b-654f-4fac-b756-5283278ff8fd";
    const repository = new InMemoryCallRepository();
    await repository.grantSignupCredits(userId);
    const getCallStatus = vi.fn().mockResolvedValue({
      providerCallId: "CA-reconcile-completed",
      status: "completed" as const
    });
    const getRecordingStatus = vi.fn().mockResolvedValue({
      providerRecordingId: "RE-reconcile-completed",
      status: "completed" as const,
      durationSeconds: 31,
      channels: 2
    });
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        return {
          providerCallId: "CA-reconcile-completed",
          providerStatus: "queued"
        };
      },
      async stopCall() {},
      async startRecording() {
        return {
          providerRecordingId: "RE-reconcile-completed",
          providerStatus: "in-progress"
        };
      },
      async getRecordingMedia() {
        throw new Error("not used");
      },
      async deleteRecording() {},
      getCallStatus,
      getRecordingStatus
    };
    const beforeRestart = new CallService(
      repository,
      provider,
      () => undefined
    );
    const brief = await beforeRestart.create({
      recipientName: "Completed reconciliation office",
      phoneNumber: "+41523686688",
      objective: "Recover completed provider and recording state",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    }, userId);
    await beforeRestart.approveCompilation(brief.id);
    await beforeRestart.start(brief.id, userId);
    await beforeRestart.startRecordingAfterConsent(brief.id);
    await beforeRestart.close();

    const afterRestart = new CallService(
      repository,
      provider,
      () => undefined
    );
    services.push(afterRestart);
    await afterRestart.initialize();

    await vi.waitFor(async () => {
      const snapshot = await afterRestart.get(brief.id);
      expect(snapshot?.brief.status).toBe("completed");
      expect(snapshot?.recording).toMatchObject({
        status: "available",
        durationSeconds: 31,
        channels: 2
      });
      const reconciliationJobs = (await repository.listDurableJobs()).filter(({ type }) =>
        type === "provider_call_reconciliation" ||
        type === "provider_recording_reconciliation"
      );
      expect(reconciliationJobs).toHaveLength(2);
      expect(reconciliationJobs.every(({ status }) => status === "succeeded"))
        .toBe(true);
    });
    const usage = await afterRestart.getCreditUsage(userId);
    expect(getCallStatus).toHaveBeenCalledWith("CA-reconcile-completed");
    expect(getRecordingStatus).toHaveBeenCalledWith(
      "RE-reconcile-completed"
    );
    expect(usage.balance).toBe(2);
    expect(usage.transactions.filter(({ type }) => type === "call_charge"))
      .toHaveLength(1);
    expect(usage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(0);
    expect((await afterRestart.getOutcome(brief.id)).technical.failureStage)
      .toBeNull();
  });

  it("reconciles delayed Twilio cost into one immutable provider cost record", async () => {
    const userId = "6def8c45-9cb5-4c5a-a0a2-d5466df8be55";
    const repository = new InMemoryCallRepository();
    await repository.grantSignupCredits(userId);
    const getCallStatus = vi.fn().mockResolvedValue({
      providerCallId: "CA-cost-reconciliation",
      status: "completed" as const,
      durationSeconds: 37,
      providerReportedCost: {
        amountMicros: 13_700,
        currency: "USD",
        rawAmount: "-0.013700"
      }
    });
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        return {
          providerCallId: "CA-cost-reconciliation",
          providerStatus: "queued"
        };
      },
      async stopCall() {},
      async startRecording() {
        throw new Error("not used");
      },
      async getRecordingMedia() {
        throw new Error("not used");
      },
      async deleteRecording() {},
      getCallStatus
    };
    const service = new CallService(repository, provider, () => undefined);
    services.push(service);
    await service.initialize();
    const brief = await service.create({
      recipientName: "Cost reconciliation office",
      phoneNumber: "+41523686688",
      objective: "Verify delayed provider cost reconciliation",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    }, userId);
    await service.approveCompilation(brief.id);
    await service.start(brief.id, userId);
    await service.handleTwilioStatus(
      "CA-cost-reconciliation",
      "completed",
      brief.id
    );

    await vi.waitFor(async () => {
      expect((await repository.listDurableJobs()).find(
        ({ type }) => type === "provider_call_cost_reconciliation"
      )?.status).toBe("succeeded");
    });
    expect(repository.providerCostsForTest()).toEqual([
      expect.objectContaining({
        provider: "twilio",
        providerCostId: "CA-cost-reconciliation:connectivity",
        costBasis: "provider_reported_actual",
        component: "connectivity",
        amountMicros: 13_700,
        currency: "USD",
        rawCost: { price: "-0.013700", price_unit: "USD" }
      })
    ]);
    await expect(service.getAdminCallCostBreakdown(brief.id)).resolves
      .toMatchObject({
        callId: brief.id,
        cost: {
          providerUsage: {
            components: {
              telephony: {
                usageRecords: 1,
                durationSeconds: 37
              }
            }
          },
          providerReported: {
            status: "reported",
            recordCount: 1,
            usdMicros: 13_700
          }
        }
      });

    await service.handleTwilioStatus(
      "CA-cost-reconciliation",
      "completed",
      brief.id
    );
    expect(repository.providerCostsForTest()).toHaveLength(1);
  });

  it("reserves one attempt before concurrent provider starts", async () => {
    const startCall = vi.fn().mockResolvedValue({
      providerCallId: "CA-concurrent",
      providerStatus: "queued"
    });
    const provider: TelephonyProvider = {
      mode: "twilio",
      startCall,
      async stopCall() {},
      async startRecording() {
        return { providerRecordingId: "RE-concurrent", providerStatus: "in-progress" };
      },
      async getRecordingMedia() {
        return { bytes: new Uint8Array(), contentType: "audio/mpeg", fileName: "call.mp3" };
      },
      async deleteRecording() {}
    };
    const service = new CallService(new InMemoryCallRepository(), provider);
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Prevent duplicate outbound calls",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    await service.approveCompilation(brief.id);
    await Promise.allSettled([service.start(brief.id), service.start(brief.id)]);

    expect(startCall).toHaveBeenCalledTimes(1);
    expect((await service.get(brief.id))?.brief.status).toBe("dialing");
  });

  it("ends a provider call that starts after the user stops it", async () => {
    let resolveStart!: (value: {
      providerCallId: string;
      providerStatus: string;
    }) => void;
    const startCall = vi.fn(
      () =>
        new Promise<{
          providerCallId: string;
          providerStatus: string;
        }>((resolve) => {
          resolveStart = resolve;
        })
    );
    const stopCall = vi.fn().mockResolvedValue(undefined);
    const provider: TelephonyProvider = {
      mode: "twilio",
      startCall,
      stopCall,
      async startRecording() {
        return { providerRecordingId: "RE-late", providerStatus: "in-progress" };
      },
      async getRecordingMedia() {
        return { bytes: new Uint8Array(), contentType: "audio/mpeg", fileName: "call.mp3" };
      },
      async deleteRecording() {}
    };
    const service = new CallService(new InMemoryCallRepository(), provider);
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Stop while the provider is creating a call",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    await service.approveCompilation(brief.id);
    const starting = service.start(brief.id);
    await vi.waitFor(() => expect(startCall).toHaveBeenCalledOnce());
    await service.stop(brief.id);
    resolveStart({ providerCallId: "CA-late", providerStatus: "queued" });
    const snapshot = await starting;

    expect(stopCall).toHaveBeenCalledWith("CA-late");
    expect(snapshot.brief.status).toBe("stopped");
    expect((await service.get(brief.id))?.brief.status).toBe("stopped");
  });

  it("records only after consent and creates an idempotent final transcript", async () => {
    const startRecording = vi.fn().mockResolvedValue({
      providerRecordingId: "RE123",
      providerStatus: "in-progress"
    });
    const getRecordingMedia = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      fileName: "RE123.mp3"
    });
    const deleteRecording = vi.fn().mockResolvedValue(undefined);
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        return { providerCallId: "CA123", providerStatus: "queued" };
      },
      async stopCall() {},
      startRecording,
      getRecordingMedia,
      deleteRecording
    };
    const transcribe = vi.fn().mockResolvedValue({
      text: "The application was received.",
      segments: [
        {
          role: "recipient",
          text: "The application was received.",
          startSeconds: 3,
          endSeconds: 5
        }
      ],
      model: "gpt-transcribe"
    });
    const transcriber: PostCallTranscriber = {
      model: "gpt-transcribe",
      transcribe
    };
    const repository = new InMemoryCallRepository();
    const service = new CallService(
      repository,
      provider,
      () => undefined,
      transcriber
    );
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Confirm that the submitted application was received",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      audioRetentionDays: 7,
      allowLanguageSwitch: false,
      allowedFacts: ["Application sent: 12 July"]
    });

    await service.approveCompilation(brief.id);
    await service.start(brief.id);
    expect(repository.providerOperationsForTest()).toContainEqual(
      expect.objectContaining({
        provider: "twilio",
        operationType: "telephony_leg",
        stage: "outbound_call",
        result: null
      })
    );
    expect((await service.get(brief.id))?.recording).toBeNull();

    const recordingStarted = await service.startRecordingAfterConsent(brief.id);
    expect(startRecording).toHaveBeenCalledOnce();
    expect(recordingStarted.recording).toMatchObject({
      providerRecordingId: "RE123",
      status: "recording"
    });

    await service.handleTwilioRecordingStatus({
      callBriefId: brief.id,
      recordingId: recordingStarted.recording!.id,
      providerCallId: "CA123",
      providerRecordingId: "RE123",
      providerStatus: "completed",
      durationSeconds: 42,
      channels: 2
    });

    await vi.waitFor(async () => {
      expect((await service.get(brief.id))?.finalTranscript).toMatchObject({
        status: "completed",
        text: "The application was received.",
        segments: [expect.objectContaining({ role: "recipient" })],
        model: "gpt-transcribe"
      });
    });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(getRecordingMedia).toHaveBeenCalledWith("RE123");

    await service.handleTwilioRecordingStatus({
      callBriefId: brief.id,
      recordingId: recordingStarted.recording!.id,
      providerCallId: "CA123",
      providerRecordingId: "RE123",
      providerStatus: "completed",
      durationSeconds: 42,
      channels: 2
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(transcribe).toHaveBeenCalledOnce();

    await service.retryFinalTranscript(brief.id);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect((await service.get(brief.id))?.finalTranscript?.status).toBe(
        "completed"
      )
    );

    const deleted = await service.deleteRecording(brief.id);
    expect(deleteRecording).toHaveBeenCalledWith("RE123");
    expect(deleted.recording?.status).toBe("deleted");
    expect(deleted.finalTranscript?.text).toBe("The application was received.");
  });

  it("does not downgrade a completed recording when its start request resolves late", async () => {
    let resolveRecordingStart!: (value: {
      providerRecordingId: string;
      providerStatus: string;
    }) => void;
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        return { providerCallId: "CA-race", providerStatus: "queued" };
      },
      async stopCall() {},
      startRecording: () =>
        new Promise((resolve) => {
          resolveRecordingStart = resolve;
        }),
      async getRecordingMedia() {
        return {
          bytes: new Uint8Array([1]),
          contentType: "audio/mpeg",
          fileName: "RE-race.mp3"
        };
      },
      async deleteRecording() {}
    };
    const service = new CallService(new InMemoryCallRepository(), provider);
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Verify out-of-order recording lifecycle callbacks",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });
    await service.approveCompilation(brief.id);
    await service.start(brief.id);

    const starting = service.startRecordingAfterConsent(brief.id);
    await vi.waitFor(async () => {
      expect((await service.get(brief.id))?.recording?.status).toBe("starting");
    });
    const recordingId = (await service.get(brief.id))!.recording!.id;
    await service.handleTwilioRecordingStatus({
      callBriefId: brief.id,
      recordingId,
      providerCallId: "CA-race",
      providerRecordingId: "RE-race",
      providerStatus: "completed"
    });
    resolveRecordingStart({
      providerRecordingId: "RE-race",
      providerStatus: "in-progress"
    });

    await expect(starting).resolves.toMatchObject({
      recording: { status: "available", providerRecordingId: "RE-race" }
    });
  });

  it("keeps local call content when provider audio deletion fails, then redacts on retry", async () => {
    const deleteRecording = vi.fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue(undefined);
    const provider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        return { providerCallId: "CA-delete", providerStatus: "queued" };
      },
      async stopCall() {},
      async startRecording() {
        return {
          providerRecordingId: "RE-delete",
          providerStatus: "in-progress"
        };
      },
      async getRecordingMedia() {
        return {
          bytes: new Uint8Array([1]),
          contentType: "audio/wav",
          fileName: "RE-delete.wav"
        };
      },
      deleteRecording
    };
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository, provider);
    services.push(service);
    const userId = "f4e2bf73-e441-4dd2-976b-f949ad41b674";
    await repository.grantSignupCredits(userId);
    const brief = await service.create({
      recipientName: "Private clinic",
      phoneNumber: "+41523686688",
      objective: "Ask whether the private application was received",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      context: "Sensitive private context",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: ["Private reference 149"]
    }, userId);
    await service.approveCompilation(brief.id);
    await service.start(brief.id, userId);
    const recording = await service.startRecordingAfterConsent(brief.id);
    await service.handleTwilioRecordingStatus({
      callBriefId: brief.id,
      recordingId: recording.recording!.id,
      providerCallId: "CA-delete",
      providerRecordingId: "RE-delete",
      providerStatus: "completed"
    });
    await service.handleTwilioStatus("CA-delete", "completed", brief.id);
    const request = {
      requestId: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
      password: "not-used-at-service-boundary",
      confirmation: "DELETE" as const
    };

    await expect(service.deleteCallData(brief.id, userId, request))
      .rejects.toMatchObject({ code: "CALL_DATA_DELETION_PROVIDER_FAILED" });
    const retained = (await repository.get(brief.id))?.brief;
    expect(retained?.recipientName).toBe("Private clinic");
    expect(retained?.context).toContain("Sensitive private context");

    const deleted = await service.deleteCallData(brief.id, userId, request);
    expect(deleted.requestId).toBe(request.requestId);
    expect(deleteRecording).toHaveBeenCalledTimes(2);
    expect(await repository.get(brief.id)).toBeNull();
    expect(await repository.getLatestAttempt(brief.id)).toMatchObject({
      compilationRevision: null,
      compilationSnapshotHash: null,
      executionSnapshot: null
    });
    expect(await repository.findCallDataDeletion(
      brief.id,
      userId,
      request.requestId
    )).toMatchObject({ providerRecordingDisposition: "deleted" });
    await expect(service.deleteCallData(brief.id, userId, request))
      .resolves.toEqual(deleted);
  });
});
