import type { CallBrief } from "@callassist/contracts";
import twilio from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwilioTelephonyProvider } from "./twilio-telephony-provider";

const brief: CallBrief = {
  id: "4da71bb4-6404-4646-8aa1-2af232268780",
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Verify a real outbound Twilio connection",
  assistantProfileId: "sebastian",
  agentName: "Sebastian",
  representedPerson: "Ivan Slavinskyi",
  assistanceReason: "speech_impairment",
  assistanceDisclosure:
    "Herr Slavinskyi ist aufgrund einer Sprechbehinderung beim Telefonieren eingeschränkt.",
  context: "Application context",
  locale: "de-CH",
  voiceGender: "male",
  audioRetentionDays: 7,
  allowLanguageSwitch: false,
  allowedFacts: [],
  status: "ready",
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z"
};

function createProvider() {
  const update = vi.fn().mockResolvedValue({ sid: "CA123" });
  const createRecording = vi.fn().mockResolvedValue({
    sid: "RE123",
    status: "in-progress"
  });
  const removeRecording = vi.fn().mockResolvedValue(true);
  const calls = Object.assign(
    vi.fn(() => ({
      update,
      recordings: { create: createRecording }
    })),
    {
      create: vi.fn().mockResolvedValue({
        sid: "CA123",
        status: "queued"
      })
    }
  );
  const recordings = vi.fn(() => ({ remove: removeRecording }));
  const provider = new TwilioTelephonyProvider({
    accountSid: "AC123",
    authToken: "test-auth-token",
    fromNumber: "+41710000001",
    publicBaseUrl: "https://calls.example.test",
    client: { calls, recordings } as unknown as ReturnType<typeof twilio>
  });
  return {
    calls,
    createRecording,
    provider,
    recordings,
    removeRecording,
    update
  };
}

describe("TwilioTelephonyProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires an HTTPS public webhook base URL", () => {
    expect(
      () =>
        new TwilioTelephonyProvider({
          accountSid: "AC123",
          authToken: "test-auth-token",
          fromNumber: "+41710000001",
          publicBaseUrl: "http://calls.example.test"
        })
    ).toThrow("PUBLIC_BASE_URL must use HTTPS");
  });

  it("creates a non-recorded call with voice and status webhooks", async () => {
    const { calls, provider } = createProvider();
    const result = await provider.startCall(brief);

    expect(result).toEqual({ providerCallId: "CA123", providerStatus: "queued" });
    expect(calls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "+41710000001",
        to: brief.phoneNumber,
        record: false,
        statusCallback:
          "https://calls.example.test/webhooks/twilio/status?callBriefId=" +
          brief.id,
        url:
          "https://calls.example.test/webhooks/twilio/voice?callBriefId=" +
          brief.id
      })
    );
  });

  it("stops an active Twilio call", async () => {
    const { provider, update } = createProvider();
    await provider.stopCall("CA123");
    expect(update).toHaveBeenCalledWith({ status: "completed" });
  });

  it("starts dual-channel recording on an active call after consent", async () => {
    const { createRecording, provider } = createProvider();
    const result = await provider.startRecording("CA123", {
      callBriefId: brief.id,
      recordingId: "bdbefacf-715b-45d5-9ee8-8524d69f0cea"
    });

    expect(result).toEqual({
      providerRecordingId: "RE123",
      providerStatus: "in-progress"
    });
    expect(createRecording).toHaveBeenCalledWith({
      recordingChannels: "dual",
      recordingTrack: "both",
      recordingStatusCallback:
        "https://calls.example.test/webhooks/twilio/recording?callBriefId=" +
        `${brief.id}&recordingId=bdbefacf-715b-45d5-9ee8-8524d69f0cea`,
      recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
      recordingStatusCallbackMethod: "POST"
    });
  });

  it("deletes provider audio by recording SID", async () => {
    const { provider, recordings, removeRecording } = createProvider();
    await provider.deleteRecording("RE123");
    expect(recordings).toHaveBeenCalledWith("RE123");
    expect(removeRecording).toHaveBeenCalledOnce();
  });

  it("downloads the original dual-channel recording", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      })
    );
    vi.stubGlobal("fetch", fetchImplementation);
    const { provider } = createProvider();

    await expect(provider.getRecordingMedia("RE123")).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      channels: 2,
      fileName: "RE123.mp3"
    });
    expect(String(fetchImplementation.mock.calls[0][0])).toContain(
      "RequestedChannels=2"
    );
  });

  it("falls back to mono for an older recording", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" }
        })
      );
    vi.stubGlobal("fetch", fetchImplementation);
    const { provider } = createProvider();

    await expect(provider.getRecordingMedia("RE123")).resolves.toMatchObject({
      channels: 1
    });
    expect(String(fetchImplementation.mock.calls[1][0])).toContain(
      "RequestedChannels=1"
    );
  });

  it("treats an already-deleted provider recording as deleted", async () => {
    const { provider, removeRecording } = createProvider();
    removeRecording.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { status: 404 })
    );
    await expect(provider.deleteRecording("RE123")).resolves.toBeUndefined();
  });

  it("opens the signed bidirectional media stream immediately", () => {
    const { provider } = createProvider();
    const xml = provider.createVoiceTwiml(brief);
    expect(xml).toContain("<Connect>");
    expect(xml).toContain(
      '<Stream url="wss://calls.example.test/webhooks/twilio/media">'
    );
    expect(xml).toContain(`name="callBriefId" value="${brief.id}"`);
    expect(xml).not.toContain("<Say");
    expect(xml).not.toContain("<Gather");
    expect(xml).toContain("<Hangup/>");

    const token = provider.createMediaStreamToken(brief.id);
    expect(provider.validateMediaStreamToken(brief.id, token)).toBe(true);
    expect(provider.validateMediaStreamToken(brief.id, `${token}x`)).toBe(false);
  });

  it("validates the exact signed webhook URL", () => {
    const { provider } = createProvider();
    const parameters = { CallSid: "CA123", CallStatus: "in-progress" };
    const url = "https://calls.example.test/webhooks/twilio/status";
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      url,
      parameters
    );
    expect(
      provider.validateWebhook(
        signature,
        "/webhooks/twilio/status",
        parameters
      )
    ).toBe(true);
    expect(
      provider.validateWebhook("invalid", "/webhooks/twilio/status", parameters)
    ).toBe(false);
  });

  it("validates Media Stream handshakes against the public WSS URL", () => {
    const { provider } = createProvider();
    const path = "/webhooks/twilio/media";
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `wss://calls.example.test${path}`,
      {}
    );
    expect(provider.validateMediaStreamWebhook(signature, path)).toBe(true);

    const httpsSignature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `https://calls.example.test${path}`,
      {}
    );
    expect(provider.validateMediaStreamWebhook(httpsSignature, path)).toBe(false);
  });
});
