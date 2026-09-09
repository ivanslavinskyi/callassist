import type {
  CallBrief,
  FinalTranscript,
  FinalTranscriptSegment
} from "@callassist/contracts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { buildTranscriptPdfLayout } from "./transcript-pdf-layout";
import { uiLocaleRegistry, type UiLocale } from "./i18n/registry";

type ExportInput = {
  brief: CallBrief;
  finalTranscript: FinalTranscript;
  languageLabel: string;
  uiLocale: UiLocale;
};

export const transcriptExportCopy = {
  en: {
    title: "Final transcript",
    translationTitle: "Translated transcript",
    callLanguage: "Call language",
    textLanguage: "Translation language",
    sourceCreated: "Transcript created",
    source: "Document source",
    created: "Created from the call recording after the conversation ended.",
    recipient: "Recipient",
    assistant: "Assistant",
    language: "Language",
    completed: "Completed",
    unassigned: "Unassigned speaker",
    warning: "AI-generated. Check important names, dates, numbers and commitments against the recording."
  },
  de: {
    title: "Endtranskript",
    translationTitle: "Übersetztes Transkript",
    callLanguage: "Anrufsprache",
    textLanguage: "Übersetzungssprache",
    sourceCreated: "Transkript erstellt",
    source: "Dokumentquelle",
    created: "Wurde nach dem Gespräch aus der Anrufaufnahme erstellt.",
    recipient: "Angerufene Person",
    assistant: "Assistent",
    language: "Sprache",
    completed: "Abgeschlossen",
    unassigned: "Nicht zugeordnete Stimme",
    warning: "Mit KI erstellt. Prüfen Sie wichtige Namen, Daten, Zahlen und Zusagen anhand der Aufnahme."
  }
} as const;

export function buildFinalTranscriptCopyText(input: ExportInput) {
  const { brief, finalTranscript, languageLabel, uiLocale } = input;
  const copy = transcriptExportCopy[uiLocale];
  const header = [
    `SHPROHLI — ${copy.title}`,
    `${copy.recipient}: ${brief.recipientName}`,
    `${copy.assistant}: ${brief.agentName}`,
    `${copy.language}: ${languageLabel}`,
    `${copy.completed}: ${formatExportDate(finalTranscript.completedAt ?? finalTranscript.updatedAt, uiLocale)}`
  ];
  const transcript = transcriptLines(brief, finalTranscript, copy.unassigned);

  return [
    ...header,
    "",
    copy.created,
    "",
    ...transcript,
    "",
    copy.warning
  ].join("\n");
}

export function buildFinalTranscriptPdfDefinition(
  input: ExportInput,
  logoSvg?: string
): TDocumentDefinitions {
  const { brief, finalTranscript, languageLabel, uiLocale } = input;
  const copy = transcriptExportCopy[uiLocale];
  return buildTranscriptPdfLayout({
    logoSvg,
    title: copy.title,
    description: copy.created,
    variant: copy.title,
    recipient: brief.recipientName,
    language: brief.locale,
    metadata: [
      { label: copy.recipient, value: brief.recipientName },
      { label: copy.assistant, value: brief.agentName },
      { label: copy.language, value: languageLabel },
      { label: copy.completed, value: formatExportDate(finalTranscript.completedAt ?? finalTranscript.updatedAt, uiLocale) }
    ],
    turns: finalTranscript.segments.map(segment => ({
      speaker: speakerName(brief, segment.role, copy.unassigned), role: segment.role,
      offset: `~${formatTranscriptOffset(segment.startSeconds)}`, text: segment.text
    })),
    text: finalTranscript.text ?? "",
    notes: [copy.warning]
  });
}

export function finalTranscriptPdfFileName(input: ExportInput) {
  const date = (input.finalTranscript.completedAt ?? input.finalTranscript.updatedAt)
    .slice(0, 10);
  const recipient = input.brief.recipientName
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return `shprohli-final-transcript-${recipient || "call"}-${date}.pdf`;
}

export async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("CLIPBOARD_UNAVAILABLE");
}

function transcriptLines(brief: CallBrief, finalTranscript: FinalTranscript, unassigned: string) {
  if (finalTranscript.segments.length === 0) {
    return finalTranscript.text ? [finalTranscript.text] : [];
  }
  return finalTranscript.segments.map(
    (segment) =>
      `[~${formatTranscriptOffset(segment.startSeconds)}] ${speakerName(brief, segment.role, unassigned)}: ${segment.text}`
  );
}

function speakerName(
  brief: CallBrief,
  role: FinalTranscriptSegment["role"],
  unassigned: string
) {
  if (role === "assistant") return brief.agentName;
  if (role === "recipient") return brief.recipientName;
  return unassigned;
}

export function formatTranscriptOffset(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainder = total % 60;

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function formatExportDate(value: string, locale: UiLocale) {
  return new Intl.DateTimeFormat(uiLocaleRegistry[locale].formatLocale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
