import type { CallSummaryPayload } from "@callassist/contracts";
import type { UiLocale } from "@/lib/i18n/messages";
import { textArtifactMessages } from "@/lib/i18n/text-artifact-messages";

/** Task-language facts; interface-language controls. Sources point to the original revision. */
export function CallSummaryPresentation({ summary, uiLocale, sourceHref, onSource, headingLevel = 3 }: {
  summary: CallSummaryPayload;
  uiLocale: UiLocale;
  sourceHref?: (segmentId: string) => string;
  onSource?: (segmentId: string) => void;
  headingLevel?: 3 | 4;
}) {
  const copy = textArtifactMessages[uiLocale];
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const sources = (ids: string[]) => sourceHref && ids.length ? <details className="summary-evidence">
    <summary>{copy.sources}</summary>
    <span className="summary-sources">{[...new Set(ids)].map((id, index) => <a key={id} href={sourceHref(id)} onClick={() => onSource?.(id)}>{copy.evidence} {index + 1}</a>)}</span>
  </details> : null;
  const findings = (items: CallSummaryPayload["findings"]) => <dl>{items.map(item => <div key={item.id}>
    <dt>{item.label}</dt>
    <dd><p>{item.text}</p>{item.certainty !== "reported" ? <small className="summary-certainty">{copy[item.certainty]}</small> : null}{sources(item.sourceSegmentIds)}</dd>
  </div>)}</dl>;
  // Conditions and missing evidence remain readable without opening the detailed checks.
  const cautions = summary.findings.filter(item => item.certainty !== "reported")
    .filter((item, index, items) => items.findIndex(other => other.text === item.text && other.certainty === item.certainty) === index);
  return <div className="call-summary-presentation">
    {summary.findings.some(item => item.certainty === "reported") ? <small>{copy.reported}</small> : null}
    {summary.overview.length ? <>
      <dl className="summary-overview">{summary.overview.map((item, index) => {
        const ids = summary.findings.filter(finding => item.findingIds.includes(finding.id)).flatMap(finding => finding.sourceSegmentIds);
        return <div key={index}>{item.label ? <dt>{item.label}</dt> : null}<dd><p>{item.text}</p>{sources(ids)}</dd></div>;
      })}</dl>
      {cautions.length ? <div className="summary-cautions">{findings(cautions)}</div> : null}
    </> : summary.findings.length ? findings(summary.findings) : <p>{copy.noAnswers}</p>}
    {summary.nextSteps.length ? <section><Heading>{copy.nextSteps}</Heading><ul>{summary.nextSteps.map((item, index) => <li key={index}>{item.text}{sources(item.sourceSegmentIds)}</li>)}</ul></section> : null}
    {summary.unresolved.length ? <section><Heading>{copy.unresolved}</Heading><ul>{summary.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
    {summary.overview.length && summary.findings.length ? <details className="summary-findings"><summary>{copy.allFindings}</summary>{findings(summary.findings)}</details> : null}
  </div>;
}
