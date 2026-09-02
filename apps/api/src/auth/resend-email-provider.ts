import type { EmailProvider } from "./email-provider";

export class ResendEmailProvider implements EmailProvider {
  readonly mode = "resend" as const;
  readonly #apiKey: string;
  readonly #from: string;

  constructor(options: { apiKey: string; from: string }) {
    this.#apiKey = options.apiKey;
    this.#from = options.from;
  }

  async sendEmailChangeVerification(input: {
    to: string;
    code: string;
    expiresInMinutes: number;
    locale: "en" | "de";
  }) {
    const german = input.locale === "de";
    await this.#send({
      to: input.to,
      subject: german
        ? "E-Mail-Adresse für SHPROHLI bestätigen"
        : "Confirm your SHPROHLI email address",
      text: german
        ? `Ihr Bestätigungscode lautet ${input.code}. Er ist ${input.expiresInMinutes} Minuten gültig. Wenn Sie diese Änderung nicht angefordert haben, ignorieren Sie diese Nachricht.`
        : `Your verification code is ${input.code}. It expires in ${input.expiresInMinutes} minutes. If you did not request this change, ignore this message.`
    });
  }

  async sendEmailChangeNotice(input: {
    to: string;
    proposedEmail: string;
    locale: "en" | "de";
  }) {
    const german = input.locale === "de";
    await this.#send({
      to: input.to,
      subject: german
        ? "Änderung Ihrer SHPROHLI-E-Mail angefordert"
        : "A change to your SHPROHLI email was requested",
      text: german
        ? `Für Ihr Konto wurde eine Änderung der Anmelde-E-Mail zu ${input.proposedEmail} angefordert. Die aktuelle Adresse bleibt aktiv, bis die neue bestätigt wird. Wenn Sie dies nicht waren, ändern Sie Ihr Passwort und melden Sie alle Sitzungen ab.`
        : `A change of your account sign-in email to ${input.proposedEmail} was requested. Your current address remains active until the new one is verified. If this was not you, change your password and sign out every session.`
    });
  }

  async #send(input: { to: string; subject: string; text: string }) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: this.#from, ...input })
    });
    if (!response.ok) throw new Error("Email delivery unavailable");
  }
}
