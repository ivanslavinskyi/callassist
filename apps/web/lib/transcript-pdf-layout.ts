import type { Content, ContentColumns, TDocumentDefinitions } from "pdfmake/interfaces";
import { uiLocaleRegistry, type UiLocale } from "./i18n/registry";

type Metadata = { label: string; value: string };
type TranscriptPdfTurn = {
  id?: string;
  speaker: string;
  role: "assistant" | "recipient" | "unknown";
  offset: string | null;
  text: string;
};

type TranscriptPdfInput = {
  logoSvg?: string;
  title: string;
  description: string;
  variant: string;
  recipient: string;
  language: string;
  metadata: Metadata[];
  turns: TranscriptPdfTurn[];
  text: string;
  notes: string[];
  source?: { title: string; rows: Metadata[] };
};

const ink = "#222B25";
const green = "#138553";
const muted = "#66766E";
const light = "#849189";
const rule = "#DCE5E0";
const pageWidth = 499.28;

/** One print layout for historical transcripts, versioned originals and translations. */
export function buildTranscriptPdfLayout(input: TranscriptPdfInput): TDocumentDefinitions {
  const content: Content[] = [
    {
      columns: [
        input.logoSvg
          ? { svg: input.logoSvg, width: 148 }
          : { text: "SHPROHLI", bold: true, characterSpacing: 1.8, color: green, fontSize: 11 },
        { text: input.variant, alignment: "right", color: muted, fontSize: 8.5, margin: [16, 7, 0, 0] }
      ],
      margin: [0, 0, 0, 20]
    },
    { text: input.title, bold: true, fontSize: 24, lineHeight: 1.1, margin: [0, 0, 0, 8] },
    { text: input.description, color: muted, fontSize: 10, margin: [0, 0, 0, 20] },
    ...input.metadata.map(metadataRow),
    divider([0, 13, 0, 20]),
    ...(input.turns.length ? input.turns.map((turn, index) => ({
      // Break before the entire turn if its heading would be separated from its text.
      id: `shprohli-layout-turn-${index}`,
      headlineLevel: turn.text.trim() ? 2 : undefined,
      columns: [
        { text: turn.offset ?? "", width: 46, color: light, fontSize: 8.5, margin: [0, 1, 0, 0] },
        {
          width: "*",
          stack: [
            { text: turn.speaker, ...(turn.id ? { id: turn.id } : {}), bold: true, fontSize: 9.5,
              color: turn.role === "recipient" ? green : turn.role === "assistant" ? ink : muted },
            { text: turn.text, id: `shprohli-layout-body-${index}`, margin: [0, 4, 0, 0] }
          ]
        }
      ],
      margin: [0, 0, 0, 15]
    } satisfies ContentColumns & { id: string })) : [{ text: input.text, margin: [0, 0, 0, 16] } satisfies Content]),
    {
      stack: input.notes.filter(Boolean).map(text => ({ text, color: muted, fontSize: 8.5, italics: true, margin: [0, 0, 0, 6] })),
      margin: [0, 8, 0, 0]
    }
  ];
  if (input.source) content.push({
    unbreakable: true,
    stack: [
      divider([0, 12, 0, 9]),
      { text: input.source.title, bold: true, color: muted, fontSize: 7.5, margin: [0, 0, 0, 5] },
      ...input.source.rows.map(({ label, value }): Content => ({
        text: [{ text: `${label}: `, bold: true }, value], color: muted, fontSize: 7,
        lineHeight: 1.2, margin: [0, 0, 0, 3]
      }))
    ]
  });

  return {
    pageSize: "A4",
    pageMargins: [48, 44, 48, 56],
    language: input.language,
    info: { title: `${input.title} — ${input.recipient}`, author: "SHPROHLI", subject: input.description },
    defaultStyle: { font: "Roboto", color: ink, fontSize: 10.5, lineHeight: 1.3 },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `SHPROHLI · ${input.variant}`, color: light },
        { text: `${currentPage} / ${pageCount}`, width: 45, alignment: "right", color: light }
      ],
      fontSize: 8,
      margin: [48, 18, 48, 0]
    }),
    pageBreakBefore: (node, queries) => {
      if (node.headlineLevel !== 2 || !node.id?.startsWith("shprohli-layout-turn-")) return false;
      const bodyId = node.id.replace("shprohli-layout-turn-", "shprohli-layout-body-");
      return !queries.getFollowingNodesOnPage().some(next => next.id === bodyId);
    },
    content
  };
}

function metadataRow({ label, value }: Metadata): Content {
  return {
    unbreakable: true,
    columns: [
      { text: label, width: 108, color: muted, fontSize: 9 },
      { text: value, width: "*", bold: true, fontSize: 9 }
    ],
    columnGap: 12,
    margin: [0, 0, 0, 6]
  };
}

function divider(margin: [number, number, number, number]): Content {
  return { canvas: [{ type: "line", x1: 0, y1: 0, x2: pageWidth, y2: 0, lineColor: rule, lineWidth: 0.7 }], margin };
}

export function formatTranscriptPdfDate(value: string | undefined, locale: UiLocale): string | null {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(uiLocaleRegistry[locale].formatLocale, {
    dateStyle: "medium", ...(dateOnly ? { timeZone: "UTC" } : { timeStyle: "short" as const })
  }).format(new Date(value));
}
