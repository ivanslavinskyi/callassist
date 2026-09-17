import { callPresentation, callStage, type CallBrief, type CallResult } from "@callassist/contracts";
import { callPresentationCopy } from "./i18n/call-presentation";
export const terminalCallStatuses = new Set<CallBrief["status"]>(["completed", "stopped", "failed"]);
export function isTerminalCallStatus(status: CallBrief["status"]) { return terminalCallStatuses.has(status); }

export const callResultCopy = {
  en: {
    assessment_pending: ["Checking the result", "We are checking the final transcript against your task. Your credit remains reserved."],
    assessment_unavailable: ["Result could not be verified", "We could not reliably confirm a substantive answer from the final transcript."],
    conversation_completed: ["Conversation took place", "The recipient agreed and gave a substantive answer. This does not by itself mean the task was resolved."],
    no_answer: ["No answer", "The phone provider confirmed that the call was not answered."],
    busy: ["Line busy", "The phone provider reported a busy line."],
    canceled: ["Canceled before connection", "The call was canceled before a connection was established."],
    consent_declined: ["Conversation declined", "The recipient explicitly declined to continue."],
    consent_not_received: ["Ended before consent", "A phone connection was established, but consent was not confirmed. A connection may also be answered by voicemail or an automated system."],
    no_substantive_answer: ["No confirmed task answer", "Consent was received, but no substantive answer to the task was confirmed."],
    technical_failure: ["Technical problem", "The attempt could not be completed normally. See the available call details."],
    stopped: ["Call stopped", "The application stopped the call before a substantive answer was confirmed."],
    ended: ["Call ended", "The available events do not establish whether a conversation took place."]
  },
  de: {
    assessment_pending: ["Ergebnis wird geprüft", "Wir prüfen das endgültige Transkript anhand Ihrer Aufgabe. Ihr Credit bleibt reserviert."],
    assessment_unavailable: ["Ergebnis nicht verifizierbar", "Eine inhaltliche Antwort konnte anhand des endgültigen Transkripts nicht zuverlässig bestätigt werden."],
    conversation_completed: ["Gespräch stattgefunden", "Die angerufene Person hat zugestimmt und inhaltlich geantwortet. Das bedeutet nicht automatisch, dass die Aufgabe gelöst wurde."],
    no_answer: ["Nicht abgenommen", "Der Telefonanbieter bestätigt, dass der Anruf nicht angenommen wurde."],
    busy: ["Besetzt", "Der Telefonanbieter meldet eine besetzte Leitung."],
    canceled: ["Vor Verbindung abgebrochen", "Der Anruf wurde vor dem Verbindungsaufbau abgebrochen."],
    consent_declined: ["Gespräch abgelehnt", "Die angerufene Person hat das Gespräch ausdrücklich abgelehnt."],
    consent_not_received: ["Vor Einwilligung beendet", "Eine Telefonverbindung wurde hergestellt, aber keine Einwilligung bestätigt. Auch eine Mailbox oder ein automatisches System kann den Anruf annehmen."],
    no_substantive_answer: ["Keine bestätigte Antwort", "Die Einwilligung liegt vor, aber es wurde keine inhaltliche Antwort zur Aufgabe bestätigt."],
    technical_failure: ["Technisches Problem", "Der Anrufversuch konnte nicht regulär beendet werden. Weitere Informationen stehen in den Anrufdetails."],
    stopped: ["Anruf gestoppt", "Die Anwendung hat den Anruf gestoppt, bevor eine inhaltliche Antwort bestätigt wurde."],
    ended: ["Anruf beendet", "Die vorhandenen Ereignisse belegen nicht, ob ein Gespräch stattgefunden hat."]
  }
} satisfies Record<"en" | "de", Record<CallResult, readonly [string, string]>>;

type StatusBrief = Pick<CallBrief, "status" | "lifecycle">;
export function callStatusLabel(brief: StatusBrief, locale: "en" | "de") {
  return callPresentationCopy[locale].stages[callStage(brief.status)];
}
export function callStatusClass(brief: StatusBrief) {
  return `status-${callStage(brief.status)}`;
}
export function callResultLabel(brief: StatusBrief, locale: "en" | "de") {
  const result = callPresentation(brief).result;
  return result === null ? null : result === "unknown" ? callPresentationCopy[locale].unknown : callResultCopy[locale][result][0];
}
export function callConsentLabel(lifecycle: CallBrief["lifecycle"], locale: "en" | "de", fallback: string) {
  if (!lifecycle) return fallback;
  const labels = locale === "de"
    ? { granted: "Erteilt", declined: "Abgelehnt", not_received: "Nicht bestätigt", not_recorded: "Nicht erfasst" }
    : { granted: "Granted", declined: "Declined", not_received: "Not confirmed", not_recorded: "Not recorded" };
  return labels[lifecycle.consent];
}
