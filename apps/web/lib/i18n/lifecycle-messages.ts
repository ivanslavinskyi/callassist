import { extendMessages } from "./extend-messages";
export const lifecycleMessages = extendMessages({
  "en": {
    "started": "Call started",
    "ringing": "Ringing",
    "connected": "Phone connection established",
    "disclosure": "Disclosure started",
    "consentGranted": "Consent received",
    "consentDeclined": "Consent declined",
    "consentMissing": "Consent not confirmed",
    "conversation": "Conversation phase started",
    "ended": "Call ended",
    "creditReserved": "1 credit reserved",
    "creditUsed": "1 credit used",
    "creditReturned": "Credit returned",
    "assessmentUnavailable": "Your credit was returned because the assessment could not be completed.",
    "lateAssessment": "The result was confirmed after your credit was returned. No credit will be deducted retroactively.",
    "details": "Call details",
    "endedBy": "Ended by",
    "stopRequestedBy": "Stop requested by",
    "connectionHelp": "A phone connection does not confirm that a person answered. Without explicit evidence, the party who hung up remains unknown.",
    "actors": {
      "user": "User",
      "assistant": "Assistant",
      "system": "System",
      "unknown": "Not confirmed"
    },
    "consent": {
      "granted": "Granted",
      "declined": "Declined",
      "not_received": "Not confirmed",
      "not_recorded": "Not recorded"
    }
  },
  "de": {
    "started": "Anruf gestartet",
    "ringing": "Klingeln",
    "connected": "Telefonverbindung hergestellt",
    "disclosure": "Hinweis begonnen",
    "consentGranted": "Einwilligung erhalten",
    "consentDeclined": "Einwilligung abgelehnt",
    "consentMissing": "Einwilligung nicht bestätigt",
    "conversation": "Gesprächsphase begonnen",
    "ended": "Anruf beendet",
    "creditReserved": "1 Credit reserviert",
    "creditUsed": "1 Credit verwendet",
    "creditReturned": "Credit zurückgegeben",
    "assessmentUnavailable": "Der Credit wurde zurückgegeben, weil die Prüfung nicht abgeschlossen werden konnte.",
    "lateAssessment": "Das Ergebnis wurde erst nach der Rückgabe des Credits bestätigt. Der Credit wird nicht nachträglich abgezogen.",
    "details": "Anrufdetails",
    "endedBy": "Beendet durch",
    "stopRequestedBy": "Stopp angefordert durch",
    "connectionHelp": "Eine Telefonverbindung bestätigt nicht, dass ein Mensch abgenommen hat. Ohne eindeutiges Ereignis bleibt offen, wer aufgelegt hat.",
    "actors": {
      "user": "Nutzer",
      "assistant": "Assistent",
      "system": "System",
      "unknown": "Nicht bestätigt"
    },
    "consent": {
      "granted": "Erteilt",
      "declined": "Abgelehnt",
      "not_received": "Nicht bestätigt",
      "not_recorded": "Nicht erfasst"
    }
  }
});
