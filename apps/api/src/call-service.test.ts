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
  it("requires review before a compiled call becomes ready", async () => {
    const service = createService();
    const brief = await service.create({
      recipientName: "Gemeinde Aadorf",
      phoneNumber: "+41523686688",
      objective: "Уточнить возможность отправки документов по электронной почте",
      assistantProfileId: "sebastian",
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

  it("recompiles the same brief revision and can approve and call in one action", async () => {
    const service = createService();
    const input = {
      recipientName: "Elena",
      phoneNumber: "+41710000001",
      objective: "Ask Elena which book she likes most",
      assistantProfileId: "sebastian" as const,
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
      phoneNumber: "+442079460000",
      objective: "Ask whether the application can be submitted by email",
      assistantProfileId: "sebastian",
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
      phoneNumber: "+442079460000",
      objective: "Prevent duplicate outbound calls",
      assistantProfileId: "sebastian",
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
      phoneNumber: "+442079460000",
      objective: "Stop while the provider is creating a call",
      assistantProfileId: "sebastian",
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
      phoneNumber: "+442079460000",
      objective: "Confirm that the submitted application was received",
      assistantProfileId: "sebastian",
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
      phoneNumber: "+442079460000",
      objective: "Verify out-of-order recording lifecycle callbacks",
      assistantProfileId: "sebastian",
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
});
