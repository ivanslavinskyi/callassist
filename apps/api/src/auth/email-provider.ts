import type { EmailLocale } from "./communication-locales";
import type { SecurityNoticeKind } from "./email-templates";
export { resolveEmailLocale, type EmailLocale } from "./communication-locales";

export interface EmailProvider {
  readonly mode: "mock" | "resend";
  sendSecurityNotice(input: { to: string; locale: EmailLocale; kind: SecurityNoticeKind; idempotencyKey: string }): Promise<void>;
  sendEmailChangeVerification(input: {
    to: string;
    code: string;
    expiresInMinutes: number;
    locale: EmailLocale;
    idempotencyKey?: string;
  }): Promise<void>;
  sendEmailChangeNotice(input: {
    to: string;
    proposedEmail: string;
    locale: EmailLocale;
    idempotencyKey?: string;
  }): Promise<void>;
}

export class MockEmailProvider implements EmailProvider {
  readonly mode = "mock" as const;
  readonly securityMessages: Array<{ to: string; locale: EmailLocale; kind: SecurityNoticeKind; idempotencyKey: string }> = [];

  async sendSecurityNotice(input: { to: string; locale: EmailLocale; kind: SecurityNoticeKind; idempotencyKey: string }) {
    this.securityMessages.push(structuredClone(input));
  }
  readonly verificationMessages: Array<{
    to: string;
    code: string;
    expiresInMinutes: number;
    locale: EmailLocale;
    idempotencyKey?: string;
  }> = [];
  readonly noticeMessages: Array<{
    to: string;
    proposedEmail: string;
    locale: EmailLocale;
    idempotencyKey?: string;
  }> = [];

  async sendEmailChangeVerification(input: {
    to: string;
    code: string;
    expiresInMinutes: number;
    locale: EmailLocale;
    idempotencyKey?: string;
  }) {
    this.verificationMessages.push(structuredClone(input));
  }

  async sendEmailChangeNotice(input: {
    to: string;
    proposedEmail: string;
    locale: EmailLocale;
    idempotencyKey?: string;
  }) {
    this.noticeMessages.push(structuredClone(input));
  }
}
