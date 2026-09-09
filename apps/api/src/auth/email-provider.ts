export type EmailLocale = "en" | "de";

// Email templates have their own readiness boundary, independent of UI and
// task content languages. Regional variants use their supported base language.
export function resolveEmailLocale(uiLocale: string | null | undefined): EmailLocale {
  try {
    if (uiLocale && new Intl.Locale(uiLocale).language === "de") return "de";
  } catch {
    // Old or invalid preferences also receive the supported default template.
  }
  return "en";
}

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
