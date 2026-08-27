import { afterEach, describe, expect, it, vi } from "vitest";
import { CallService } from "./call-service";
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
    const brief = await service.create(input);

    const updated = await service.recompile(brief.id, {
      ...input,
      objective: "Ask Elena which book and country she likes most"
    });

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
    const service = new CallService(
      new InMemoryCallRepository(),
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
    expect(await repository.findCallDataDeletion(
      brief.id,
      userId,
      request.requestId
    )).toMatchObject({ providerRecordingDisposition: "deleted" });
    await expect(service.deleteCallData(brief.id, userId, request))
      .resolves.toEqual(deleted);
  });
});
