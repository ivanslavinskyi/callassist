import type { CallBrief } from "@callassist/contracts";
import twilio from "twilio";
import { describe, expect, it, vi } from "vitest";
import { TwilioTelephonyProvider } from "./twilio-telephony-provider";

const brief: CallBrief = {
  id: "4da71bb4-6404-4646-8aa1-2af232268780",
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Verify a real outbound Twilio connection",
  agentName: "Sebastian",
  representedPerson: "Ivan Slavinskyi",
  speechImpairmentDisclosure:
    "Herr Slavinskyi ist aufgrund einer Sprechbehinderung beim Telefonieren eingeschränkt.",
  context: "Application context",
  locale: "de-CH",
  allowLanguageSwitch: false,
  allowedFacts: [],
  status: "ready",
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z"
};

function createProvider() {
  const update = vi.fn().mockResolvedValue({ sid: "CA123" });
  const calls = Object.assign(
    vi.fn(() => ({ update })),
    {
      create: vi.fn().mockResolvedValue({
        sid: "CA123",
        status: "queued"
      })
    }
  );
  const provider = new TwilioTelephonyProvider({
    accountSid: "AC123",
    authToken: "test-auth-token",
    fromNumber: "+41710000001",
    publicBaseUrl: "https://calls.example.test",
    client: { calls } as unknown as ReturnType<typeof twilio>
  });
  return { calls, provider, update };
}

describe("TwilioTelephonyProvider", () => {
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

  it("requests consent after the disability disclosure and validates the exact webhook URL", () => {
    const { provider } = createProvider();
    const xml = provider.createVoiceTwiml(brief);
    expect(xml).toContain('<Say language="de-DE">');
    expect(xml).toContain("KI-Assistent");
    expect(xml).toContain("Sprechbehinderung");
    expect(xml.indexOf("Sprechbehinderung")).toBeLessThan(
      xml.indexOf("live transkribiert")
    );
    expect(xml).toContain("<Gather");
    expect(xml).toContain("<Hangup/>");

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

  it("opens a signed bidirectional media stream only after consent", () => {
    const { provider } = createProvider();
    const xml = provider.createConsentTwiml(brief, true);
    expect(xml).toContain("<Connect>");
    expect(xml).toContain(
      '<Stream url="wss://calls.example.test/webhooks/twilio/media">'
    );
    expect(xml).toContain(`name="callBriefId" value="${brief.id}"`);

    const token = provider.createMediaStreamToken(brief.id);
    expect(provider.validateMediaStreamToken(brief.id, token)).toBe(true);
    expect(provider.validateMediaStreamToken(brief.id, `${token}x`)).toBe(false);
    expect(provider.createConsentTwiml(brief, false)).not.toContain("<Stream");
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

  it("renders the complete pre-consent announcement in Russian", () => {
    const { provider } = createProvider();
    const xml = provider.createVoiceTwiml({
      ...brief,
      locale: "ru-RU",
      speechImpairmentDisclosure:
        "Господин Славинский испытывает затруднения при телефонных разговорах из-за нарушения речи."
    });
    expect(xml).toContain('<Say language="ru-RU">');
    expect(xml).toContain("нарушения речи");
    expect(xml.indexOf("нарушения речи")).toBeLessThan(
      xml.indexOf("транскрибироваться")
    );
    expect(xml).toContain("нажмите 1");
  });
});
