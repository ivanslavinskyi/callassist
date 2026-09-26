import { answeringMessages } from "@/lib/i18n/answering-messages";
import { formatLocale } from "@callassist/contracts";
import { lifecycleMessages } from "@/lib/i18n/lifecycle-messages";
import type { UiLocale } from "@callassist/contracts";
import type { CallLifecycle } from "@callassist/contracts";
import { callResultCopy, callResultLabel } from "@/lib/call-status";
import { callPresentationCopy } from "@/lib/i18n/call-presentation";

export function CallLifecycleSummary({ lifecycle, locale, message }: { lifecycle?: CallLifecycle; locale: UiLocale; message?: string | null }) {
  if (!lifecycle?.result) return null;
  const label = callResultLabel({ status: "completed", lifecycle }, locale)!;
  const help = callResultCopy[locale][lifecycle.result][1];
  const stages = [
    [lifecycleMessages[locale].started, lifecycle.attemptedAt],
    [lifecycleMessages[locale].ringing, lifecycle.ringingAt],
    [lifecycleMessages[locale].connected, lifecycle.connectedAt],
    [lifecycleMessages[locale].disclosure, lifecycle.disclosureAt],
    [lifecycle.consent === "granted" ? (lifecycleMessages[locale].consentGranted) : lifecycle.consent === "declined" ? (lifecycleMessages[locale].consentDeclined) : (lifecycleMessages[locale].consentMissing), lifecycle.consentAt],
    [lifecycleMessages[locale].conversation, lifecycle.conversationStartedAt],
    [lifecycleMessages[locale].ended, lifecycle.endedAt]
  ] as const;
  const credit = { not_recorded: "", reserved: lifecycleMessages[locale].creditReserved, used: lifecycleMessages[locale].creditUsed, returned: lifecycleMessages[locale].creditReturned }[lifecycle.credit];
  const actors = lifecycleMessages[locale].actors;
  return <section className={`call-lifecycle-summary result-${lifecycle.result}`} aria-label={label}>
    <div className="lifecycle-heading"><h2>{callPresentationCopy[locale].result}: {label}</h2>{credit ? <span className="lifecycle-credit">{credit}</span> : null}</div>
    <p>{help}</p>
    {lifecycle.answering && lifecycle.answering.decision !== "consent" ? <>
      <p>{answeringMessages[locale].message[lifecycle.answering.message === "issued" ? "unknown" : lifecycle.answering.message]}</p>
      {message ? <><p>{answeringMessages[locale].approvedMessage}</p><blockquote>{message}</blockquote></> : null}
      <p className="muted-text">{answeringMessages[locale].uncertainty}</p>
    </> : null}
    {lifecycle.assessment?.status === "unavailable" && lifecycle.credit === "returned" ? <p>{lifecycleMessages[locale].assessmentUnavailable}</p> : null}
    {lifecycle.substantiveAnswerConfirmed && lifecycle.credit === "returned" ? <p>{lifecycleMessages[locale].lateAssessment}</p> : null}
    <details><summary>{lifecycleMessages[locale].details}</summary>
      <ol className="lifecycle-timeline">{stages.filter(([, at]) => at).map(([title, at]) => <li key={title}><span>{title}</span><time dateTime={at!}>{new Intl.DateTimeFormat(formatLocale(locale), { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(at!))}</time></li>)}</ol>
      <p>{lifecycleMessages[locale].endedBy}: {actors[lifecycle.endedBy]}</p>
      {lifecycle.stopRequestedBy ? <p>{lifecycleMessages[locale].stopRequestedBy}: {actors[lifecycle.stopRequestedBy]}</p> : null}
      <p className="muted-text">{lifecycleMessages[locale].connectionHelp}</p>
    </details>
  </section>;
}
