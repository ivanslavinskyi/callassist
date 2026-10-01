import { transcriptSourceCopy, transcriptSourceDescription } from "./i18n/transcript-source-copy";
import { ASSISTANT_DISPLAY_NAME } from "./assistant-identity";
import type { CallBrief, CallSnapshot, FinalTranscriptRevision, SourceSegment, TextLanguage } from "@callassist/contracts";
import { appointmentResultState } from "./call-result-projection";
import { appointmentResultMessages } from "./i18n/appointment-result-messages";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { messages, type UiLocale } from "./i18n/messages";
import { getCallLanguageLabel, getTextLanguageLabel } from "./i18n/language-messages";
import { textArtifactMessages } from "./i18n/text-artifact-messages";
import { formatTranscriptOffset, transcriptExportCopy } from "./final-transcript-export";
import { buildTranscriptPdfLayout, formatTranscriptPdfDate } from "./transcript-pdf-layout";

export type DerivedTranscriptExport = {
  brief: CallBrief;
  revision: FinalTranscriptRevision;
  segments: SourceSegment[];
  text: string;
  translationLanguage: TextLanguage | null;
  uiLocale: UiLocale;
  appointmentAction?: CallSnapshot["appointmentAction"];
};

export function buildDerivedTranscriptCopyText(input: DerivedTranscriptExport) {
  const copy = textArtifactMessages[input.uiLocale];
  return [...exportHeader(input), "", appointmentNote(input), transcriptSourceDescription(input.uiLocale,input.revision.source), "", ...input.segments.map((segment) => {
    const timestamp = segment.startSeconds === null ? "" : `[~${formatTranscriptOffset(segment.startSeconds)}] `;
    return `${timestamp}[${segment.id}] ${speaker(input, segment)}: ${segment.text}`;
  }), ...(input.segments.length ? [] : [input.text]), "", input.translationLanguage ? copy.translationNote : "", messages[input.uiLocale].live.aiWarning].filter((value, index, values) => value || values[index - 1]).join("\n");
}

export function buildDerivedTranscriptPdfDefinition(input: DerivedTranscriptExport, logoSvg?: string): TDocumentDefinitions {
  const copy = textArtifactMessages[input.uiLocale];
  const common = {...transcriptExportCopy[input.uiLocale],title:transcriptSourceCopy[input.uiLocale].title,created:transcriptSourceDescription(input.uiLocale,input.revision.source)};
  const translationLabel = input.translationLanguage ? getTextLanguageLabel(input.translationLanguage, input.uiLocale) : null;
  const created = formatTranscriptPdfDate(input.revision.createdAt, input.uiLocale);
  return buildTranscriptPdfLayout({
    logoSvg,
    title: input.translationLanguage ? common.translationTitle : common.title,
    description: input.translationLanguage ? `${copy.translationNote} ${common.created}` : common.created,
    variant: translationLabel ? `${copy.translated} · ${translationLabel}` : copy.originalSource,
    recipient: input.brief.recipientName,
    language: input.translationLanguage ?? input.brief.locale,
    metadata: [
      { label: common.recipient, value: input.brief.recipientName },
      { label: common.assistant, value: ASSISTANT_DISPLAY_NAME },
      { label: common.callLanguage, value: getCallLanguageLabel(input.brief.locale, input.uiLocale) },
      ...(translationLabel ? [{ label: common.textLanguage, value: translationLabel }] : []),
      ...(created ? [{ label: common.sourceCreated, value: created }] : [])
    ],
    turns: input.segments.map(segment => ({
      id: segment.id, role: segment.role, text: segment.text,
      speaker: segment.role === "unknown" ? common.unassigned : speaker(input, segment),
      offset: segment.startSeconds === null ? null : `~${formatTranscriptOffset(segment.startSeconds)}`
    })),
    text: input.text,
    notes: [appointmentNote(input), messages[input.uiLocale].live.aiWarning].filter(Boolean),
    source: { title: common.source, rows: [
      { label: copy.sourceRevision, value: `${input.revision.revision} · ${input.revision.id}` },
      { label: "SHA-256", value: input.revision.sourceHash }
    ] }
  });
}

function appointmentNote(input: DerivedTranscriptExport) {
  const state = appointmentResultState(input.appointmentAction, input.revision);
  return state ? appointmentResultMessages[input.uiLocale][state] : "";
}

export function derivedTranscriptFilename(input: DerivedTranscriptExport) {
  return `shprohli-transcript-${input.translationLanguage ?? input.brief.locale}-r${input.revision.revision}-${input.revision.createdAt.slice(0, 10)}.pdf`;
}

function exportHeader(input: DerivedTranscriptExport) {
  const copy = textArtifactMessages[input.uiLocale];
  return [
    `SHPROHLI — ${input.translationLanguage ? copy.translated : copy.originalSource}`,
    input.brief.recipientName,
    input.translationLanguage ? getTextLanguageLabel(input.translationLanguage, input.uiLocale) : getCallLanguageLabel(input.brief.locale, input.uiLocale),
    `${copy.sourceRevision}: ${input.revision.revision} (${input.revision.id})`,
    `SHA-256: ${input.revision.sourceHash}`
  ];
}

function speaker(input: DerivedTranscriptExport, segment: SourceSegment) {
  return segment.role === "assistant" ? ASSISTANT_DISPLAY_NAME : segment.role === "recipient" ? input.brief.recipientName : "?";
}
