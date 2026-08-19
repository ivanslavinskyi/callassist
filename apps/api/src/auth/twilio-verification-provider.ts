import twilio from "twilio";
import type { VerificationProvider } from "./verification-provider";

type TwilioClient = ReturnType<typeof twilio>;

export class TwilioVerificationProvider implements VerificationProvider {
  readonly mode = "twilio" as const;
  readonly #client: TwilioClient;
  readonly #serviceSid: string;

  constructor(options: {
    accountSid: string;
    authToken: string;
    serviceSid: string;
    client?: TwilioClient;
  }) {
    this.#client = options.client ?? twilio(options.accountSid, options.authToken);
    this.#serviceSid = options.serviceSid;
  }

  async send(phoneE164: string) {
    await this.#client.verify.v2
      .services(this.#serviceSid)
      .verifications.create({ to: phoneE164, channel: "sms" });
  }

  async check(phoneE164: string, code: string) {
    try {
      const result = await this.#client.verify.v2
        .services(this.#serviceSid)
        .verificationChecks.create({ to: phoneE164, code });
      return result.status === "approved";
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        (error.status === 400 || error.status === 404)
      ) {
        return false;
      }
      throw error;
    }
  }
}
