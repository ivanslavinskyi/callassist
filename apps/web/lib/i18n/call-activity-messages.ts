import { answeringMessages } from "./answering-messages";
import { extendMessages } from "./extend-messages";
import type { UiLocale } from "./registry";
import type { CallActivityPhase } from "../call-activity";

type ActivityCopy = Record<CallActivityPhase, { label: string; title: (recipient: string) => string; help: string }>;
const legacyActivityMessages = extendMessages({
  en: {
    starting: { label: "Starting your call", title: (name: string) => `Connecting to ${name}`, help: "Your call request is being sent. We'll show you when dialing begins." },
    dialing: { label: "Dialing", title: (name: string) => `Calling ${name}`, help: "Waiting for an answer. The transcript will appear after the recipient agrees to the conversation." },
    connected: { label: "Call connected", title: () => "Phone connection established", help: "A phone connection does not confirm who answered. Recording starts only after consent." },
    approval: { label: "Your decision is needed", title: () => "The assistant is waiting for you", help: "Review the approval request to continue the conversation." },
    reconnecting: { label: "Updating call status", title: () => "Reconnecting to live updates", help: "The call may still be running. We're reconnecting to check its latest status." }
  },
  de: {
    starting: { label: "Anruf wird gestartet", title: (name: string) => `Verbindung zu ${name} wird aufgebaut`, help: "Ihre Anrufanfrage wird gesendet. Wir zeigen Ihnen, sobald der Wählvorgang beginnt." },
    dialing: { label: "Anruf läuft", title: (name: string) => `${name} wird angerufen`, help: "Wir warten auf eine Antwort. Das Transkript erscheint, sobald die angerufene Person dem Gespräch zustimmt." },
    connected: { label: "Verbindung hergestellt", title: () => "Telefonverbindung hergestellt", help: "Eine Telefonverbindung bestätigt nicht, wer geantwortet hat. Die Aufnahme beginnt erst nach der Zustimmung." },
    approval: { label: "Ihre Entscheidung ist gefragt", title: () => "Der Assistent wartet auf Sie", help: "Prüfen Sie die Freigabeanfrage, um das Gespräch fortzusetzen." },
    reconnecting: { label: "Anrufstatus wird aktualisiert", title: () => "Live-Verbindung wird wiederhergestellt", help: "Der Anruf läuft möglicherweise weiter. Wir stellen die Verbindung wieder her, um den aktuellen Status zu prüfen." }
  }
});

export const callActivityMessages = Object.fromEntries(Object.entries(legacyActivityMessages).map(([key, copy]) => {
  const messages = answeringMessages[key as UiLocale];
  return [key, { ...copy,
    checking: { label: messages.checking, title: () => messages.checking, help: messages.checkingHelp },
    consent: { label: messages.consent, title: () => messages.consent, help: messages.consentHelp },
    machine: { label: messages.results.automated_answer[0], title: () => messages.results.automated_answer[0], help: messages.uncertainty }
  }];
})) as unknown as Record<UiLocale, ActivityCopy>;
