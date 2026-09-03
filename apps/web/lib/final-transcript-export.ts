import type {
  CallBrief,
  FinalTranscript,
  FinalTranscriptSegment
} from "@callassist/contracts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

type ExportInput = {
  brief: CallBrief;
  finalTranscript: FinalTranscript;
  languageLabel: string;
  uiLocale: "en" | "de";
};

const exportCopy = {
  en: {
    title: "Final transcript",
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
  const copy = exportCopy[uiLocale];
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
  input: ExportInput
): TDocumentDefinitions {
  const { brief, finalTranscript, languageLabel, uiLocale } = input;
  const copy = exportCopy[uiLocale];
  const segments = normalizedSegments(finalTranscript);

  return {
    pageSize: "A4",
    pageMargins: [48, 48, 48, 56],
    language: brief.locale,
    info: {
      title: `${copy.title} — ${brief.recipientName}`,
      author: "SHPROHLI",
      subject: copy.created
    },
    defaultStyle: {
      font: "Roboto",
      color: "#10231d",
      fontSize: 10.5,
      lineHeight: 1.38
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `SHPROHLI · ${copy.title}`, color: "#74837d" },
        {
          text: `${currentPage} / ${pageCount}`,
          alignment: "right",
          color: "#74837d"
        }
      ],
      fontSize: 8,
      margin: [48, 18, 48, 0]
    }),
    content: [
      {
        text: "SHPROHLI",
        color: "#176d5d",
        bold: true,
        characterSpacing: 1.8,
        fontSize: 9,
        margin: [0, 0, 0, 8]
      },
      {
        text: copy.title,
        bold: true,
        fontSize: 24,
        margin: [0, 0, 0, 8]
      },
      {
        text: copy.created,
        color: "#65746e",
        fontSize: 10,
        margin: [0, 0, 0, 22]
      },
      metadataLine(copy.recipient, brief.recipientName),
      metadataLine(copy.assistant, brief.agentName),
      metadataLine(copy.language, languageLabel),
      metadataLine(
        copy.completed,
        formatExportDate(finalTranscript.completedAt ?? finalTranscript.updatedAt, uiLocale)
      ),
      {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 499,
            y2: 0,
            lineColor: "#dce5e0",
            lineWidth: 1
          }
        ],
        margin: [0, 18, 0, 22]
      },
      ...(segments.length > 0
        ? segments.map((segment) => transcriptTurn(brief, segment, copy.unassigned))
        : [
            {
              text: finalTranscript.text ?? "",
              margin: [0, 0, 0, 16]
            } satisfies Content
          ]),
      {
        text: copy.warning,
        color: "#74837d",
        fontSize: 8.5,
        italics: true,
        margin: [0, 12, 0, 0]
      }
    ]
  };
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

function normalizedSegments(
  finalTranscript: FinalTranscript
): FinalTranscriptSegment[] {
  return finalTranscript.segments;
}

function metadataLine(label: string, value: string): Content {
  return {
    columns: [
      { text: label, width: 72, color: "#74837d", fontSize: 9 },
      { text: value, width: "*", bold: true, fontSize: 9 }
    ],
    margin: [0, 0, 0, 7]
  };
}

function transcriptTurn(
  brief: CallBrief,
  segment: FinalTranscriptSegment,
  unassigned: string
): Content {
  return {
    stack: [
      {
        columns: [
          {
            text: `~${formatTranscriptOffset(segment.startSeconds)}`,
            width: 46,
            color: "#87948f",
            fontSize: 8.5
          },
          {
            text: speakerName(brief, segment.role, unassigned),
            width: "*",
            bold: true,
            color:
              segment.role === "assistant"
                ? "#10231d"
                : segment.role === "recipient"
                  ? "#176d5d"
                  : "#65746e",
            fontSize: 9.5
          }
        ]
      },
      {
        text: segment.text,
        margin: [46, 5, 0, 0]
      }
    ],
    margin: [0, 0, 0, 16]
  };
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

function formatExportDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
