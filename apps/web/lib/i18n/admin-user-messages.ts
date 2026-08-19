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
    "resultCount" | "errors" | "roles" | "statuses" | "transactions"
  >]: string;
} & {
  resultCount: (count: number) => string;
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
    case "ADMIN_ACTION_FORBIDDEN": return copy.forbidden;
    case "AUTHENTICATION_REQUIRED": return copy.authentication;
    case "USER_NOT_FOUND": return copy.notFound;
    default: return copy.generic;
  }
}
