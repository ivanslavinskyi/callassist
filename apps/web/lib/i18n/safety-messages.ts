import { ApiError } from "../api";
import type { UiLocale } from "./messages";

const en = {
  eyebrow: "Safety operations",
  title: "Recipient suppression",
  intro: "Block a verified complaint or staff-requested number across every SHPROHLI account. Every action requires a reason and is audited.",
  loading: "Checking staff access…",
  forbiddenTitle: "Administrator access required",
  forbidden: "Only active admin and superadmin accounts can manage the global recipient suppression list.",
  signIn: "Sign in",
  suppressTitle: "Block a recipient",
  suppressHelp: "Use complaint only when a complaint has been received and reviewed. Duplicate blocks are safely ignored.",
  phone: "Swiss phone number",
  phonePlaceholder: "+41791234567",
  source: "Source",
  staffSource: "Staff request",
  complaintSource: "Complaint",
  reason: "Operational reason",
  suppressReasonPlaceholder: "e.g. Complaint verified by support",
  suppress: "Block future calls",
  suppressing: "Blocking…",
  suppressSuccess: "The suppression request was processed and audited.",
  suppressUnchanged: "This number was already suppressed; no duplicate audit event was created.",
  liftTitle: "Lift a suppression",
  liftHelp: "Lift only after the recipient's identity and renewed consent have been verified.",
  liftReasonPlaceholder: "e.g. Recipient identity and consent re-verified",
  lift: "Lift suppression",
  lifting: "Lifting…",
  liftSuccess: "The lift request was processed and audited.",
  liftUnchanged: "This number has no active suppression; no audit event was created.",
  errors: {
    invalid: "Check the Swiss phone number, source, and reason.",
    forbidden: "Your account is not allowed to perform this action.",
    authentication: "Sign in with an administrator account.",
    invalidOrigin: "This request was blocked for security reasons. Reload the page and try again.",
    generic: "The safety action could not be completed. Try again."
  }
} as const;

type SafetyMessages = {
  [Key in Exclude<keyof typeof en, "errors">]: string;
} & { errors: { [Key in keyof typeof en.errors]: string } };

const de: SafetyMessages = {
  eyebrow: "Sicherheitsbetrieb",
  title: "Empfängersperren",
  intro: "Sperren Sie eine durch Mitarbeitende oder eine geprüfte Beschwerde gemeldete Nummer für alle SHPROHLI-Konten. Jede Aktion benötigt einen Grund und wird protokolliert.",
  loading: "Mitarbeiterzugriff wird geprüft…",
  forbiddenTitle: "Administratorzugriff erforderlich",
  forbidden: "Nur aktive Admin- und Superadmin-Konten können die globale Empfängersperrliste verwalten.",
  signIn: "Anmelden",
  suppressTitle: "Empfänger sperren",
  suppressHelp: "Verwenden Sie Beschwerde nur, wenn eine Beschwerde eingegangen und geprüft worden ist. Doppelte Sperren werden sicher ignoriert.",
  phone: "Schweizer Telefonnummer",
  phonePlaceholder: "+41791234567",
  source: "Quelle",
  staffSource: "Mitarbeiteranfrage",
  complaintSource: "Beschwerde",
  reason: "Betrieblicher Grund",
  suppressReasonPlaceholder: "z. B. Beschwerde durch Support geprüft",
  suppress: "Zukünftige Anrufe sperren",
  suppressing: "Wird gesperrt…",
  suppressSuccess: "Die Sperranfrage wurde verarbeitet und protokolliert.",
  suppressUnchanged: "Diese Nummer war bereits gesperrt; es wurde kein doppelter Audit-Eintrag erstellt.",
  liftTitle: "Sperre aufheben",
  liftHelp: "Heben Sie eine Sperre erst auf, nachdem Identität und erneute Zustimmung des Empfängers geprüft wurden.",
  liftReasonPlaceholder: "z. B. Identität und Zustimmung erneut geprüft",
  lift: "Sperre aufheben",
  lifting: "Wird aufgehoben…",
  liftSuccess: "Die Aufhebungsanfrage wurde verarbeitet und protokolliert.",
  liftUnchanged: "Für diese Nummer besteht keine aktive Sperre; es wurde kein Audit-Eintrag erstellt.",
  errors: {
    invalid: "Prüfen Sie Schweizer Telefonnummer, Quelle und Grund.",
    forbidden: "Ihr Konto darf diese Aktion nicht ausführen.",
    authentication: "Melden Sie sich mit einem Administratorkonto an.",
    invalidOrigin: "Diese Anfrage wurde aus Sicherheitsgründen blockiert. Laden Sie die Seite neu und versuchen Sie es erneut.",
    generic: "Die Sicherheitsaktion konnte nicht abgeschlossen werden. Versuchen Sie es erneut."
  }
};

export const safetyMessages: Record<UiLocale, SafetyMessages> = { en, de };

export function getSafetyErrorMessage(error: unknown, locale: UiLocale) {
  const copy = safetyMessages[locale].errors;
  if (!(error instanceof ApiError)) return copy.generic;
  switch (error.code) {
    case "INVALID_RECIPIENT_SUPPRESSION":
    case "INVALID_RECIPIENT_SUPPRESSION_LIFT":
      return copy.invalid;
    case "ADMIN_ACTION_FORBIDDEN":
      return copy.forbidden;
    case "AUTHENTICATION_REQUIRED":
      return copy.authentication;
    case "INVALID_ORIGIN":
      return copy.invalidOrigin;
    default:
      return copy.generic;
  }
}
