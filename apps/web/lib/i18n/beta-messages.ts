import type { UiLocale } from "./messages";
const en = {
  invitation: "Invitation code (optional)",
  invitationHelp: "If you received a one-use invitation, enter its code here. Invitations also work when open registration is full.",
  full: "This beta intake is full. If you have an invitation, enter its code, or contact support.",
  invalidInvitation: "This invitation is invalid, expired or already used. Check the code or ask for a new invitation.",
  busy: "All call slots are currently in use. Please try again after an active call finishes.",
  spending: "New requests are temporarily paused because of the beta spending limit. Please try later or contact support.",
  recipient: "This recipient has reached the beta call limit. Please try another day."
};
export const betaMessages: Record<UiLocale, Record<keyof typeof en, string>> = { en, de: {
  invitation: "Einladungscode (optional)",
  invitationHelp: "Wenn Sie eine einmalige Einladung erhalten haben, geben Sie hier den Code ein. Einladungen gelten auch bei voller offener Registrierung.",
  full: "Diese Beta-Runde ist voll. Geben Sie Ihren Einladungscode ein oder wenden Sie sich an den Support.",
  invalidInvitation: "Diese Einladung ist ungültig, abgelaufen oder bereits verwendet. Prüfen Sie den Code oder bitten Sie um eine neue Einladung.",
  busy: "Alle Anrufplätze sind gerade belegt. Versuchen Sie es erneut, sobald ein laufender Anruf beendet ist.",
  spending: "Neue Anfragen sind wegen des Ausgabenlimits der Beta vorübergehend pausiert. Versuchen Sie es später oder kontaktieren Sie den Support.",
  recipient: "Das Anruflimit der Beta für diesen Empfänger ist erreicht. Versuchen Sie es an einem anderen Tag."
} };
export function betaErrorMessage(error: unknown, locale: UiLocale) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const copy = betaMessages[locale];
  if (code === "BETA_REGISTRATION_FULL") return copy.full;
  if (code === "BETA_INVITATION_INVALID") return copy.invalidInvitation;
  if (code === "BETA_CONCURRENCY_LIMIT") return copy.busy;
  if (code === "BETA_RECIPIENT_LIMIT") return copy.recipient;
  if (["BETA_SPENDING_PAUSED", "BETA_BUDGET_UNCONFIGURED", "BETA_BUDGET_EXHAUSTED"].includes(String(code))) return copy.spending;
  return null;
}
