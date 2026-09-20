import { extendMessages } from "./extend-messages";
import type { UiLocale } from "./messages";
const en = {
  invitation: "Invitation code (optional)",
  invitationHelp: "If you received a one-use invitation, enter its code here. Invitations also work when open registration is full.",
  full: "This beta intake is full. If you have an invitation, enter its code, or contact support.",
  invalidInvitation: "This invitation is invalid, expired or already used. Check the code or ask for a new invitation.",
  busy: "All call slots are currently in use. Please try again after an active call finishes.",
  spending: "New requests are temporarily paused because of the beta spending limit. Please try later or contact support.",
  budgetUnconfigured: "Call preparation is paused because the service budget has not been set. Your entries are saved. Please contact support.",
  budgetExhausted: "Call preparation is paused because the service's spending limit for the last 24 hours has been reached. Your entries are saved. Please try later or contact support.",
  spendingPaused: "Call preparation has been paused by the service operator. Your entries are saved. Please contact support.",
  configureBudget: "Set the budget in admin settings",
  recipient: "This recipient has reached the beta call limit. Please try another day."
};
export const betaMessages: Record<UiLocale, Record<keyof typeof en, string>> = extendMessages({ en, de: {
  invitation: "Einladungscode (optional)",
  invitationHelp: "Wenn Sie eine einmalige Einladung erhalten haben, geben Sie hier den Code ein. Einladungen gelten auch bei voller offener Registrierung.",
  full: "Diese Beta-Runde ist voll. Geben Sie Ihren Einladungscode ein oder wenden Sie sich an den Support.",
  invalidInvitation: "Diese Einladung ist ungültig, abgelaufen oder bereits verwendet. Prüfen Sie den Code oder bitten Sie um eine neue Einladung.",
  busy: "Alle Anrufplätze sind gerade belegt. Versuchen Sie es erneut, sobald ein laufender Anruf beendet ist.",
  spending: "Neue Anfragen sind wegen des Ausgabenlimits der Beta vorübergehend pausiert. Versuchen Sie es später oder kontaktieren Sie den Support.",
  budgetUnconfigured: "Die Anrufvorbereitung ist pausiert, weil das Budget des Dienstes noch nicht festgelegt wurde. Ihre Eingaben sind gespeichert. Bitte kontaktieren Sie den Support.",
  budgetExhausted: "Die Anrufvorbereitung ist pausiert, weil das Ausgabenlimit des Dienstes für die letzten 24 Stunden erreicht wurde. Ihre Eingaben sind gespeichert. Versuchen Sie es später oder kontaktieren Sie den Support.",
  spendingPaused: "Die Anrufvorbereitung wurde vom Betreiber pausiert. Ihre Eingaben sind gespeichert. Bitte kontaktieren Sie den Support.",
  configureBudget: "Budget in den Admin-Einstellungen festlegen",
  recipient: "Das Anruflimit der Beta für diesen Empfänger ist erreicht. Versuchen Sie es an einem anderen Tag."
} });
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
