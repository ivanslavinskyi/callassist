import { extendMessages } from "./extend-messages";

export const registrationCallMessages = extendMessages({
  en: {
    switzerland: "Switzerland", ukraine: "Ukraine",
    later: "Confirm later", optionalEmail: "Confirm your email now, or continue and confirm it later in account settings.",
    emailReminder: "Your email is not confirmed yet. You can confirm it in account settings.",
    agreement: "I accept the Terms of Use and Acceptable Use Policy and acknowledge the Privacy Notice.",
    terms: "Terms of Use", acceptableUse: "Acceptable Use Policy", privacy: "Privacy Notice",
    optionsError: "Registration options could not be loaded. Please try again.", reload: "Try again",
    legalChanged: "The documents or registration settings changed. Review the current documents and try again.",
    phone: "Phone number", country: "Phone country", phonePreview: "Number to verify", invalidPhone: "Enter a valid phone number for the selected country, or include its international country code.",
    policyTitle: "Registration and verification", onboarding: "Onboarding", full: "Full onboarding", simplified: "Agreement at registration",
    emailPolicy: "Email verification", required: "Required before calls", deferrable: "Can be deferred",
    reason: "Reason for change", savePolicy: "Save registration settings", savedPolicy: "Registration settings saved.",
    policyError: "The settings could not be saved. Refresh and check the current settings before trying again.",
    retryCall: "Repeat call", retryBusy: "Preparing another call…", retryError: "This call cannot be repeated yet. Refresh to check its latest status.",
    appointmentExpired: "The appointment dates in this plan have expired. Edit the plan before calling.",
    retryHelp: "Review the saved plan before calling again. Changes to the task may require preparing a new plan.",
    objective: "Call objective", editFeedback: "Edit feedback", cancel: "Cancel", feedbackSent: "Your feedback has been sent.",
    saveChanges: "Save changes", feedbackLoadingError: "Your feedback could not be loaded. Try again before editing it."
  },
  de: {
    switzerland: "Schweiz", ukraine: "Ukraine",
    later: "Später bestätigen", optionalEmail: "Bestätigen Sie Ihre E-Mail jetzt oder fahren Sie fort und bestätigen Sie sie später in den Kontoeinstellungen.",
    emailReminder: "Ihre E-Mail ist noch nicht bestätigt. Sie können sie in den Kontoeinstellungen bestätigen.",
    agreement: "Ich akzeptiere die Nutzungsbedingungen und die Regeln zur akzeptablen Nutzung und nehme die Datenschutzhinweise zur Kenntnis.",
    terms: "Nutzungsbedingungen", acceptableUse: "Regeln zur akzeptablen Nutzung", privacy: "Datenschutzhinweise",
    optionsError: "Die Registrierungsoptionen konnten nicht geladen werden. Bitte versuchen Sie es erneut.", reload: "Erneut versuchen",
    legalChanged: "Die Dokumente oder Registrierungseinstellungen wurden geändert. Prüfen Sie die aktuellen Dokumente und versuchen Sie es erneut.",
    phone: "Telefonnummer", country: "Land der Telefonnummer", phonePreview: "Zu bestätigende Nummer", invalidPhone: "Geben Sie eine gültige Telefonnummer für das ausgewählte Land oder mit internationaler Vorwahl ein.",
    policyTitle: "Registrierung und Bestätigung", onboarding: "Einführung", full: "Vollständige Einführung", simplified: "Zustimmung bei der Registrierung",
    emailPolicy: "E-Mail-Bestätigung", required: "Vor Anrufen erforderlich", deferrable: "Kann aufgeschoben werden",
    reason: "Grund für die Änderung", savePolicy: "Registrierungseinstellungen speichern", savedPolicy: "Registrierungseinstellungen gespeichert.",
    policyError: "Die Einstellungen konnten nicht gespeichert werden. Aktualisieren und prüfen Sie die aktuellen Einstellungen, bevor Sie es erneut versuchen.",
    retryCall: "Erneut anrufen", retryBusy: "Weiterer Anruf wird vorbereitet…", retryError: "Dieser Anruf kann noch nicht wiederholt werden. Aktualisieren Sie den Status.",
    appointmentExpired: "Die Termine in diesem Plan liegen in der Vergangenheit. Bearbeiten Sie den Plan vor dem Anruf.",
    retryHelp: "Prüfen Sie den gespeicherten Plan vor dem erneuten Anruf. Änderungen an der Aufgabe können eine neue Planvorbereitung erfordern.",
    objective: "Anrufziel", editFeedback: "Feedback bearbeiten", cancel: "Abbrechen", feedbackSent: "Ihr Feedback wurde gesendet.",
    saveChanges: "Änderungen speichern", feedbackLoadingError: "Ihr Feedback konnte nicht geladen werden. Versuchen Sie es vor der Bearbeitung erneut."
  }
});
