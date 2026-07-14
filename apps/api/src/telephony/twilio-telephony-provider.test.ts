import type { CallBrief } from "@callassist/contracts";
import twilio from "twilio";
import { describe, expect, it, vi } from "vitest";
import { TwilioTelephonyProvider } from "./twilio-telephony-provider";

const brief: CallBrief = {
  id: "4da71bb4-6404-4646-8aa1-2af232268780",
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Verify a real outbound Twilio connection",
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

  it("renders localized TwiML and validates the exact webhook URL", () => {
    const { provider } = createProvider();
    const xml = provider.createVoiceTwiml(brief);
    expect(xml).toContain('<Say language="de-DE">');
    expect(xml).toContain("digitale Assistent");
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
});
