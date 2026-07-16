import twilio from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { buildWebhookApp } from "./app";
import { CallService } from "./call-service";
import type { OpenAIRealtimeBridge } from "./realtime/openai-realtime-bridge";
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
  return service.create({
    recipientName: "Gemeinde Aadorf",
    phoneNumber: "+41523686688",
    objective: "Verify a real outbound Twilio connection",
    locale: "de-CH",
    allowLanguageSwitch: false,
    allowedFacts: []
  });
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
  });

  it("upgrades a signed media request to a WebSocket", async () => {
    const { app, handleTwilioSocket } = createHarness();
    const path = "/webhooks/twilio/media";
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `https://calls.example.test${path}`,
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

  it("returns localized TwiML and applies signed status callbacks", async () => {
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
    expect(voiceResponse.body).toContain('<Say language="de-DE">');
    expect(voiceResponse.body).toContain("Sprechbehinderung");
    expect(voiceResponse.body).toContain("<Gather");

    const consentParameters = { CallSid: "CA123", Digits: "1" };
    const consentPath = `/webhooks/twilio/consent?callBriefId=${brief.id}`;
    const consentSignature = twilio.getExpectedTwilioSignature(
      "test-auth-token",
      `https://calls.example.test${consentPath}`,
      consentParameters
    );
    const consentResponse = await app.inject({
      method: "POST",
      url: consentPath,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": consentSignature
      },
      payload: new URLSearchParams(consentParameters).toString()
    });
    expect(consentResponse.statusCode).toBe(200);
    expect(consentResponse.body).toContain("<Connect>");
    expect(consentResponse.body).toContain("wss://calls.example.test");

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

    await service.repository.attachProviderCall(
      reserved.attempt.id,
      "CA123",
      "queued"
    );
    const attempt = await service.repository.getLatestAttempt(brief.id);
    expect(attempt?.providerCallId).toBe("CA123");
    expect(attempt?.providerStatus).toBe("in-progress");
  });
});
