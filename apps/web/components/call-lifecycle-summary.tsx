import type { CallLifecycle } from "@callassist/contracts";
import { callResultCopy, callResultLabel } from "@/lib/call-status";
import { callPresentationCopy } from "@/lib/i18n/call-presentation";

export function CallLifecycleSummary({ lifecycle, locale }: { lifecycle?: CallLifecycle; locale: "en" | "de" }) {
  if (!lifecycle?.result) return null;
  const de = locale === "de";
  const label = callResultLabel({ status: "completed", lifecycle }, locale)!;
  const help = callResultCopy[locale][lifecycle.result][1];
  const stages = [
    [de ? "Anruf gestartet" : "Call started", lifecycle.attemptedAt],
    [de ? "Klingeln" : "Ringing", lifecycle.ringingAt],
    [de ? "Telefonverbindung hergestellt" : "Phone connection established", lifecycle.connectedAt],
    [de ? "Hinweis begonnen" : "Disclosure started", lifecycle.disclosureAt],
    [lifecycle.consent === "granted" ? (de ? "Einwilligung erhalten" : "Consent received") : lifecycle.consent === "declined" ? (de ? "Einwilligung abgelehnt" : "Consent declined") : (de ? "Einwilligung nicht bestätigt" : "Consent not confirmed"), lifecycle.consentAt],
    [de ? "Gesprächsphase begonnen" : "Conversation phase started", lifecycle.conversationStartedAt],
    [de ? "Anruf beendet" : "Call ended", lifecycle.endedAt]
  ] as const;
  const credit = { not_recorded: "", reserved: de ? "1 Credit reserviert" : "1 credit reserved", used: de ? "1 Credit verwendet" : "1 credit used", returned: de ? "Credit zurückgegeben" : "Credit returned" }[lifecycle.credit];
  const actors = de ? { user: "Nutzer", assistant: "Assistent", system: "System", unknown: "Nicht bestätigt" } : { user: "User", assistant: "Assistant", system: "System", unknown: "Not confirmed" };
  return <section className={`call-lifecycle-summary result-${lifecycle.result}`} aria-label={label}>
    <div className="lifecycle-heading"><h2>{callPresentationCopy[locale].result}: {label}</h2>{credit ? <span className="lifecycle-credit">{credit}</span> : null}</div>
    <p>{help}</p>
    {lifecycle.assessment?.status === "unavailable" && lifecycle.credit === "returned" ? <p>{de ? "Der Credit wurde zurückgegeben, weil die Prüfung nicht abgeschlossen werden konnte." : "Your credit was returned because the assessment could not be completed."}</p> : null}
    {lifecycle.substantiveAnswerConfirmed && lifecycle.credit === "returned" ? <p>{de ? "Das Ergebnis wurde erst nach der Rückgabe des Credits bestätigt. Der Credit wird nicht nachträglich abgezogen." : "The result was confirmed after your credit was returned. No credit will be deducted retroactively."}</p> : null}
    <details><summary>{de ? "Anrufdetails" : "Call details"}</summary>
      <ol className="lifecycle-timeline">{stages.filter(([, at]) => at).map(([title, at]) => <li key={title}><span>{title}</span><time dateTime={at!}>{new Intl.DateTimeFormat(de ? "de-CH" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(at!))}</time></li>)}</ol>
      <p>{de ? "Beendet durch" : "Ended by"}: {actors[lifecycle.endedBy]}</p>
      {lifecycle.stopRequestedBy ? <p>{de ? "Stopp angefordert durch" : "Stop requested by"}: {actors[lifecycle.stopRequestedBy]}</p> : null}
      <p className="muted-text">{de ? "Eine Telefonverbindung bestätigt nicht, dass ein Mensch abgenommen hat. Ohne eindeutiges Ereignis bleibt offen, wer aufgelegt hat." : "A phone connection does not confirm that a person answered. Without explicit evidence, the party who hung up remains unknown."}</p>
    </details>
  </section>;
}
