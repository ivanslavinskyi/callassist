import type { CallSummaryPayload } from "@callassist/contracts";

/** One projection for screen, copy and PDF; computed facts have their own source. */
export function summaryPresentation(summary: CallSummaryPayload): CallSummaryPayload {
  if (!summary.calendar) return summary;
  const computed = new Set(summary.appointmentExtraction?.conditions.filter(c => c.kind === "calendar_only").map(c => c.checkId));
  return { ...summary, findings: summary.findings.filter(f => !computed.has(f.id)),
    overview: summary.overview.map(item => ({ ...item, findingIds: item.findingIds.filter(id => !computed.has(id)) }))
      .filter(item => item.findingIds.length) };
}

export function summaryExportLines(raw: CallSummaryPayload | null | undefined): string[] {
  if (!raw) return [];
  const summary = summaryPresentation(raw);
  const lines = summary.overview.length ? summary.overview.map(p => `${p.label ? p.label + ": " : ""}${p.text}`)
    : summary.findings.map(f => `${f.label}: ${f.text}`);
  if (summary.calendar) lines.push(`${summary.calendar.label}: ${summary.calendar.text}`,
    `${summary.calendar.sourceLabel}: ${summary.calendar.sourceText}`, summary.calendar.actionText);
  lines.push(...summary.nextSteps.map(s => s.text), ...summary.unresolved);
  return [...new Set(lines)];
}
