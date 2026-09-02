export type EmailLocale = "en" | "de";

export interface EmailProvider {
  readonly mode: "mock" | "resend";
  sendEmailChangeVerification(input: {
    to: string;
    code: string;
    expiresInMinutes: number;
    locale: EmailLocale;
  }): Promise<void>;
  sendEmailChangeNotice(input: {
    to: string;
    proposedEmail: string;
    locale: EmailLocale;
  }): Promise<void>;
}

export class MockEmailProvider implements EmailProvider {
  readonly mode = "mock" as const;
  readonly verificationMessages: Array<{
    to: string;
    code: string;
    expiresInMinutes: number;
    locale: EmailLocale;
  }> = [];
  readonly noticeMessages: Array<{
    to: string;
    proposedEmail: string;
    locale: EmailLocale;
  }> = [];

  async sendEmailChangeVerification(input: {
    to: string;
    code: string;
    expiresInMinutes: number;
    locale: EmailLocale;
  }) {
    this.verificationMessages.push(structuredClone(input));
  }

  async sendEmailChangeNotice(input: {
    to: string;
    proposedEmail: string;
    locale: EmailLocale;
  }) {
    this.noticeMessages.push(structuredClone(input));
  }
}
