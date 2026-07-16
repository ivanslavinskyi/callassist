import { createHmac, timingSafeEqual } from "node:crypto";
import type { CallBrief } from "@callassist/contracts";
import twilio from "twilio";
import { getTwilioCopy } from "./twilio-copy";
import type { TelephonyProvider } from "./telephony-provider";

type TwilioClient = ReturnType<typeof twilio>;

type TwilioTelephonyOptions = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  publicBaseUrl: string;
  client?: TwilioClient;
};

export class TwilioTelephonyProvider implements TelephonyProvider {
  readonly mode = "twilio" as const;
  readonly #authToken: string;
  readonly #client: TwilioClient;
  readonly #fromNumber: string;
  readonly #publicBaseUrl: URL;

  constructor(options: TwilioTelephonyOptions) {
    this.#authToken = options.authToken;
    this.#fromNumber = options.fromNumber;
    this.#publicBaseUrl = new URL(options.publicBaseUrl);
    if (this.#publicBaseUrl.protocol !== "https:") {
      throw new Error("PUBLIC_BASE_URL must use HTTPS for Twilio webhooks");
    }
    this.#client =
      options.client ?? twilio(options.accountSid, options.authToken);
  }

  async startCall(brief: CallBrief) {
    const call = await this.#client.calls.create({
      from: this.#fromNumber,
      method: "POST",
      record: false,
      statusCallback: this.webhookUrl(
        `/webhooks/twilio/status?callBriefId=${encodeURIComponent(brief.id)}`
      ),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      timeout: 30,
      to: brief.phoneNumber,
      url: this.webhookUrl(
        `/webhooks/twilio/voice?callBriefId=${encodeURIComponent(brief.id)}`
      )
    });

    return {
      providerCallId: call.sid,
      providerStatus: call.status
    };
  }

  async stopCall(providerCallId: string) {
    await this.#client.calls(providerCallId).update({ status: "completed" });
  }

  validateWebhook(
    signature: string,
    rawRequestUrl: string,
    parameters: Record<string, string>
  ) {
    const requestUrl = this.webhookUrl(rawRequestUrl);
    return twilio.validateRequest(
      this.#authToken,
      signature,
      requestUrl,
      parameters
    );
  }

  createVoiceTwiml(brief: CallBrief) {
    const copy = getTwilioCopy(brief.locale);
    const response = new twilio.twiml.VoiceResponse();
    const gather = response.gather({
      action: this.webhookUrl(
        `/webhooks/twilio/consent?callBriefId=${encodeURIComponent(brief.id)}`
      ),
      input: ["dtmf"],
      method: "POST",
      numDigits: 1,
      timeout: 8
    });
    gather.say({ language: copy.language }, copy.introduction(brief));
    response.say({ language: copy.language }, copy.noConsent);
    response.hangup();
    return response.toString();
  }

  createConsentTwiml(brief: CallBrief, consented: boolean) {
    const copy = getTwilioCopy(brief.locale);
    const response = new twilio.twiml.VoiceResponse();
    if (!consented) {
      response.say({ language: copy.language }, copy.noConsent);
      response.hangup();
      return response.toString();
    }

    response.say({ language: copy.language }, copy.thanks);
    const connect = response.connect();
    const stream = connect.stream({ url: this.mediaStreamUrl() });
    stream.parameter({ name: "callBriefId", value: brief.id });
    stream.parameter({
      name: "streamToken",
      value: this.createMediaStreamToken(brief.id)
    });
    return response.toString();
  }

  createMediaStreamToken(callBriefId: string) {
    return createHmac("sha256", this.#authToken)
      .update(`callassist-media:${callBriefId}`)
      .digest("base64url");
  }

  validateMediaStreamToken(callBriefId: string, token: string) {
    const expected = Buffer.from(this.createMediaStreamToken(callBriefId));
    const received = Buffer.from(token);
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  mediaStreamUrl() {
    const url = new URL("/webhooks/twilio/media", this.#publicBaseUrl);
    url.protocol = "wss:";
    return url.toString();
  }

  webhookUrl(path: string) {
    return new URL(path, this.#publicBaseUrl).toString();
  }
}
