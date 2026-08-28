import { ApiError } from "../api";
import type { UiLocale } from "./messages";

const en = {
  redeemEyebrow: "Call credits",
  redeemTitle: "Redeem a promo code",
  redeemIntro: "Enter a SHPROHLI promo code. A valid code is applied once and your balance updates immediately.",
  code: "Promo code",
  codePlaceholder: "SHPROHLI25",
  redeem: "Redeem code",
  redeeming: "Redeeming…",
  redeemSuccess: (credits: number) => `${credits} credits were added to your balance.`,
  loading: "Checking account access…",
  signInTitle: "Sign in required",
  signIn: "Sign in to redeem a promo code.",
  adminEyebrow: "Credit operations",
  adminTitle: "Promo codes and manual grants",
  adminIntro: "Create bounded campaigns or issue a documented manual adjustment. Every grant is immutable and tied to the acting administrator.",
  forbiddenTitle: "Administrator access required",
  forbidden: "Only active admin and superadmin accounts can manage credits.",
  createTitle: "Create promo code",
  createHelp: "The raw code exists only in this form and is not stored by the server. Share it through an approved channel.",
  credits: "Credits",
  globalLimit: "Global redemption limit",
  perUserLimit: "Per-user limit",
  campaign: "Campaign",
  campaignPlaceholder: "e.g. Beta launch",
  startsAt: "Starts at (optional)",
  expiresAt: "Expires at (optional)",
  active: "Code can be redeemed immediately",
  reason: "Operational reason",
  createReasonPlaceholder: "e.g. Approved beta acquisition campaign",
  create: "Create promo code",
  creating: "Creating…",
  createSuccess: (code: string) => `Promo code ${code} was created. Save it now; the server stores only its keyed hash.`,
  grantTitle: "Manual credit grant",
  grantHelp: "Use a verified customer email and record the operational reason for the adjustment.",
  targetEmail: "Customer email",
  grantReasonPlaceholder: "e.g. Customer recovery adjustment approved in ticket 123",
  grant: "Grant credits",
  granting: "Granting…",
  grantSuccess: (credits: number, email: string) => `${credits} credits were granted to ${email}.`,
  errors: {
    invalid: "Check every field and try again.",
    unavailable: "This promo code is invalid, inactive, not yet valid, or expired.",
    globalLimit: "This promo campaign has reached its redemption limit.",
    userLimit: "You have already used this promo code the maximum number of times.",
    duplicate: "That promo code already exists. Choose another code.",
    conflict: "This request identifier was already used for different data. Change the form and retry.",
    userNotFound: "No eligible verified account was found for that email.",
    selfGrant: "Administrators cannot grant credits to their own account.",
    forbidden: "Your account is not allowed to perform this action.",
    authentication: "Sign in with an eligible account.",
    rateLimited: "Too many promo attempts. Wait before trying again.",
    invalidOrigin: "This request was blocked for security reasons. Reload the page and try again.",
    generic: "The credit action could not be completed. Try again."
  }
} as const;

type CreditMessages = {
  [Key in Exclude<keyof typeof en, "redeemSuccess" | "createSuccess" | "grantSuccess" | "errors">]: string;
} & {
  redeemSuccess: (credits: number) => string;
  createSuccess: (code: string) => string;
  grantSuccess: (credits: number, email: string) => string;
  errors: { [Key in keyof typeof en.errors]: string };
};

const de: CreditMessages = {
  redeemEyebrow: "Anrufguthaben",
  redeemTitle: "Aktionscode einlösen",
  redeemIntro: "Geben Sie einen SHPROHLI-Aktionscode ein. Ein gültiger Code wird einmal angewendet und Ihr Guthaben sofort aktualisiert.",
  code: "Aktionscode",
  codePlaceholder: "SHPROHLI25",
  redeem: "Code einlösen",
  redeeming: "Wird eingelöst…",
  redeemSuccess: (credits) => `${credits} Guthaben wurden Ihrem Konto hinzugefügt.`,
  loading: "Kontozugriff wird geprüft…",
  signInTitle: "Anmeldung erforderlich",
  signIn: "Melden Sie sich an, um einen Aktionscode einzulösen.",
  adminEyebrow: "Guthabenverwaltung",
  adminTitle: "Aktionscodes und manuelle Gutschriften",
  adminIntro: "Erstellen Sie begrenzte Kampagnen oder eine dokumentierte manuelle Korrektur. Jede Gutschrift ist unveränderlich und dem handelnden Administrator zugeordnet.",
  forbiddenTitle: "Administratorzugriff erforderlich",
  forbidden: "Nur aktive Admin- und Superadmin-Konten können Guthaben verwalten.",
  createTitle: "Aktionscode erstellen",
  createHelp: "Der Klartext-Code existiert nur in diesem Formular und wird nicht auf dem Server gespeichert. Teilen Sie ihn über einen freigegebenen Kanal.",
  credits: "Guthaben",
  globalLimit: "Globales Einlösungslimit",
  perUserLimit: "Limit pro Konto",
  campaign: "Kampagne",
  campaignPlaceholder: "z. B. Beta-Start",
  startsAt: "Gültig ab (optional)",
  expiresAt: "Gültig bis (optional)",
  active: "Code kann sofort eingelöst werden",
  reason: "Betrieblicher Grund",
  createReasonPlaceholder: "z. B. genehmigte Beta-Kampagne",
  create: "Aktionscode erstellen",
  creating: "Wird erstellt…",
  createSuccess: (code) => `Aktionscode ${code} wurde erstellt. Speichern Sie ihn jetzt; der Server speichert nur den geschützten Hash.`,
  grantTitle: "Manuelle Gutschrift",
  grantHelp: "Verwenden Sie die E-Mail eines bestätigten Kundenkontos und dokumentieren Sie den Grund der Korrektur.",
  targetEmail: "Kunden-E-Mail",
  grantReasonPlaceholder: "z. B. Kulanzgutschrift gemäss Ticket 123",
  grant: "Guthaben gutschreiben",
  granting: "Wird gutgeschrieben…",
  grantSuccess: (credits, email) => `${credits} Guthaben wurden ${email} gutgeschrieben.`,
  errors: {
    invalid: "Prüfen Sie alle Felder und versuchen Sie es erneut.",
    unavailable: "Dieser Aktionscode ist ungültig, inaktiv, noch nicht gültig oder abgelaufen.",
    globalLimit: "Diese Aktion hat ihr globales Einlösungslimit erreicht.",
    userLimit: "Sie haben diesen Aktionscode bereits maximal oft verwendet.",
    duplicate: "Dieser Aktionscode existiert bereits. Wählen Sie einen anderen Code.",
    conflict: "Diese Anfragekennung wurde bereits für andere Daten verwendet. Ändern Sie das Formular und versuchen Sie es erneut.",
    userNotFound: "Für diese E-Mail wurde kein geeignetes bestätigtes Konto gefunden.",
    selfGrant: "Administratoren können dem eigenen Konto kein Guthaben gutschreiben.",
    forbidden: "Ihr Konto darf diese Aktion nicht ausführen.",
    authentication: "Melden Sie sich mit einem berechtigten Konto an.",
    rateLimited: "Zu viele Codeversuche. Warten Sie, bevor Sie es erneut versuchen.",
    invalidOrigin: "Diese Anfrage wurde aus Sicherheitsgründen blockiert. Laden Sie die Seite neu und versuchen Sie es erneut.",
    generic: "Die Guthabenaktion konnte nicht abgeschlossen werden. Versuchen Sie es erneut."
  }
};

export const creditMessages: Record<UiLocale, CreditMessages> = { en, de };

export function getCreditErrorMessage(error: unknown, locale: UiLocale) {
  const copy = creditMessages[locale].errors;
  if (!(error instanceof ApiError)) return copy.generic;
  switch (error.code) {
    case "INVALID_PROMO_REDEMPTION":
    case "INVALID_PROMO_CODE":
    case "INVALID_CREDIT_GRANT":
      return copy.invalid;
    case "PROMO_CODE_UNAVAILABLE": return copy.unavailable;
    case "PROMO_GLOBAL_LIMIT_REACHED": return copy.globalLimit;
    case "PROMO_USER_LIMIT_REACHED": return copy.userLimit;
    case "PROMO_CODE_ALREADY_EXISTS": return copy.duplicate;
    case "CREDIT_IDEMPOTENCY_CONFLICT": return copy.conflict;
    case "CREDIT_USER_NOT_FOUND": return copy.userNotFound;
    case "CREDIT_SELF_GRANT_FORBIDDEN": return copy.selfGrant;
    case "CREDIT_ADMIN_ACTION_FORBIDDEN":
    case "ADMIN_ACTION_FORBIDDEN": return copy.forbidden;
    case "AUTHENTICATION_REQUIRED": return copy.authentication;
    case "RATE_LIMITED": return copy.rateLimited;
    case "INVALID_ORIGIN": return copy.invalidOrigin;
    default: return copy.generic;
  }
}
