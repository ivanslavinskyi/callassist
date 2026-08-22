import twilio from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { buildWebhookApp } from "./app";
import { CallService } from "./call-service";
import type { OpenAIRealtimeBridge } from "./realtime/openai-realtime-bridge";
import { CallRepositoryError } from "./storage/call-repository";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";

const apps: ReturnType<typeof buildWebhookApp>[] = [];
const services: CallService[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(services.splice(0).map((service) => service.close()));
});

function createHarness() {
  const calls = Object.assign(
    vi.fn(() => ({ update: vi.fn().mockResolvedValue({ sid: "CA123" }) })),
    {
      create: vi.fn().mockResolvedValue({ sid: "CA123", status: "queued" })
    }
  );
  const provider = new TwilioTelephonyProvider({
    accountSid: "AC123",
    authToken: "test-auth-token",
    fromNumber: "+41710000001",
    publicBaseUrl: "https://calls.example.test",
    client: { calls } as unknown as ReturnType<typeof twilio>
  });
  const service = new CallService(
    new InMemoryCallRepository(),
    provider
  );
  const handleTwilioSocket = vi.fn(
    (socket: { close: () => void; on: (...args: unknown[]) => unknown }) =>
      socket.close()
  );
  const app = buildWebhookApp({
    service,
    twilioProvider: provider,
    realtimeBridge: {
      handleTwilioSocket
    } as unknown as OpenAIRealtimeBridge,
    logger: false
  });
  apps.push(app);
  services.push(service);
  return { app, handleTwilioSocket, service };
}

async function createBrief(service: CallService) {
  const brief = await service.create({
    recipientName: "Gemeinde Aadorf",
    phoneNumber: "+41523686688",
    objective: "Verify a real outbound Twilio connection",
    assistantProfileId: "sebastian",
    representedPersonFirstName: "Nina",
    representedPersonLastName: "Keller",
    assistanceReason: "speech_impairment",
    locale: "de-CH",
    allowLanguageSwitch: false,
    allowedFacts: []
  });
  await service.approveCompilation(brief.id);
  return brief;
}

async function webhookFacts(service: CallService) {
  const now = new Date();
  return (await service.repository.getAdminSystemFacts(
    now.toISOString(),
    new Date(now.getTime() - 86_400_000).toISOString()
  )).webhooks;
}

describe("Twilio webhooks", () => {
  it("does not expose internal API routes", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/call-briefs"
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects an unsigned voice webhook", async () => {
    const { app, service } = createHarness();
    const brief = await createBrief(service);
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/twilio/voice?callBriefId=${brief.id}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "CallSid=CA123"
    });
    expect(response.statusCode).toBe(403);
    expect((await webhookFacts(service)).voice).toMatchObject({
      rejected: 1,
      lastProblemCode: "INVALID_TWILIO_SIGNATURE"
    });
  });

  it("does not change a valid webhook response when evidence storage fails", async () => {
    const { app, service } = createHarness();
    const brief = await createBrief(service);
    vi.spyOn(service, "recordProviderWebhookDelivery").mockRejectedValueOnce(
      new Error("evidence store unavailable")
    );
    const parameters = { CallSid: "CA123" };
    const path = `/webhooks/twilio/voice?callBriefId=${brief.id}`;
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `https://calls.example.test${path}`,
      parameters
    );

    const response = await app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature
      },
      payload: new URLSearchParams(parameters).toString()
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<Connect>");
  });

  it("upgrades a signed media request to a WebSocket", async () => {
    const { app, handleTwilioSocket } = createHarness();
    const path = "/webhooks/twilio/media";
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `wss://calls.example.test${path}`,
      {}
    );
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${address.replace("http:", "ws:")}${path}`, {
      headers: { "x-twilio-signature": signature }
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("close", () => resolve());
      socket.once("error", reject);
    });
    expect(handleTwilioSocket).toHaveBeenCalledOnce();
    expect(typeof handleTwilioSocket.mock.calls[0]?.[0].on).toBe("function");
  });

  it("returns direct Media Stream TwiML and applies signed status callbacks", async () => {
    const { app, service } = createHarness();
    const brief = await createBrief(service);
    const reserved = await service.repository.startAttempt(brief.id, {
      provider: "twilio"
    });

    const voiceParameters = { CallSid: "CA123" };
    const voicePath = `/webhooks/twilio/voice?callBriefId=${brief.id}`;
    const voiceSignature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `https://calls.example.test${voicePath}`,
      voiceParameters
    );
    const voiceResponse = await app.inject({
      method: "POST",
      url: voicePath,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": voiceSignature
      },
      payload: new URLSearchParams(voiceParameters).toString()
    });
    expect(voiceResponse.statusCode).toBe(200);
    expect(voiceResponse.headers["content-type"]).toContain("text/xml");
    expect(voiceResponse.body).toContain("<Connect>");
    expect(voiceResponse.body).toContain("wss://calls.example.test");
    expect(voiceResponse.body).not.toContain("<Say");
    expect(voiceResponse.body).not.toContain("<Gather");
    expect((await webhookFacts(service)).voice.accepted).toBe(1);

    const statusParameters = {
      CallSid: "CA123",
      CallStatus: "in-progress"
    };
    const statusPath = `/webhooks/twilio/status?callBriefId=${brief.id}`;
    const statusUrl = `https://calls.example.test${statusPath}`;
    const statusSignature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      statusUrl,
      statusParameters
    );
    const statusResponse = await app.inject({
      method: "POST",
      url: statusPath,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": statusSignature
      },
      payload: new URLSearchParams(statusParameters).toString()
    });
    expect(statusResponse.statusCode).toBe(204);
    expect((await service.get(brief.id))?.brief.status).toBe("in_progress");
    expect((await webhookFacts(service)).call_status.accepted).toBe(1);

    await service.repository.attachProviderCall(
      reserved.attempt.id,
      "CA123",
      "queued"
    );
    const attempt = await service.repository.getLatestAttempt(brief.id);
    expect(attempt?.providerCallId).toBe("CA123");
    expect(attempt?.providerStatus).toBe("in-progress");
  });

  it("applies a signed recording callback to the expected call and recording", async () => {
    const { app, service } = createHarness();
    const brief = await createBrief(service);
    const reserved = await service.repository.startAttempt(brief.id, {
      provider: "twilio"
    });
    await service.repository.attachProviderCall(
      reserved.attempt.id,
      "CA123",
      "in-progress"
    );
    const begun = await service.repository.beginRecording(brief.id);
    const parameters = {
      CallSid: "CA123",
      RecordingSid: "RE123",
      RecordingStatus: "completed",
      RecordingDuration: "37",
      RecordingChannels: "2"
    };
    const path =
      `/webhooks/twilio/recording?callBriefId=${brief.id}` +
      `&recordingId=${begun.recording.id}`;
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `https://calls.example.test${path}`,
      parameters
    );

    const response = await app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature
      },
      payload: new URLSearchParams(parameters).toString()
    });

    expect(response.statusCode).toBe(204);
    expect((await service.get(brief.id))?.recording).toMatchObject({
      status: "available",
      providerRecordingId: "RE123",
      durationSeconds: 37,
      channels: 2
    });
    expect((await webhookFacts(service)).recording_status.accepted).toBe(1);
  });

  it("records unmatched and failed status deliveries without provider payloads", async () => {
    const { app, service } = createHarness();
    const parameters = { CallSid: "CA-missing", CallStatus: "completed" };
    const path = "/webhooks/twilio/status";
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `https://calls.example.test${path}`,
      parameters
    );
    const request = () => app.inject({
      method: "POST" as const,
      url: path,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature
      },
      payload: new URLSearchParams(parameters).toString()
    });

    expect((await request()).statusCode).toBe(204);
    expect((await webhookFacts(service)).call_status).toMatchObject({
      unmatched: 1,
      lastProblemCode: "WEBHOOK_TARGET_NOT_FOUND"
    });

    vi.spyOn(service, "handleTwilioStatus").mockRejectedValueOnce(
      new CallRepositoryError("DURABLE_JOB_LEASE_LOST")
    );
    expect((await request()).statusCode).toBe(500);
    expect((await webhookFacts(service)).call_status).toMatchObject({
      unmatched: 1,
      failed: 1,
      lastProblemCode: "DURABLE_JOB_LEASE_LOST"
    });
  });
});
