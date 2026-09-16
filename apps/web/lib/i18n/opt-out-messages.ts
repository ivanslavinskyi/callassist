import { ApiError } from "../api";
import type { UiLocale } from "./messages";

const en = {
  eyebrow: "Recipient control",
  title: "Stop SHPROHLI calls to your number",
  intro: "If your Swiss phone number has received a SHPROHLI call, including a missed call, you can verify it by SMS and block future calls from all SHPROHLI accounts.",
  phone: "Phone number",
  phonePlaceholder: "+41791234567",
  phoneHelp: "Use the number that should no longer receive SHPROHLI calls.",
  send: "Send verification code",
  sending: "Sending code…",
  verifyTitle: "Confirm your number",
  verifyIntro: (phone: string) => `If ${phone} has received a SHPROHLI call and is not already blocked, we will send a verification code by SMS. Enter it below.`,
  noCode: "No code received, or your number cannot receive SMS? Wait a minute before requesting another code, or contact us:",
  code: "SMS verification code",
  codePlaceholder: "000000",
  confirm: "Stop future calls",
  confirming: "Confirming…",
  changePhone: "Use a different number",
  successTitle: "Future calls are blocked",
  success: "This phone number is now on the SHPROHLI do-not-call list. The block applies across all SHPROHLI accounts.",
  done: "Return to SHPROHLI",
  errors: {
    invalidRequest: "Enter a valid Swiss phone number.",
    invalidCode: "The verification code is incorrect or expired.",
    unavailable: "SMS verification is temporarily unavailable. Try again shortly.",
    rateLimited: "Too many attempts. Wait before trying again.",
    invalidOrigin: "This request was blocked for security reasons. Reload the page and try again.",
    generic: "The request could not be completed. Please try again."
  }
} as const;

type OptOutMessages = {
  [Key in Exclude<keyof typeof en, "verifyIntro" | "errors">]: string;
} & {
  verifyIntro: (phone: string) => string;
  errors: { [Key in keyof typeof en.errors]: string };
};

const de: OptOutMessages = {
  eyebrow: "Anrufschutz",
  title: "SHPROHLI-Anrufe an Ihre Nummer stoppen",
  intro: "Wenn Ihre Schweizer Telefonnummer einen SHPROHLI-Anruf erhalten hat, auch einen verpassten, können Sie sie per SMS bestätigen und zukünftige Anrufe aus allen SHPROHLI-Konten sperren.",
  phone: "Telefonnummer",
  phonePlaceholder: "+41791234567",
  phoneHelp: "Verwenden Sie die Nummer, die keine SHPROHLI-Anrufe mehr erhalten soll.",
  send: "Bestätigungscode senden",
  sending: "Code wird gesendet…",
  verifyTitle: "Nummer bestätigen",
  verifyIntro: (phone: string) => `Wenn ${phone} einen SHPROHLI-Anruf erhalten hat und noch nicht gesperrt ist, senden wir einen Bestätigungscode per SMS. Geben Sie ihn unten ein.`,
  noCode: "Keinen Code erhalten oder Ihre Nummer kann keine SMS empfangen? Warten Sie eine Minute, bevor Sie einen neuen Code anfordern, oder kontaktieren Sie uns:",
  code: "SMS-Bestätigungscode",
  codePlaceholder: "000000",
  confirm: "Zukünftige Anrufe stoppen",
  confirming: "Wird bestätigt…",
  changePhone: "Andere Nummer verwenden",
  successTitle: "Zukünftige Anrufe sind gesperrt",
  success: "Diese Telefonnummer steht jetzt auf der SHPROHLI-Sperrliste. Die Sperre gilt für alle SHPROHLI-Konten.",
  done: "Zurück zu SHPROHLI",
  errors: {
    invalidRequest: "Geben Sie eine gültige Schweizer Telefonnummer ein.",
    invalidCode: "Der Bestätigungscode ist falsch oder abgelaufen.",
    unavailable: "Die SMS-Bestätigung ist vorübergehend nicht verfügbar. Versuchen Sie es gleich noch einmal.",
    rateLimited: "Zu viele Versuche. Warten Sie, bevor Sie es erneut versuchen.",
    invalidOrigin: "Diese Anfrage wurde aus Sicherheitsgründen blockiert. Laden Sie die Seite neu und versuchen Sie es erneut.",
    generic: "Die Anfrage konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut."
  }
};

export const optOutMessages: Record<UiLocale, OptOutMessages> = { en, de };

export function getOptOutErrorMessage(error: unknown, locale: UiLocale) {
  const copy = optOutMessages[locale].errors;
  if (!(error instanceof ApiError)) return copy.generic;
  switch (error.code) {
    case "INVALID_OPT_OUT_REQUEST":
    case "INVALID_OPT_OUT_CONFIRMATION":
      return copy.invalidRequest;
    case "INVALID_OPT_OUT_VERIFICATION":
      return copy.invalidCode;
    case "VERIFICATION_UNAVAILABLE":
      return copy.unavailable;
    case "RATE_LIMITED":
      return copy.rateLimited;
    case "INVALID_ORIGIN":
      return copy.invalidOrigin;
    default:
      return copy.generic;
  }
}
