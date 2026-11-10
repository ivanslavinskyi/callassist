import type { UiLocale } from "@callassist/contracts";
import { callPresentationCopy } from "@/lib/i18n/call-presentation";

/** Analysis has no measured percentage. Motion communicates activity, not completion. */
export function CallAnalysisProgress({ locale, compact = false, label: customLabel }: { locale: UiLocale; compact?: boolean; label?: string }) {
  const label = (customLabel ?? callPresentationCopy[locale].aiStates.pending).replace(/(?:…|\.{3})$/, "");
  return <span className={`call-analysis-progress${compact ? " is-compact" : ""}`}>
    <span className="call-analysis-label" role="status">{label}</span>
    <span className="call-analysis-track" role="progressbar" aria-label={label}>
      <span className="call-analysis-sweep" />
    </span>
  </span>;
}
