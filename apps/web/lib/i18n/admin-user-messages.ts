import type {
  CreditTransactionType,
  UserRole,
  UserStatus
} from "@callassist/contracts";
import { ApiError } from "../api";
import type { UiLocale } from "./messages";

const en = {
  eyebrow: "User operations",
  title: "Users and credit ledger",
  intro: "Find an account by name or email and inspect its append-only credit history. Phone numbers and credentials are not exposed here.",
  loadingAccess: "Checking administrator access…",
  loadingUsers: "Loading users…",
  forbiddenTitle: "Administrator access required",
  forbidden: "Only active admin and superadmin accounts can search users and inspect credit history.",
  signIn: "Sign in",
  search: "Name or email",
  searchPlaceholder: "Search users",
  role: "Role",
  status: "Status",
  allRoles: "All visible roles",
  allStatuses: "All statuses",
  apply: "Apply filters",
  applying: "Loading…",
  resultCount: (count: number) => `${count} ${count === 1 ? "user" : "users"} loaded`,
  noUsers: "No users match these filters.",
  verified: "Phone verified",
  unverified: "Phone not verified",
  created: "Created",
  lastLogin: "Last login",
  never: "Never",
  viewLedger: "View credit ledger",
  loadMore: "Load more",
  loadingMore: "Loading…",
  loadingLedger: "Loading ledger…",
  selectTitle: "Select a user",
  selectHelp: "Choose a user to load their reconciled balance and immutable transaction history.",
  ledger: "Credit ledger",
  balance: "Current balance",
  activeCall: "Active call",
  noActiveCall: "No active call",
  phoneVerification: "Phone verification",
  transactionHistory: "Transaction history",
  actionsTitle: "Account actions",
  actionsHelp: "Every action is server-authorized and recorded with the operational reason.",
  selfActionsUnavailable: "You cannot perform administrative actions on your own account.",
  deletedActionsUnavailable: "Deleted accounts cannot be changed or credited.",
  suspendTitle: "Suspend account",
  suspendHelp: "Blocks sign-in immediately and revokes every existing session.",
  unsuspendTitle: "Restore account access",
  unsuspendHelp: "Allows a fresh sign-in. Previously revoked sessions stay revoked.",
  operationalReason: "Operational reason",
  statusReasonPlaceholder: "e.g. Abuse report reviewed in ticket 123",
  suspend: "Suspend account",
  unsuspend: "Restore access",
  suspending: "Suspending…",
  unsuspending: "Restoring…",
  logoutTitle: "Force logout",
  logoutHelp: "Revokes every current session without changing the account status.",
  logoutReasonPlaceholder: "e.g. Credential reset requested in ticket 123",
  forceLogout: "Revoke all sessions",
  loggingOut: "Revoking…",
  grantTitle: "Manual credit grant",
  grantHelp: "Adds an immutable, administrator-attributed ledger entry.",
  grantUnavailable: "Credits require an active account with a verified phone number.",
  credits: "Credits",
  grantReasonPlaceholder: "e.g. Customer recovery adjustment approved in ticket 123",
  grant: "Grant credits",
  granting: "Granting…",
  confirmSuspendTitle: "Suspend this account?",
  confirmUnsuspendTitle: "Restore this account?",
  confirmLogoutTitle: "Revoke every session?",
  confirmGrantTitle: "Confirm credit grant",
  statusConfirmDescription: (name: string, status: "active" | "suspended") => status === "suspended"
    ? `${name} will be signed out everywhere and blocked from signing in.`
    : `${name} will be allowed to sign in again with a new session.`,
  logoutConfirmDescription: (name: string) => `${name} will be signed out on every device.`,
  grantConfirmDescription: (credits: number, name: string) => `${credits} credits will be added to ${name}'s immutable ledger.`,
  statusSuccess: (name: string, statusLabel: string) => `${name} is now ${statusLabel}.`,
  logoutSuccess: (name: string) => `Every session for ${name} was revoked.`,
  grantSuccess: (credits: number, name: string) => `${credits} credits were granted to ${name}.`,
  noTransactions: "No credit transactions exist for this account.",
  reason: "Reason",
  source: "Source reference",
  adminActor: "Administrator",
  promoRedemption: "Promo redemption",
  callAttempt: "Call attempt",
  errors: {
    invalid: "Check the search filters and try again.",
    forbidden: "Your account is not allowed to inspect these users.",
    authentication: "Sign in with an administrator account.",
    notFound: "This user is unavailable or outside your permission scope.",
    invalidAction: "Enter an operational reason of at least three characters.",
    unchanged: "The account already has that status. Reload the user and try again.",
    invalidTransition: "This account status can no longer be changed.",
    selfAction: "You cannot perform this action on your own account.",
    invalidOrigin: "This request was blocked for security reasons. Reload the page and try again.",
    generic: "User data could not be loaded. Try again."
  },
  roles: {
    user: "User",
    admin: "Admin",
    superadmin: "Superadmin",
    content_editor: "Content editor",
    support: "Support"
  } satisfies Record<UserRole, string>,
  statuses: {
    active: "Active",
    suspended: "Suspended",
    deleted: "Deleted"
  } satisfies Record<UserStatus, string>,
  transactions: {
    signup_grant: "Signup grant",
    promo_grant: "Promo grant",
    admin_grant: "Admin grant",
    call_reservation: "Call reservation",
    call_charge: "Connected call charge",
    call_refund: "Call refund",
    adjustment: "Ledger adjustment"
  } satisfies Record<CreditTransactionType, string>
} as const;

type AdminUserMessages = {
  [Key in Exclude<
    keyof typeof en,
    | "resultCount"
    | "statusConfirmDescription"
    | "logoutConfirmDescription"
    | "grantConfirmDescription"
    | "statusSuccess"
    | "logoutSuccess"
    | "grantSuccess"
    | "errors"
    | "roles"
    | "statuses"
    | "transactions"
  >]: string;
} & {
  resultCount: (count: number) => string;
  statusConfirmDescription: (name: string, status: "active" | "suspended") => string;
  logoutConfirmDescription: (name: string) => string;
  grantConfirmDescription: (credits: number, name: string) => string;
  statusSuccess: (name: string, statusLabel: string) => string;
  logoutSuccess: (name: string) => string;
  grantSuccess: (credits: number, name: string) => string;
  errors: { [Key in keyof typeof en.errors]: string };
  roles: Record<UserRole, string>;
  statuses: Record<UserStatus, string>;
  transactions: Record<CreditTransactionType, string>;
};

const de: AdminUserMessages = {
  eyebrow: "Benutzerverwaltung",
  title: "Benutzer und Guthaben-Ledger",
  intro: "Suchen Sie ein Konto nach Name oder E-Mail und prüfen Sie den unveränderlichen Guthabenverlauf. Telefonnummern und Zugangsdaten werden hier nicht angezeigt.",
  loadingAccess: "Administratorzugriff wird geprüft…",
  loadingUsers: "Benutzer werden geladen…",
  forbiddenTitle: "Administratorzugriff erforderlich",
  forbidden: "Nur aktive Admin- und Superadmin-Konten können Benutzer suchen und den Guthabenverlauf prüfen.",
  signIn: "Anmelden",
  search: "Name oder E-Mail",
  searchPlaceholder: "Benutzer suchen",
  role: "Rolle",
  status: "Status",
  allRoles: "Alle sichtbaren Rollen",
  allStatuses: "Alle Status",
  apply: "Filter anwenden",
  applying: "Wird geladen…",
  resultCount: (count) => `${count} Benutzer geladen`,
  noUsers: "Für diese Filter wurden keine Benutzer gefunden.",
  verified: "Telefon bestätigt",
  unverified: "Telefon nicht bestätigt",
  created: "Erstellt",
  lastLogin: "Letzte Anmeldung",
  never: "Nie",
  viewLedger: "Guthaben-Ledger anzeigen",
  loadMore: "Mehr laden",
  loadingMore: "Wird geladen…",
  loadingLedger: "Ledger wird geladen…",
  selectTitle: "Benutzer auswählen",
  selectHelp: "Wählen Sie einen Benutzer, um den abgeglichenen Saldo und den unveränderlichen Transaktionsverlauf zu laden.",
  ledger: "Guthaben-Ledger",
  balance: "Aktueller Saldo",
  activeCall: "Aktiver Anruf",
  noActiveCall: "Kein aktiver Anruf",
  phoneVerification: "Telefonbestätigung",
  transactionHistory: "Transaktionsverlauf",
  actionsTitle: "Kontoaktionen",
  actionsHelp: "Jede Aktion wird serverseitig autorisiert und mit dem betrieblichen Grund protokolliert.",
  selfActionsUnavailable: "Sie können keine administrativen Aktionen am eigenen Konto ausführen.",
  deletedActionsUnavailable: "Gelöschte Konten können nicht geändert oder gutgeschrieben werden.",
  suspendTitle: "Konto sperren",
  suspendHelp: "Blockiert die Anmeldung sofort und widerruft alle bestehenden Sitzungen.",
  unsuspendTitle: "Kontozugriff wiederherstellen",
  unsuspendHelp: "Erlaubt eine neue Anmeldung. Zuvor widerrufene Sitzungen bleiben ungültig.",
  operationalReason: "Betrieblicher Grund",
  statusReasonPlaceholder: "z. B. Missbrauchsmeldung in Ticket 123 geprüft",
  suspend: "Konto sperren",
  unsuspend: "Zugriff wiederherstellen",
  suspending: "Wird gesperrt…",
  unsuspending: "Wird wiederhergestellt…",
  logoutTitle: "Abmeldung erzwingen",
  logoutHelp: "Widerruft alle aktuellen Sitzungen, ohne den Kontostatus zu ändern.",
  logoutReasonPlaceholder: "z. B. Zurücksetzen der Zugangsdaten in Ticket 123 angefordert",
  forceLogout: "Alle Sitzungen widerrufen",
  loggingOut: "Wird widerrufen…",
  grantTitle: "Manuelle Gutschrift",
  grantHelp: "Fügt einen unveränderlichen, dem Administrator zugeordneten Ledger-Eintrag hinzu.",
  grantUnavailable: "Gutschriften erfordern ein aktives Konto mit bestätigter Telefonnummer.",
  credits: "Guthaben",
  grantReasonPlaceholder: "z. B. Kulanzgutschrift gemäss Ticket 123 genehmigt",
  grant: "Guthaben gutschreiben",
  granting: "Wird gutgeschrieben…",
  confirmSuspendTitle: "Dieses Konto sperren?",
  confirmUnsuspendTitle: "Dieses Konto wiederherstellen?",
  confirmLogoutTitle: "Alle Sitzungen widerrufen?",
  confirmGrantTitle: "Gutschrift bestätigen",
  statusConfirmDescription: (name, status) => status === "suspended"
    ? `${name} wird auf allen Geräten abgemeldet und kann sich nicht mehr anmelden.`
    : `${name} kann sich wieder mit einer neuen Sitzung anmelden.`,
  logoutConfirmDescription: (name) => `${name} wird auf allen Geräten abgemeldet.`,
  grantConfirmDescription: (credits, name) => `${credits} Guthaben werden dem unveränderlichen Ledger von ${name} hinzugefügt.`,
  statusSuccess: (name, status) => `${name} hat jetzt den Status ${status}.`,
  logoutSuccess: (name) => `Alle Sitzungen von ${name} wurden widerrufen.`,
  grantSuccess: (credits, name) => `${credits} Guthaben wurden ${name} gutgeschrieben.`,
  noTransactions: "Für dieses Konto bestehen keine Guthabentransaktionen.",
  reason: "Grund",
  source: "Quellreferenz",
  adminActor: "Administrator",
  promoRedemption: "Aktionscode-Einlösung",
  callAttempt: "Anrufversuch",
  errors: {
    invalid: "Prüfen Sie die Suchfilter und versuchen Sie es erneut.",
    forbidden: "Ihr Konto darf diese Benutzer nicht einsehen.",
    authentication: "Melden Sie sich mit einem Administratorkonto an.",
    notFound: "Dieser Benutzer ist nicht verfügbar oder liegt ausserhalb Ihres Berechtigungsbereichs.",
    invalidAction: "Geben Sie einen betrieblichen Grund mit mindestens drei Zeichen ein.",
    unchanged: "Das Konto hat diesen Status bereits. Laden Sie den Benutzer neu und versuchen Sie es erneut.",
    invalidTransition: "Dieser Kontostatus kann nicht mehr geändert werden.",
    selfAction: "Sie können diese Aktion nicht am eigenen Konto ausführen.",
    invalidOrigin: "Diese Anfrage wurde aus Sicherheitsgründen blockiert. Laden Sie die Seite neu und versuchen Sie es erneut.",
    generic: "Die Benutzerdaten konnten nicht geladen werden. Versuchen Sie es erneut."
  },
  roles: {
    user: "Benutzer",
    admin: "Admin",
    superadmin: "Superadmin",
    content_editor: "Content-Redaktion",
    support: "Support"
  },
  statuses: {
    active: "Aktiv",
    suspended: "Gesperrt",
    deleted: "Gelöscht"
  },
  transactions: {
    signup_grant: "Startguthaben",
    promo_grant: "Aktionsgutschrift",
    admin_grant: "Admin-Gutschrift",
    call_reservation: "Anrufreservierung",
    call_charge: "Verbundener Anruf",
    call_refund: "Anruferstattung",
    adjustment: "Ledger-Korrektur"
  }
};

export const adminUserMessages: Record<UiLocale, AdminUserMessages> = { en, de };

export function getAdminUserErrorMessage(error: unknown, locale: UiLocale) {
  const copy = adminUserMessages[locale].errors;
  if (!(error instanceof ApiError)) return copy.generic;
  switch (error.code) {
    case "INVALID_ADMIN_USER_QUERY": return copy.invalid;
    case "INVALID_ACCOUNT_STATUS_ACTION":
    case "INVALID_SESSION_REVOCATION_ACTION": return copy.invalidAction;
    case "ADMIN_ACTION_FORBIDDEN": return copy.forbidden;
    case "SELF_ADMIN_ACTION_FORBIDDEN": return copy.selfAction;
    case "AUTHENTICATION_REQUIRED": return copy.authentication;
    case "USER_NOT_FOUND": return copy.notFound;
    case "ACCOUNT_STATUS_UNCHANGED": return copy.unchanged;
    case "ACCOUNT_STATUS_TRANSITION_INVALID": return copy.invalidTransition;
    case "INVALID_ORIGIN": return copy.invalidOrigin;
    default: return copy.generic;
  }
}
