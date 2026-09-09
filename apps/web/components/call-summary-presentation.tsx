import type { CallSummaryPayload } from "@callassist/contracts";
import type { UiLocale } from "@/lib/i18n/messages";
import { textArtifactMessages } from "@/lib/i18n/text-artifact-messages";

/** Presentational summary shared by real calls and the read-only educational demo. */
export function CallSummaryPresentation({ summary, uiLocale, sourceHref, onSource, headingLevel = 3 }: {
  summary: CallSummaryPayload;
  uiLocale: UiLocale;
  sourceHref?: (segmentId: string) => string;
  onSource?: (segmentId: string) => void;
  headingLevel?: 3 | 4;
}) {
  const copy = textArtifactMessages[uiLocale];
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const sources = (ids: string[]) => sourceHref && ids.length ? <span className="summary-sources">
    {ids.map((id, index) => <a key={id} href={sourceHref(id)} onClick={() => onSource?.(id)}>{copy.evidence} {index + 1}</a>)}
  </span> : null;
  return <div className="call-summary-presentation">
    {summary.answers.length ? <dl>{summary.answers.map((item, index) => <div key={index}>
      <dt><strong>{item.question}</strong></dt>
      <dd><p>{item.answer}</p><small>{copy[item.certainty]}</small>{sources(item.sourceSegmentIds)}</dd>
    </div>)}</dl> : <p>{copy.noAnswers}</p>}
    {summary.nextSteps.length ? <section><Heading>{copy.nextSteps}</Heading><ul>{summary.nextSteps.map((item, index) => <li key={index}>{item.text}{sources(item.sourceSegmentIds)}</li>)}</ul></section> : null}
    {summary.unresolved.length ? <section><Heading>{copy.unresolved}</Heading><ul>{summary.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
  </div>;
}
