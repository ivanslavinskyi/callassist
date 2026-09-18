import type { EmailLocale } from "./communication-locales";
import type { SecurityNoticeKind } from "./email-templates";
import type { EmailContent } from "./email-templates";
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

export type AdminNotificationEmail = { to: string; content: EmailContent; idempotencyKey: string };
export interface AdminNotificationEmailProvider {
  sendAdminNotification(input: AdminNotificationEmail): Promise<string>;
}

export class EmailDeliveryError extends Error {
  constructor(readonly retryable: boolean, readonly retryAfterMs = 0) { super("Email delivery unavailable"); }
}

export class MockEmailProvider implements EmailProvider {
  readonly adminMessages: AdminNotificationEmail[] = [];
  async sendAdminNotification(input: AdminNotificationEmail) {
    const existing = this.adminMessages.findIndex(message => message.idempotencyKey === input.idempotencyKey);
    if (existing >= 0) return `mock-${existing + 1}`;
    this.adminMessages.push(structuredClone(input));
    return `mock-${this.adminMessages.length}`;
  }
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
