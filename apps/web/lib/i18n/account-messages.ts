import type {
  AccountDeletionStatus,
  AccountSessionBrowser,
  AccountSessionPlatform,
  CreditTransactionType,
  UserRole,
  UserStatus
} from "@callassist/contracts";
import type { UiLocale } from "./messages";
import { ApiError } from "../api";

const en = {
  eyebrow: "Account",
  title: "Profile, usage, and sessions",
  intro: "Review your profile, call credits, active sessions and personal data controls.",
  sectionNavigation: "Account sections",
  sectionProfile: "Profile",
  sectionUsage: "Usage",
  sectionSecurity: "Security",
  sectionData: "Data & privacy",
  currentAccount: "Current account",
  loading: "Loading account…",
  loadError: "Your account could not be loaded. Sign in again or retry.",
  retry: "Retry",
  signIn: "Sign in",
  identityTitle: "Identity",
  name: "First and last name",
  firstName: "First name",
  lastName: "Last name",
  nameEdit: "Edit name",
  nameSave: "Save name",
  nameSaving: "Saving…",
  nameCancel: "Cancel",
  nameError: "Your name could not be saved. Check both fields and try again.",
  nameSuccess: "Your name was updated.",
  email: "Email",
  emailChangeTitle: "Change sign-in email",
  emailChangeAction: "Change",
  emailChangeActionLabel: "Change sign-in email",
  emailChangeClose: "Close",
  emailChangeText: "Confirm your current password. Your current email remains active until you verify the new address.",
  emailChangeNewEmail: "New email",
  emailChangeCurrentPassword: "Current password",
  emailChangeSend: "Send email verification code",
  emailChangeSending: "Sending code…",
  emailChangeSent: "We sent a six-digit code to",
  emailChangeCode: "Email verification code",
  emailChangeCodeHint: "The code expires after 10 minutes and can be used only in this browser session.",
  emailChangeVerify: "Verify and change email",
  emailChangeVerifying: "Verifying…",
  emailChangeCancel: "Use a different email",
  emailChangeError: "The email could not be changed. Check the password, address, or code and try again.",
  emailChangeSuccess: "Your sign-in email was changed. Other sessions were signed out.",
  changeInvalidPassword: "The current password is incorrect.",
  changeInvalidCode: "The verification code is incorrect or has expired.",
  changeRateLimited: "Too many attempts. Wait a moment before trying again.",
  changeDeliveryUnavailable: "The verification service is temporarily unavailable. Try again later.",
  emailChangeUnavailable: "This email address cannot be used.",
  phoneChangeUnavailable: "This mobile number cannot be used.",
  phone: "Verified mobile",
  phoneChangeTitle: "Change verified mobile",
  phoneChangeAction: "Change",
  phoneChangeActionLabel: "Change verified mobile",
  phoneChangeClose: "Close",
  phoneChangeText: "Confirm your current password, then verify the replacement number by SMS.",
  phoneChangeSecurity: "After verification, other sessions are signed out and recovery links created for the old number stop working.",
  phoneChangeCurrentPassword: "Current password",
  phoneChangeNewPhone: "New mobile in international format",
  phoneChangeFormatHint: "Swiss mobile number; spaces and local 07x format are accepted.",
  phoneChangeSent: "We sent a verification code to",
  phoneChangeSend: "Send verification code",
  phoneChangeSending: "Sending code…",
  phoneChangeCode: "SMS verification code",
  phoneChangeCodeHint: "Enter the code sent to the new number. This step stays tied to this browser session.",
  phoneChangeVerify: "Verify and change number",
  phoneChangeVerifying: "Verifying…",
  phoneChangeCancel: "Cancel",
  phoneChangeError: "The number could not be changed. Check the password, number, or code and try again.",
  phoneChangeSuccess: "Your verified mobile was changed. Other sessions were signed out.",
  role: "Role",
  status: "Status",
  roles: {
    user: "User",
    admin: "Administrator",
    superadmin: "Super administrator",
    content_editor: "Content editor",
    support: "Support"
  } satisfies Record<UserRole, string>,
  statuses: {
    active: "Active",
    suspended: "Suspended",
    deleted: "Deleted"
  } satisfies Record<UserStatus, string>,
  lastLogin: "Last sign-in",
  never: "Not recorded",
  usageTitle: "Call credits",
  balance: "Current balance",
  activeCall: "Active call",
  noActiveCall: "No active call",
  transactions: "Credit history",
  noTransactions: "No credit entries yet.",
  exportTitle: "Download your data",
  exportText: "Download a JSON copy of the personal data currently associated with your SHPROHLI account.",
  exportIncludes: [
    "Profile and account information",
    "Active sessions and credit history",
    "Calls, transcripts and feedback"
  ],
  exportPrivacy: "The file can contain sensitive personal and call information. Store it securely.",
  exportAction: "Download JSON export",
  exportBusy: "Preparing export…",
  exportError: "The export could not be prepared. Please wait and try again.",
  credits: (count: number) => `${count} ${count === 1 ? "credit" : "credits"}`,
  sessionsTitle: "Session security",
  sessionsText: "Sign out this browser, or revoke every SHPROHLI session if a device is lost or your account may be exposed.",
  activeSessions: "Active sessions",
  sessionCount: (count: number) => `${count} active ${count === 1 ? "session" : "sessions"}`,
  currentSession: "This session",
  created: "Signed in",
  lastSeen: "Last active",
  expires: "Expires",
  revokeSession: "Revoke session",
  revokeSessionBusy: "Revoking session…",
  revokeSessionTitle: "Revoke this session?",
  revokeSessionDescription: (current: boolean) => current
    ? "This browser will be signed out immediately. You will need to sign in again."
    : "That browser will lose access immediately. Other sessions remain active.",
  noSessions: "No active sessions were found.",
  sessionsTruncated: "Only the 50 most recently active sessions are shown. Use sign out everywhere to revoke any older sessions too.",
  browser: {
    edge: "Microsoft Edge",
    chrome: "Chrome",
    firefox: "Firefox",
    safari: "Safari",
    other: "Other browser"
  } satisfies Record<AccountSessionBrowser, string>,
  platform: {
    windows: "Windows",
    macos: "macOS",
    ios: "iOS",
    android: "Android",
    linux: "Linux",
    other: "Unknown platform"
  } satisfies Record<AccountSessionPlatform, string>,
  logout: "Sign out this browser",
  logoutBusy: "Signing out…",
  revokeAll: "Sign out everywhere",
  revokeBusy: "Revoking sessions…",
  revokeTitle: "Sign out on every device?",
  revokeDescription: "All SHPROHLI sessions, including this browser, will be revoked. You will need to sign in again.",
  actionError: "The session action could not be completed. Please try again.",
  deletionTitle: "Delete your account",
  deletionText: "Delete your SHPROHLI account and personal call content. You will be signed out on every device.",
  deletionIrreversible: "This cannot be undone. Some limited records may be retained where necessary for security, abuse prevention, accounting or legal obligations.",
  deletionExportFirst: "Download your data before starting if you want to keep a copy.",
  deletionPassword: "Current password",
  deletionConfirmation: "Type DELETE MY ACCOUNT",
  deletionConfirmationHint: "Enter the phrase exactly to enable deletion.",
  deletionAction: "Delete my account",
  deletionBusy: "Submitting deletion request…",
  deletionError: "The deletion request could not be submitted. Check your password and confirmation, then try again.",
  deletionStatusTitle: "Deletion request status",
  deletionAttempt: (attempt: number, maximum: number) => `Attempt ${attempt} of ${maximum}`,
  deletionNextAttempt: "SHPROHLI will try again automatically.",
  deletionNeedsSupport: "The request could not be completed automatically. Contact support for help; already deleted data will not be restored.",
  deletionStatuses: {
    queued: "Queued",
    processing: "Deleting data",
    waiting_for_calls: "Waiting for an active call to finish",
    retrying: "Retry scheduled",
    needs_support: "Support action required",
    completed: "Completed"
  } satisfies Record<AccountDeletionStatus, string>,
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
  [Key in keyof typeof en]: Key extends "credits" | "sessionCount"
    ? (count: number) => string
    : Key extends "deletionAttempt"
      ? (attempt: number, maximum: number) => string
    : Key extends "revokeSessionDescription"
      ? (current: boolean) => string
    : Key extends "transaction"
      ? Record<CreditTransactionType, string>
      : Key extends "browser"
        ? Record<AccountSessionBrowser, string>
      : Key extends "roles"
        ? Record<UserRole, string>
      : Key extends "statuses"
        ? Record<UserStatus, string>
      : Key extends "platform"
          ? Record<AccountSessionPlatform, string>
        : Key extends "deletionStatuses"
          ? Record<AccountDeletionStatus, string>
        : Key extends "exportIncludes"
          ? readonly string[]
      : string;
};

const de: AccountMessages = {
  eyebrow: "Konto",
  title: "Profil, Nutzung und Sitzungen",
  intro: "Prüfen Sie Ihr Profil, Anrufguthaben, aktive Sitzungen und Einstellungen für Ihre Personendaten.",
  sectionNavigation: "Kontobereiche",
  sectionProfile: "Profil",
  sectionUsage: "Nutzung",
  sectionSecurity: "Sicherheit",
  sectionData: "Daten & Datenschutz",
  currentAccount: "Aktuelles Konto",
  loading: "Konto wird geladen…",
  loadError: "Ihr Konto konnte nicht geladen werden. Melden Sie sich erneut an oder versuchen Sie es nochmals.",
  retry: "Erneut versuchen",
  signIn: "Anmelden",
  identityTitle: "Identität",
  name: "Vor- und Nachname",
  firstName: "Vorname",
  lastName: "Nachname",
  nameEdit: "Name bearbeiten",
  nameSave: "Name speichern",
  nameSaving: "Wird gespeichert…",
  nameCancel: "Abbrechen",
  nameError: "Ihr Name konnte nicht gespeichert werden. Prüfen Sie beide Felder und versuchen Sie es erneut.",
  nameSuccess: "Ihr Name wurde aktualisiert.",
  email: "E-Mail",
  emailChangeTitle: "Anmelde-E-Mail ändern",
  emailChangeAction: "Ändern",
  emailChangeActionLabel: "Anmelde-E-Mail ändern",
  emailChangeClose: "Schliessen",
  emailChangeText: "Bestätigen Sie Ihr aktuelles Passwort. Ihre bisherige E-Mail bleibt aktiv, bis Sie die neue Adresse bestätigt haben.",
  emailChangeNewEmail: "Neue E-Mail",
  emailChangeCurrentPassword: "Aktuelles Passwort",
  emailChangeSend: "E-Mail-Bestätigungscode senden",
  emailChangeSending: "Code wird gesendet…",
  emailChangeSent: "Wir haben einen sechsstelligen Code gesendet an",
  emailChangeCode: "E-Mail-Bestätigungscode",
  emailChangeCodeHint: "Der Code läuft nach 10 Minuten ab und kann nur in dieser Browser-Sitzung verwendet werden.",
  emailChangeVerify: "E-Mail bestätigen und ändern",
  emailChangeVerifying: "Wird bestätigt…",
  emailChangeCancel: "Andere E-Mail verwenden",
  emailChangeError: "Die E-Mail konnte nicht geändert werden. Prüfen Sie Passwort, Adresse oder Code und versuchen Sie es erneut.",
  emailChangeSuccess: "Ihre Anmelde-E-Mail wurde geändert. Andere Sitzungen wurden abgemeldet.",
  changeInvalidPassword: "Das aktuelle Passwort ist falsch.",
  changeInvalidCode: "Der Bestätigungscode ist falsch oder abgelaufen.",
  changeRateLimited: "Zu viele Versuche. Warten Sie einen Moment und versuchen Sie es erneut.",
  changeDeliveryUnavailable: "Der Bestätigungsdienst ist vorübergehend nicht verfügbar. Versuchen Sie es später erneut.",
  emailChangeUnavailable: "Diese E-Mail-Adresse kann nicht verwendet werden.",
  phoneChangeUnavailable: "Diese Mobilnummer kann nicht verwendet werden.",
  phone: "Bestätigtes Mobiltelefon",
  phoneChangeTitle: "Bestätigte Mobilnummer ändern",
  phoneChangeAction: "Ändern",
  phoneChangeActionLabel: "Bestätigte Mobilnummer ändern",
  phoneChangeClose: "Schliessen",
  phoneChangeText: "Bestätigen Sie Ihr aktuelles Passwort und danach die neue Nummer per SMS.",
  phoneChangeSecurity: "Nach der Bestätigung werden andere Sitzungen abgemeldet und Wiederherstellungslinks für die alte Nummer ungültig.",
  phoneChangeCurrentPassword: "Aktuelles Passwort",
  phoneChangeNewPhone: "Neue Mobilnummer im internationalen Format",
  phoneChangeFormatHint: "Schweizer Mobilnummer; Leerzeichen und das lokale 07x-Format werden akzeptiert.",
  phoneChangeSent: "Wir haben einen Bestätigungscode gesendet an",
  phoneChangeSend: "Bestätigungscode senden",
  phoneChangeSending: "Code wird gesendet…",
  phoneChangeCode: "SMS-Bestätigungscode",
  phoneChangeCodeHint: "Geben Sie den Code ein, der an die neue Nummer gesendet wurde. Dieser Schritt bleibt an diese Browser-Sitzung gebunden.",
  phoneChangeVerify: "Nummer bestätigen und ändern",
  phoneChangeVerifying: "Nummer wird bestätigt…",
  phoneChangeCancel: "Abbrechen",
  phoneChangeError: "Die Nummer konnte nicht geändert werden. Prüfen Sie Passwort, Nummer oder Code und versuchen Sie es erneut.",
  phoneChangeSuccess: "Ihre bestätigte Mobilnummer wurde geändert. Andere Sitzungen wurden abgemeldet.",
  role: "Rolle",
  status: "Status",
  roles: {
    user: "Benutzer",
    admin: "Administrator",
    superadmin: "Superadministrator",
    content_editor: "Inhaltsredaktion",
    support: "Support"
  },
  statuses: {
    active: "Aktiv",
    suspended: "Gesperrt",
    deleted: "Gelöscht"
  },
  lastLogin: "Letzte Anmeldung",
  never: "Nicht erfasst",
  usageTitle: "Anrufguthaben",
  balance: "Aktueller Stand",
  activeCall: "Aktiver Anruf",
  noActiveCall: "Kein aktiver Anruf",
  transactions: "Guthabenverlauf",
  noTransactions: "Noch keine Guthabenbewegungen.",
  exportTitle: "Ihre Daten herunterladen",
  exportText: "Laden Sie eine JSON-Kopie der Personendaten herunter, die aktuell mit Ihrem SHPROHLI-Konto verknüpft sind.",
  exportIncludes: [
    "Profil- und Kontoinformationen",
    "Aktive Sitzungen und Guthabenverlauf",
    "Anrufe, Transkripte und Rückmeldungen"
  ],
  exportPrivacy: "Die Datei kann sensible Personen- und Anrufdaten enthalten. Bewahren Sie sie sicher auf.",
  exportAction: "JSON-Export herunterladen",
  exportBusy: "Export wird erstellt…",
  exportError: "Der Export konnte nicht erstellt werden. Bitte warten Sie und versuchen Sie es erneut.",
  credits: (count: number) => `${count} Anrufguthaben`,
  sessionsTitle: "Sitzungssicherheit",
  sessionsText: "Melden Sie diesen Browser ab oder widerrufen Sie alle SHPROHLI-Sitzungen, wenn ein Gerät verloren ging oder das Konto gefährdet sein könnte.",
  activeSessions: "Aktive Sitzungen",
  sessionCount: (count: number) => `${count} aktive ${count === 1 ? "Sitzung" : "Sitzungen"}`,
  currentSession: "Diese Sitzung",
  created: "Angemeldet",
  lastSeen: "Zuletzt aktiv",
  expires: "Läuft ab",
  revokeSession: "Sitzung widerrufen",
  revokeSessionBusy: "Sitzung wird widerrufen…",
  revokeSessionTitle: "Diese Sitzung widerrufen?",
  revokeSessionDescription: (current: boolean) => current
    ? "Dieser Browser wird sofort abgemeldet. Danach ist eine neue Anmeldung erforderlich."
    : "Dieser Browser verliert sofort den Zugriff. Andere Sitzungen bleiben aktiv.",
  noSessions: "Keine aktiven Sitzungen gefunden.",
  sessionsTruncated: "Es werden nur die 50 zuletzt aktiven Sitzungen angezeigt. Mit „Überall abmelden“ werden auch ältere Sitzungen widerrufen.",
  browser: {
    edge: "Microsoft Edge",
    chrome: "Chrome",
    firefox: "Firefox",
    safari: "Safari",
    other: "Anderer Browser"
  },
  platform: {
    windows: "Windows",
    macos: "macOS",
    ios: "iOS",
    android: "Android",
    linux: "Linux",
    other: "Unbekannte Plattform"
  },
  logout: "Diesen Browser abmelden",
  logoutBusy: "Abmeldung läuft…",
  revokeAll: "Überall abmelden",
  revokeBusy: "Sitzungen werden widerrufen…",
  revokeTitle: "Auf allen Geräten abmelden?",
  revokeDescription: "Alle SHPROHLI-Sitzungen, einschliesslich dieses Browsers, werden widerrufen. Danach ist eine neue Anmeldung erforderlich.",
  actionError: "Die Sitzungsaktion konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
  deletionTitle: "Ihr Konto löschen",
  deletionText: "Löschen Sie Ihr SHPROHLI-Konto und Ihre persönlichen Anrufinhalte. Sie werden auf allen Geräten abgemeldet.",
  deletionIrreversible: "Dies kann nicht rückgängig gemacht werden. Bestimmte begrenzte Angaben dürfen aufbewahrt werden, soweit dies für Sicherheit, Missbrauchsschutz, Abrechnung oder rechtliche Pflichten erforderlich ist.",
  deletionExportFirst: "Laden Sie Ihre Daten vorher herunter, wenn Sie eine Kopie behalten möchten.",
  deletionPassword: "Aktuelles Passwort",
  deletionConfirmation: "DELETE MY ACCOUNT eingeben",
  deletionConfirmationHint: "Geben Sie die Formulierung exakt ein, um die Löschung freizuschalten.",
  deletionAction: "Mein Konto löschen",
  deletionBusy: "Löschanfrage wird übermittelt…",
  deletionError: "Die Löschanfrage konnte nicht übermittelt werden. Prüfen Sie Passwort und Bestätigung und versuchen Sie es erneut.",
  deletionStatusTitle: "Status der Löschanfrage",
  deletionAttempt: (attempt: number, maximum: number) => `Versuch ${attempt} von ${maximum}`,
  deletionNextAttempt: "SHPROHLI versucht es automatisch erneut.",
  deletionNeedsSupport: "Die Anfrage konnte nicht automatisch abgeschlossen werden. Wenden Sie sich an den Support; bereits gelöschte Daten werden nicht wiederhergestellt.",
  deletionStatuses: {
    queued: "Eingereiht",
    processing: "Daten werden gelöscht",
    waiting_for_calls: "Warten auf das Ende eines aktiven Anrufs",
    retrying: "Wiederholung geplant",
    needs_support: "Support-Aktion erforderlich",
    completed: "Abgeschlossen"
  },
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

export function getAccountContactChangeErrorMessage(
  error: unknown,
  locale: UiLocale,
  kind: "email" | "phone"
) {
  const copy = accountMessages[locale];
  if (!(error instanceof ApiError)) {
    return kind === "email" ? copy.emailChangeError : copy.phoneChangeError;
  }
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return copy.changeInvalidPassword;
    case "INVALID_EMAIL_CHANGE":
    case "INVALID_PHONE_CHANGE":
      return copy.changeInvalidCode;
    case "EMAIL_CHANGE_NOT_AVAILABLE":
      return copy.emailChangeUnavailable;
    case "PHONE_CHANGE_NOT_AVAILABLE":
      return copy.phoneChangeUnavailable;
    case "RATE_LIMITED":
      return copy.changeRateLimited;
    case "EMAIL_DELIVERY_UNAVAILABLE":
    case "VERIFICATION_UNAVAILABLE":
    case "RATE_LIMIT_UNAVAILABLE":
      return copy.changeDeliveryUnavailable;
    default:
      return kind === "email" ? copy.emailChangeError : copy.phoneChangeError;
  }
}
