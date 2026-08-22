import type { CreditTransactionType } from "@callassist/contracts";
import type { UiLocale } from "./messages";

const en = {
  eyebrow: "Account",
  title: "Profile, usage, and sessions",
  intro: "Review the identity used for your account, your call-credit ledger, and active sign-in access.",
  loading: "Loading account…",
  loadError: "Your account could not be loaded. Sign in again or retry.",
  retry: "Retry",
  signIn: "Sign in",
  identityTitle: "Identity",
  name: "First and last name",
  email: "Email",
  phone: "Verified mobile",
  role: "Role",
  status: "Status",
  lastLogin: "Last sign-in",
  never: "Not recorded",
  usageTitle: "Call credits",
  balance: "Current balance",
  activeCall: "Active call",
  noActiveCall: "No active call",
  transactions: "Recent ledger entries",
  noTransactions: "No credit entries yet.",
  credits: (count: number) => `${count} ${count === 1 ? "credit" : "credits"}`,
  sessionsTitle: "Session security",
  sessionsText: "Sign out this browser, or revoke every CallAssist session if a device is lost or your account may be exposed.",
  logout: "Sign out this browser",
  logoutBusy: "Signing out…",
  revokeAll: "Sign out everywhere",
  revokeBusy: "Revoking sessions…",
  revokeTitle: "Sign out on every device?",
  revokeDescription: "All CallAssist sessions, including this browser, will be revoked. You will need to sign in again.",
  actionError: "The session action could not be completed. Please try again.",
  transaction: {
    signup_grant: "Signup credit",
    promo_grant: "Promo credit",
    admin_grant: "Manual credit",
    call_reservation: "Call reservation",
    call_charge: "Connected call",
    call_refund: "Call refund",
    adjustment: "Adjustment"
  } satisfies Record<CreditTransactionType, string>
} as const;

type AccountMessages = {
  [Key in keyof typeof en]: Key extends "credits"
    ? (count: number) => string
    : Key extends "transaction"
      ? Record<CreditTransactionType, string>
      : string;
};

const de: AccountMessages = {
  eyebrow: "Konto",
  title: "Profil, Nutzung und Sitzungen",
  intro: "Prüfen Sie die Identität Ihres Kontos, Ihr Anrufguthaben und den aktiven Anmeldezugriff.",
  loading: "Konto wird geladen…",
  loadError: "Ihr Konto konnte nicht geladen werden. Melden Sie sich erneut an oder versuchen Sie es nochmals.",
  retry: "Erneut versuchen",
  signIn: "Anmelden",
  identityTitle: "Identität",
  name: "Vor- und Nachname",
  email: "E-Mail",
  phone: "Bestätigtes Mobiltelefon",
  role: "Rolle",
  status: "Status",
  lastLogin: "Letzte Anmeldung",
  never: "Nicht erfasst",
  usageTitle: "Anrufguthaben",
  balance: "Aktueller Stand",
  activeCall: "Aktiver Anruf",
  noActiveCall: "Kein aktiver Anruf",
  transactions: "Letzte Kontobewegungen",
  noTransactions: "Noch keine Guthabenbewegungen.",
  credits: (count: number) => `${count} Anrufguthaben`,
  sessionsTitle: "Sitzungssicherheit",
  sessionsText: "Melden Sie diesen Browser ab oder widerrufen Sie alle CallAssist-Sitzungen, wenn ein Gerät verloren ging oder das Konto gefährdet sein könnte.",
  logout: "Diesen Browser abmelden",
  logoutBusy: "Abmeldung läuft…",
  revokeAll: "Überall abmelden",
  revokeBusy: "Sitzungen werden widerrufen…",
  revokeTitle: "Auf allen Geräten abmelden?",
  revokeDescription: "Alle CallAssist-Sitzungen, einschliesslich dieses Browsers, werden widerrufen. Danach ist eine neue Anmeldung erforderlich.",
  actionError: "Die Sitzungsaktion konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
  transaction: {
    signup_grant: "Startguthaben",
    promo_grant: "Aktionsguthaben",
    admin_grant: "Manuelles Guthaben",
    call_reservation: "Anrufreservierung",
    call_charge: "Verbundener Anruf",
    call_refund: "Anrufrückerstattung",
    adjustment: "Korrektur"
  }
};

export const accountMessages: Record<UiLocale, AccountMessages> = { en, de };
