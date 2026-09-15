import type { UiLocale } from "./registry";
import type { CallActivityPhase } from "../call-activity";

type ActivityCopy = Record<CallActivityPhase, { label: string; title: (recipient: string) => string; help: string }>;
export const callActivityMessages: Record<UiLocale, ActivityCopy> = {
  en: {
    starting: { label: "Starting your call", title: (name) => `Connecting to ${name}`, help: "Your call request is being sent. We'll show you when dialing begins." },
    dialing: { label: "Dialing", title: (name) => `Calling ${name}`, help: "Waiting for an answer. The transcript will appear after the recipient agrees to the conversation." },
    connected: { label: "Call connected", title: (name) => `Connected to ${name}`, help: "The transcript will appear here after the recipient agrees to the conversation." },
    approval: { label: "Your decision is needed", title: () => "The assistant is waiting for you", help: "Review the approval request to continue the conversation." },
    reconnecting: { label: "Updating call status", title: () => "Reconnecting to live updates", help: "The call may still be running. We're reconnecting to check its latest status." }
  },
  de: {
    starting: { label: "Anruf wird gestartet", title: (name) => `Verbindung zu ${name} wird aufgebaut`, help: "Ihre Anrufanfrage wird gesendet. Wir zeigen Ihnen, sobald der Wählvorgang beginnt." },
    dialing: { label: "Anruf läuft", title: (name) => `${name} wird angerufen`, help: "Wir warten auf eine Antwort. Das Transkript erscheint, sobald die angerufene Person dem Gespräch zustimmt." },
    connected: { label: "Verbindung hergestellt", title: (name) => `Mit ${name} verbunden`, help: "Das Transkript erscheint hier, sobald die angerufene Person dem Gespräch zustimmt." },
    approval: { label: "Ihre Entscheidung ist gefragt", title: () => "Der Assistent wartet auf Sie", help: "Prüfen Sie die Freigabeanfrage, um das Gespräch fortzusetzen." },
    reconnecting: { label: "Anrufstatus wird aktualisiert", title: () => "Live-Verbindung wird wiederhergestellt", help: "Der Anruf läuft möglicherweise weiter. Wir stellen die Verbindung wieder her, um den aktuellen Status zu prüfen." }
  }
};
