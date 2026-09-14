import { randomUUID } from "node:crypto";
import type { EmailProvider } from "./email-provider";
import { emailChangeRequestNotice, securityNoticeEmail, verificationEmail, type EmailContent } from "./email-templates";
import { emailIdentity, type EmailBranding } from "./email-branding";

export class ResendEmailProvider implements EmailProvider {
  readonly mode = "resend" as const;
  constructor(private readonly options: {
    apiKey: string; from: string; timeoutMs?: number; branding?: EmailBranding;
    fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>;
  }) {}

  async sendEmailChangeVerification(input: Parameters<EmailProvider["sendEmailChangeVerification"]>[0]) {
    await this.send(input.to, verificationEmail(input, this.options.branding), input.idempotencyKey, "verification", input.locale);
  }
  async sendEmailChangeNotice(input: Parameters<EmailProvider["sendEmailChangeNotice"]>[0]) {
    await this.send(input.to, emailChangeRequestNotice(input.locale, this.options.branding), input.idempotencyKey, "email_change_requested", input.locale);
  }
  async sendSecurityNotice(input: Parameters<EmailProvider["sendSecurityNotice"]>[0]) {
    await this.send(input.to, securityNoticeEmail(input.locale, input.kind, this.options.branding), input.idempotencyKey, input.kind, input.locale);
  }

  private async send(to: string, content: EmailContent, key: string | undefined, purpose: string, locale: string) {
    const messageId = randomUUID();
    // Reuse the same key AND payload after uncertain responses. Resend keeps
    // deduplication keys for 24 hours. A new code requires a new key.
    const idempotencyKey = key ?? messageId;
    const body = JSON.stringify({ from: this.options.from, to, reply_to: emailIdentity.supportAddress, ...content });
    const request = this.options.fetch ?? fetch;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let retryable = true;
      try {
        const response = await request("https://api.resend.com/emails", {
          method: "POST", signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
          headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body
        });
        const result = await response.json().catch(() => null) as { id?: unknown; name?: unknown } | null;
        if (response.ok && typeof result?.id === "string" && /^[a-f0-9-]{36}$/i.test(result.id)) {
          writeDeliveryEvent({ messageId, purpose, locale, attempt, status: "accepted", providerId: result.id });
          return;
        }
        retryable = response.status === 429 || response.status >= 500 ||
          (response.status === 409 && result?.name === "concurrent_idempotent_requests");
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        if (retryAfter > 1) retryable = false;
      } catch {
        // A timeout can follow a successful send: retry using its original key.
      }
      if (!retryable || attempt === 2) {
        writeDeliveryEvent({ messageId, purpose, locale, attempt, status: "failed" });
        throw new Error("Email delivery unavailable");
      }
      await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(1_000);
    }
  }
}

function writeDeliveryEvent(event: { messageId: string; purpose: string; locale: string; attempt: number; status: "accepted" | "failed"; providerId?: string }) {
  // No address, code, body, API key, capability or upstream error text.
  process.stderr.write(`${JSON.stringify({ level: event.status === "failed" ? "error" : "info", event: "transactional_email", time: new Date().toISOString(), ...event })}\n`);
}
