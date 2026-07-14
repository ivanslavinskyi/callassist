import type { CallBrief } from "@callassist/contracts";
import twilio from "twilio";
import { getTwilioGreeting } from "./twilio-copy";
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
    const greeting = getTwilioGreeting(brief.locale);
    const response = new twilio.twiml.VoiceResponse();
    response.say({ language: greeting.language }, greeting.text);
    response.pause({ length: 1 });
    response.hangup();
    return response.toString();
  }

  webhookUrl(path: string) {
    return new URL(path, this.#publicBaseUrl).toString();
  }
}
