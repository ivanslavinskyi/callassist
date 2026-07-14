import twilio from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
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
  const app = buildApp({ service, twilioProvider: provider, logger: false });
  apps.push(app);
  return { app, service };
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
