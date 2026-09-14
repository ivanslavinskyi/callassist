import type { UiLocale } from "./messages";
const en = {
  title: "Confirm your email", intro: "Confirm the address used to sign in before making your first call.",
  address: "Email address", send: "Send confirmation code", sending: "Sending…",
  code: "Email confirmation code", hint: "Enter the six-digit code. Only the latest code works, for 10 minutes.",
  sent: "Check your inbox and spam folder.", verify: "Confirm email", verifying: "Confirming…",
  resend: "Send a new code", wait: "You can request another code in {seconds} seconds.",
  expiry: "Code expires: {time}", expired: "This code has expired. Request a new one.",
  change: "Wrong address? Correct it", cancel: "Keep the current address",
  password: "Current password", changeHelp: "Confirm your password to correct the address. It changes only after the new address is verified.",
  success: "Email confirmed", continue: "Continue", account: "Account settings",
  error: "The request could not be completed. Check your connection and try again. If you already entered a code, reload this page to check your confirmation status.",
  invalid: "The code is incorrect, expired or has been replaced. Check the latest email or request a new code.",
  credentials: "The current password is incorrect.", unavailable: "This address cannot be used. Check it and try again.",
  limited: "Too many requests. Please wait before trying again.", session: "Your session has ended. Sign in again.",
  banner: "Confirm your email before starting a call.", verified: "Email verified", unverified: "Email not yet verified"
};
export type EmailVerificationCopy = typeof en;
export const emailVerificationMessages: Record<UiLocale, EmailVerificationCopy> = {
  en,
  de: {
    title: "E-Mail bestätigen", intro: "Bestätigen Sie vor Ihrem ersten Anruf die Adresse, mit der Sie sich anmelden.",
    address: "E-Mail-Adresse", send: "Bestätigungscode senden", sending: "Wird gesendet…",
    code: "E-Mail-Bestätigungscode", hint: "Geben Sie den sechsstelligen Code ein. Nur der neueste Code ist gültig, für 10 Minuten.",
    sent: "Prüfen Sie Ihren Posteingang und Spam-Ordner.", verify: "E-Mail bestätigen", verifying: "Wird bestätigt…",
    resend: "Neuen Code senden", wait: "Sie können in {seconds} Sekunden einen neuen Code anfordern.",
    expiry: "Code gültig bis: {time}", expired: "Dieser Code ist abgelaufen. Fordern Sie einen neuen an.",
    change: "Falsche Adresse? Korrigieren", cancel: "Aktuelle Adresse behalten",
    password: "Aktuelles Passwort", changeHelp: "Bestätigen Sie Ihr Passwort, um die Adresse zu korrigieren. Sie ändert sich erst nach Bestätigung der neuen Adresse.",
    success: "E-Mail bestätigt", continue: "Weiter", account: "Kontoeinstellungen",
    error: "Die Anfrage konnte nicht abgeschlossen werden. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut. Falls Sie bereits einen Code eingegeben haben, laden Sie diese Seite neu, um den Bestätigungsstatus zu prüfen.",
    invalid: "Der Code ist falsch, abgelaufen oder wurde ersetzt. Prüfen Sie die neueste E-Mail oder fordern Sie einen neuen Code an.",
    credentials: "Das aktuelle Passwort ist falsch.", unavailable: "Diese Adresse kann nicht verwendet werden. Prüfen Sie sie und versuchen Sie es erneut.",
    limited: "Zu viele Anfragen. Bitte warten Sie, bevor Sie es erneut versuchen.", session: "Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.",
    banner: "Bestätigen Sie Ihre E-Mail, bevor Sie einen Anruf starten.", verified: "E-Mail bestätigt", unverified: "E-Mail noch nicht bestätigt"
  }
};
