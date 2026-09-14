import twilio from "twilio";
import type { VerificationProvider } from "./verification-provider";
import { resolveCommunicationLocale } from "./communication-locales";

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
    // No automatic SMS retry: an uncertain send may already be billable.
    this.#client = options.client ?? twilio(options.accountSid, options.authToken, { timeout: 8_000, autoRetry: false });
    this.#serviceSid = options.serviceSid;
  }

  async send(phoneE164: string, locale?: string) {
    const selected = resolveCommunicationLocale(locale);
    const result = await this.#client.verify.v2
      .services(this.#serviceSid)
      .verifications.create({ to: phoneE164, channel: "sms", locale: selected.sms });
    process.stderr.write(`${JSON.stringify({ level: "info", event: "sms_verification_accepted", locale: selected.sms,
      fallback: selected.language !== selected.sms,
      providerId: /^VE[a-f0-9]{32}$/i.test(result.sid) ? result.sid : undefined })}\n`);
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
