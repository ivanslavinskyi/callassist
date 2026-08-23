import type {
  AccountDeletionStatus,
  AccountSessionBrowser,
  AccountSessionPlatform,
  CreditTransactionType
} from "@callassist/contracts";
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
  phoneChangeTitle: "Change verified mobile",
  phoneChangeText: "Confirm your current password, then verify the replacement number by SMS.",
  phoneChangeSecurity: "After verification, other sessions are signed out and recovery links created for the old number stop working.",
  phoneChangeCurrentPassword: "Current password",
  phoneChangeNewPhone: "New mobile in international format",
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
  lastLogin: "Last sign-in",
  never: "Not recorded",
  usageTitle: "Call credits",
  balance: "Current balance",
  activeCall: "Active call",
  noActiveCall: "No active call",
  transactions: "Recent ledger entries",
  noTransactions: "No credit entries yet.",
  exportTitle: "Download your data",
  exportText: "Create a versioned JSON file containing the account data currently available to you in CallAssist.",
  exportIncludes: [
    "Profile and active session summaries",
    "Complete credit ledger and legal acceptances",
    "Your call briefs, compiled plans, consent metadata, transcripts, recordings metadata, outcomes, and feedback"
  ],
  exportPrivacy: "The file can contain sensitive personal and call information. Store it securely. Provider credentials, session tokens, raw device details, and internal staff identifiers are excluded.",
  exportAction: "Download JSON export",
  exportBusy: "Preparing export…",
  exportError: "The export could not be prepared. Please wait and try again.",
  credits: (count: number) => `${count} ${count === 1 ? "credit" : "credits"}`,
  sessionsTitle: "Session security",
  sessionsText: "Sign out this browser, or revoke every CallAssist session if a device is lost or your account may be exposed.",
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
  revokeDescription: "All CallAssist sessions, including this browser, will be revoked. You will need to sign in again.",
  actionError: "The session action could not be completed. Please try again.",
  deletionTitle: "Delete account and private data",
  deletionText: "This starts a durable deletion request. CallAssist first removes provider recordings and private call content, then anonymizes your identity and signs out every device.",
  deletionIrreversible: "This cannot be undone. Global recipient opt-outs and minimal immutable deletion evidence are retained for safety and accountability.",
  deletionExportFirst: "Download your data before starting if you want to keep a copy.",
  deletionPassword: "Current password",
  deletionConfirmation: "Type DELETE MY ACCOUNT",
  deletionConfirmationHint: "Enter the phrase exactly to enable deletion.",
  deletionAction: "Delete my account",
  deletionBusy: "Submitting deletion requestâ€¦",
  deletionError: "The deletion request could not be submitted. Check your password and confirmation, then try again.",
  deletionStatusTitle: "Deletion request status",
  deletionAttempt: (attempt: number, maximum: number) => `Attempt ${attempt} of ${maximum}`,
  deletionNextAttempt: "The worker will retry automatically.",
  deletionNeedsSupport: "Automatic retries are exhausted. Support can restart this request without restoring any already-deleted data.",
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
  intro: "Prüfen Sie die Identität Ihres Kontos, Ihr Anrufguthaben und den aktiven Anmeldezugriff.",
  loading: "Konto wird geladen…",
  loadError: "Ihr Konto konnte nicht geladen werden. Melden Sie sich erneut an oder versuchen Sie es nochmals.",
  retry: "Erneut versuchen",
  signIn: "Anmelden",
  identityTitle: "Identität",
  name: "Vor- und Nachname",
  email: "E-Mail",
  phone: "Bestätigtes Mobiltelefon",
  phoneChangeTitle: "Bestätigte Mobilnummer ändern",
  phoneChangeText: "Bestätigen Sie Ihr aktuelles Passwort und danach die neue Nummer per SMS.",
  phoneChangeSecurity: "Nach der Bestätigung werden andere Sitzungen abgemeldet und Wiederherstellungslinks für die alte Nummer ungültig.",
  phoneChangeCurrentPassword: "Aktuelles Passwort",
  phoneChangeNewPhone: "Neue Mobilnummer im internationalen Format",
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
  lastLogin: "Letzte Anmeldung",
  never: "Nicht erfasst",
  usageTitle: "Anrufguthaben",
  balance: "Aktueller Stand",
  activeCall: "Aktiver Anruf",
  noActiveCall: "Kein aktiver Anruf",
  transactions: "Letzte Kontobewegungen",
  noTransactions: "Noch keine Guthabenbewegungen.",
  exportTitle: "Ihre Daten herunterladen",
  exportText: "Erstellen Sie eine versionierte JSON-Datei mit den Kontodaten, die Ihnen derzeit in CallAssist zur Verfügung stehen.",
  exportIncludes: [
    "Profil und Zusammenfassungen aktiver Sitzungen",
    "Vollständiges Guthabenjournal und rechtliche Bestätigungen",
    "Ihre Anrufaufträge, erstellten Pläne, Einwilligungsmetadaten, Transkripte, Aufzeichnungsmetadaten, Ergebnisse und Rückmeldungen"
  ],
  exportPrivacy: "Die Datei kann sensible Personen- und Anrufdaten enthalten. Bewahren Sie sie sicher auf. Anbieter-Zugangsdaten, Sitzungstoken, rohe Gerätedaten und interne Mitarbeitenden-Kennungen sind ausgeschlossen.",
  exportAction: "JSON-Export herunterladen",
  exportBusy: "Export wird erstellt…",
  exportError: "Der Export konnte nicht erstellt werden. Bitte warten Sie und versuchen Sie es erneut.",
  credits: (count: number) => `${count} Anrufguthaben`,
  sessionsTitle: "Sitzungssicherheit",
  sessionsText: "Melden Sie diesen Browser ab oder widerrufen Sie alle CallAssist-Sitzungen, wenn ein Gerät verloren ging oder das Konto gefährdet sein könnte.",
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
  revokeDescription: "Alle CallAssist-Sitzungen, einschliesslich dieses Browsers, werden widerrufen. Danach ist eine neue Anmeldung erforderlich.",
  actionError: "Die Sitzungsaktion konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
  deletionTitle: "Konto und private Daten lÃ¶schen",
  deletionText: "Damit starten Sie einen dauerhaften LÃ¶schauftrag. CallAssist entfernt zuerst Aufzeichnungen beim Anbieter und private Anrufinhalte, anonymisiert danach Ihre IdentitÃ¤t und meldet alle GerÃ¤te ab.",
  deletionIrreversible: "Dies kann nicht rÃ¼ckgÃ¤ngig gemacht werden. Globale EmpfÃ¤nger-Sperren und minimale unverÃ¤nderliche LÃ¶schnachweise bleiben fÃ¼r Sicherheit und Rechenschaft erhalten.",
  deletionExportFirst: "Laden Sie Ihre Daten vorher herunter, wenn Sie eine Kopie behalten mÃ¶chten.",
  deletionPassword: "Aktuelles Passwort",
  deletionConfirmation: "DELETE MY ACCOUNT eingeben",
  deletionConfirmationHint: "Geben Sie die Formulierung exakt ein, um die LÃ¶schung freizuschalten.",
  deletionAction: "Mein Konto lÃ¶schen",
  deletionBusy: "LÃ¶schauftrag wird Ã¼bermitteltâ€¦",
  deletionError: "Der LÃ¶schauftrag konnte nicht Ã¼bermittelt werden. PrÃ¼fen Sie Passwort und BestÃ¤tigung und versuchen Sie es erneut.",
  deletionStatusTitle: "Status des LÃ¶schauftrags",
  deletionAttempt: (attempt: number, maximum: number) => `Versuch ${attempt} von ${maximum}`,
  deletionNextAttempt: "Der Worker versucht es automatisch erneut.",
  deletionNeedsSupport: "Die automatischen Versuche sind ausgeschÃ¶pft. Der Support kann den Auftrag neu starten, ohne bereits gelÃ¶schte Daten wiederherzustellen.",
  deletionStatuses: {
    queued: "Eingereiht",
    processing: "Daten werden gelÃ¶scht",
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
