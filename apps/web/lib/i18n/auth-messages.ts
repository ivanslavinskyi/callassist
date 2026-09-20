import { extendMessages } from "./extend-messages";
import { ApiError } from "@/lib/api";
import type { UiLocale } from "./messages";
import { betaErrorMessage } from "./beta-messages";

const en = {
  register: {
    title: "Create your SHPROHLI account",
    intro: "Use your real first and last name. The assistant will use them when it represents you on a call.",
    firstName: "First name",
    firstNamePlaceholder: "e.g. Nina",
    lastName: "Last name",
    lastNamePlaceholder: "e.g. Keller",
    email: "Email address",
    phone: "Mobile phone",
    phonePlaceholder: "+41791234567",
    phoneHelp: "Swiss (+41) or Ukrainian (+380) mobile number. Spaces are accepted. We will send an SMS verification code.",
    password: "Password",
    passwordHelp: "Use at least 12 characters.",
    submit: "Create account",
    submitting: "Creating account…",
    existing: "Already have an account?",
    signIn: "Sign in"
  },
  verify: {
    title: "Verify your mobile phone",
    intro: "Enter the code sent to your phone. Verification signs you in automatically.",
    email: "Email address",
    code: "SMS verification code",
    codePlaceholder: "000000",
    submit: "Verify and continue",
    submitting: "Verifying…",
    resend: "Send a new code",
    resending: "Sending…",
    resent: "If the account can receive a code, a new SMS has been sent.",
    wait: "You can request another SMS in {seconds} seconds.",
    expiry: "The code is valid for 10 minutes. An expired code can be requested again.",
    correctPhone: "Wrong phone number? Correct it",
    correctionHelp: "Use the email and password you registered with. Enter a Swiss (+41) or Ukrainian (+380) mobile number, then verify it by SMS.",
    newPhone: "Correct mobile number",
    password: "Registration password",
    cancelCorrection: "Back to the SMS code",
    back: "Back to registration"
  },
  login: {
    title: "Welcome back",
    intro: "Sign in to prepare and supervise your calls.",
    email: "Email address",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    newAccount: "New to SHPROHLI?",
    register: "Create an account",
    verify: "Verify your phone",
    forgot: "Forgot your password?"
  },
  recovery: {
    title: "Restore account access",
    intro: "Enter your account email. We will continue without revealing whether an account exists.",
    email: "Email address",
    start: "Send verification code",
    starting: "Preparing recovery…",
    codeTitle: "Check your mobile phone",
    codeIntro: "If an active, verified account exists for that email, we sent an SMS code.",
    code: "SMS verification code",
    codePlaceholder: "000000",
    verify: "Verify code",
    verifying: "Verifying…",
    resetTitle: "Choose a new password",
    resetIntro: "Your recovery approval expires after 15 minutes and can be used only once.",
    password: "New password",
    passwordHelp: "Use at least 12 characters.",
    confirmPassword: "Confirm new password",
    complete: "Change password",
    completing: "Changing password…",
    successTitle: "Password changed",
    successIntro: "All existing sessions were signed out. Sign in again with your new password.",
    signIn: "Go to sign in",
    restart: "Start again",
    back: "Back to sign in"
  },
  errors: {
    phoneCorrection: "Check your account details and phone number. This is only available before phone verification; otherwise sign in to change your number.",
    smsDestination: "This phone number is not supported for SMS verification in the current beta. Use a supported mobile number or contact support.",
    generic: "Something went wrong. Please try again.",
    invalidRegistration: "Check all fields. First name and last name are both required, and the password must have at least 12 characters.",
    invalidCredentials: "The email address or password is incorrect.",
    verificationRequired: "Verify your mobile phone before signing in.",
    invalidVerification: "The verification code is incorrect or expired.",
    verificationUnavailable: "SMS verification is temporarily unavailable. Please try again shortly.",
    suspended: "This account is suspended. Contact support for help.",
    rateLimited: "Too many attempts. Please wait before trying again.",
    invalidOrigin: "This request was blocked for security reasons. Reload the page and try again.",
    invalidRecovery: "This recovery attempt is invalid or expired. Start again to request a new code.",
    passwordMismatch: "The passwords do not match."
  }
} as const;

type AuthMessages = {
  register: { [Key in keyof typeof en.register]: string };
  verify: { [Key in keyof typeof en.verify]: string };
  login: { [Key in keyof typeof en.login]: string };
  recovery: { [Key in keyof typeof en.recovery]: string };
  errors: { [Key in keyof typeof en.errors]: string };
};

const de: AuthMessages = {
  register: {
    title: "SHPROHLI-Konto erstellen",
    intro: "Verwenden Sie Ihren echten Vor- und Nachnamen. Der Assistent nutzt beide, wenn er Sie bei einem Anruf vertritt.",
    firstName: "Vorname",
    firstNamePlaceholder: "z. B. Nina",
    lastName: "Nachname",
    lastNamePlaceholder: "z. B. Keller",
    email: "E-Mail-Adresse",
    phone: "Mobiltelefon",
    phonePlaceholder: "+41791234567",
    phoneHelp: "Schweizer (+41) oder ukrainische (+380) Mobilnummer. Leerzeichen sind erlaubt. Wir senden einen SMS-Bestätigungscode.",
    password: "Passwort",
    passwordHelp: "Mindestens 12 Zeichen verwenden.",
    submit: "Konto erstellen",
    submitting: "Konto wird erstellt…",
    existing: "Sie haben bereits ein Konto?",
    signIn: "Anmelden"
  },
  verify: {
    title: "Mobiltelefon bestätigen",
    intro: "Geben Sie den Code aus der SMS ein. Nach der Bestätigung werden Sie automatisch angemeldet.",
    email: "E-Mail-Adresse",
    code: "SMS-Bestätigungscode",
    codePlaceholder: "000000",
    submit: "Bestätigen und weiter",
    submitting: "Wird bestätigt…",
    resend: "Neuen Code senden",
    resending: "Wird gesendet…",
    resent: "Falls das Konto einen Code empfangen kann, wurde eine neue SMS gesendet.",
    wait: "In {seconds} Sekunden können Sie erneut eine SMS anfordern.",
    expiry: "Der Code ist 10 Minuten gültig. Nach Ablauf können Sie ihn erneut anfordern.",
    correctPhone: "Falsche Telefonnummer? Korrigieren",
    correctionHelp: "Verwenden Sie E-Mail und Passwort Ihrer Registrierung. Geben Sie eine Schweizer (+41) oder ukrainische (+380) Mobilnummer ein und bestätigen Sie sie per SMS.",
    newPhone: "Korrekte Mobilnummer",
    password: "Passwort der Registrierung",
    cancelCorrection: "Zurück zum SMS-Code",
    back: "Zurück zur Registrierung"
  },
  login: {
    title: "Willkommen zurück",
    intro: "Melden Sie sich an, um Ihre Anrufe vorzubereiten und zu begleiten.",
    email: "E-Mail-Adresse",
    password: "Passwort",
    submit: "Anmelden",
    submitting: "Anmeldung läuft…",
    newAccount: "Neu bei SHPROHLI?",
    register: "Konto erstellen",
    verify: "Telefon bestätigen",
    forgot: "Passwort vergessen?"
  },
  recovery: {
    title: "Kontozugriff wiederherstellen",
    intro: "Geben Sie die E-Mail-Adresse Ihres Kontos ein. Wir fahren fort, ohne offenzulegen, ob ein Konto existiert.",
    email: "E-Mail-Adresse",
    start: "Bestätigungscode senden",
    starting: "Wiederherstellung wird vorbereitet…",
    codeTitle: "Mobiltelefon prüfen",
    codeIntro: "Falls für diese E-Mail-Adresse ein aktives, bestätigtes Konto existiert, haben wir einen SMS-Code gesendet.",
    code: "SMS-Bestätigungscode",
    codePlaceholder: "000000",
    verify: "Code bestätigen",
    verifying: "Wird bestätigt…",
    resetTitle: "Neues Passwort festlegen",
    resetIntro: "Die Freigabe zur Wiederherstellung ist 15 Minuten gültig und kann nur einmal verwendet werden.",
    password: "Neues Passwort",
    passwordHelp: "Mindestens 12 Zeichen verwenden.",
    confirmPassword: "Neues Passwort bestätigen",
    complete: "Passwort ändern",
    completing: "Passwort wird geändert…",
    successTitle: "Passwort geändert",
    successIntro: "Alle bestehenden Sitzungen wurden abgemeldet. Melden Sie sich mit dem neuen Passwort erneut an.",
    signIn: "Zur Anmeldung",
    restart: "Neu beginnen",
    back: "Zurück zur Anmeldung"
  },
  errors: {
    phoneCorrection: "Prüfen Sie Ihre Kontodaten und Telefonnummer. Dies ist nur vor der Telefonbestätigung möglich; melden Sie sich sonst an, um die Nummer zu ändern.",
    smsDestination: "Diese Telefonnummer wird in der aktuellen Beta nicht für die SMS-Bestätigung unterstützt. Verwenden Sie eine unterstützte Mobilnummer oder kontaktieren Sie den Support.",
    generic: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
    invalidRegistration: "Prüfen Sie alle Felder. Vorname und Nachname sind erforderlich, das Passwort muss mindestens 12 Zeichen haben.",
    invalidCredentials: "E-Mail-Adresse oder Passwort ist falsch.",
    verificationRequired: "Bestätigen Sie Ihr Mobiltelefon, bevor Sie sich anmelden.",
    invalidVerification: "Der Bestätigungscode ist falsch oder abgelaufen.",
    verificationUnavailable: "Die SMS-Bestätigung ist vorübergehend nicht verfügbar. Bitte versuchen Sie es gleich noch einmal.",
    suspended: "Dieses Konto ist gesperrt. Wenden Sie sich an den Support.",
    rateLimited: "Zu viele Versuche. Bitte warten Sie, bevor Sie es erneut versuchen.",
    invalidOrigin: "Diese Anfrage wurde aus Sicherheitsgründen blockiert. Laden Sie die Seite neu und versuchen Sie es erneut.",
    invalidRecovery: "Dieser Wiederherstellungsversuch ist ungültig oder abgelaufen. Fordern Sie einen neuen Code an.",
    passwordMismatch: "Die Passwörter stimmen nicht überein."
  }
};

export const authMessages: Record<UiLocale, AuthMessages> = extendMessages({ en, de });

export function getAuthErrorMessage(error: unknown, locale: UiLocale) {
  const beta = betaErrorMessage(error, locale);
  if (beta) return beta;
  const copy = authMessages[locale].errors;
  if (!(error instanceof ApiError)) return copy.generic;
  switch (error.code) {
    case "PHONE_CORRECTION_NOT_AVAILABLE":
      return copy.phoneCorrection;
    case "SMS_DESTINATION_NOT_ALLOWED":
      return copy.smsDestination;
    case "INVALID_REGISTRATION":
      return copy.invalidRegistration;
    case "INVALID_LOGIN":
    case "INVALID_CREDENTIALS":
      return copy.invalidCredentials;
    case "PHONE_VERIFICATION_REQUIRED":
      return copy.verificationRequired;
    case "INVALID_VERIFICATION":
    case "INVALID_VERIFICATION_REQUEST":
      return copy.invalidVerification;
    case "INVALID_RECOVERY":
    case "INVALID_RECOVERY_START":
    case "INVALID_RECOVERY_VERIFICATION":
    case "INVALID_RECOVERY_COMPLETION":
      return copy.invalidRecovery;
    case "VERIFICATION_UNAVAILABLE":
      return copy.verificationUnavailable;
    case "ACCOUNT_SUSPENDED":
      return copy.suspended;
    case "RATE_LIMITED":
      return copy.rateLimited;
    case "INVALID_ORIGIN":
      return copy.invalidOrigin;
    default:
      return copy.generic;
  }
}
