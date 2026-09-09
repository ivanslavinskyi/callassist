import type { CallBrief, FinalTranscript, FinalTranscriptRevision, SourceSegment } from "@callassist/contracts";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { buildDerivedTranscriptPdfDefinition } from "../lib/derived-transcript-export";
import { buildFinalTranscriptPdfDefinition } from "../lib/final-transcript-export";

// Local, synthetic fixtures only. No account, recording, network or provider access.
// Run from apps/api: node --import tsx ../web/scripts/verify-transcript-pdf.ts
const pdfRequire = createRequire(resolve(__dirname, "../package.json"));
const pdfMake = pdfRequire("pdfmake/build/pdfmake") as {
  addVirtualFileSystem: (fonts: unknown) => void;
  createPdf: (definition: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> };
};
pdfMake.addVirtualFileSystem(pdfRequire("pdfmake/build/vfs_fonts"));
async function main() {
const logoSvg = await readFile(resolve(__dirname, "../public/brand/logo-light.svg"), "utf8");
const outputDirectory = resolve(__dirname, "../../../.tools/pdf-redesign/fixtures");
await mkdir(outputDirectory, { recursive: true });

const createdAt = "2026-09-09T10:15:00.000Z";
const brief = {
  id: "00000000-0000-4000-8000-000000000001",
  recipientName: "Synthetic Example Office",
  agentName: "Sebastian",
  locale: "de-CH"
} as CallBrief;
const originalSegments: SourceSegment[] = [
  { id: "source-opening", role: "assistant", text: "Guten Tag. Dies ist ein synthetisches Beispiel zur Prüfung des PDF-Exports.", startSeconds: 1.5, endSeconds: 6 },
  { id: "source-answer", role: "recipient", text: "Das Dokument ist noch nicht eingegangen. Die Gebühr beträgt CHF 25.00. Eine Frist wurde nicht bestätigt.", startSeconds: 8, endSeconds: 18 },
  { id: "source-unknown", role: "unknown", text: "Bitte prüfen Sie die Angaben. Es wurde keine Zusage gemacht.", startSeconds: null, endSeconds: null },
  { id: "source-close", role: "assistant", text: "Vielen Dank. Ich halte fest, dass die Angaben noch geprüft werden müssen.", startSeconds: 65.2, endSeconds: 70 }
];
function revisionFor(segments: SourceSegment[], text = segments.map((segment) => segment.text).join("\n")): FinalTranscriptRevision {
  return {
    id: "00000000-0000-4000-8000-000000000002", transcriptId: "00000000-0000-4000-8000-000000000003",
    callAttemptId: null, revision: 2, sourceHash: createHash("sha256").update(text).digest("hex"), text, segments, createdAt
  };
}
const revision = revisionFor(originalSegments);
const legacy: FinalTranscript = {
  id: "00000000-0000-4000-8000-000000000004", status: "completed", model: "synthetic-fixture",
  failureReason: null, createdAt, updatedAt: createdAt, completedAt: createdAt,
  text: "Hello. The document has not arrived yet. No deadline was confirmed.",
  segments: [
    { role: "assistant", text: "Hello. This is a synthetic conversation for checking PDF layout.", startSeconds: 1.8, endSeconds: 5 },
    { role: "recipient", text: "The document has not arrived yet. The fee is CHF 25.00. No deadline was confirmed.", startSeconds: 8, endSeconds: 17 },
    { role: "unknown", text: "Please verify these details. No commitment was made.", startSeconds: 20, endSeconds: 24 },
    { role: "assistant", text: "Thank you. I will record that the details still need to be checked.", startSeconds: 65.2, endSeconds: 70 }
  ]
};
const russian = [
  "Здравствуйте. Это синтетический пример для проверки экспорта PDF.",
  "Документ ещё не получен. Плата составляет CHF 25.00. Срок не подтверждён.",
  "Проверьте сведения. Обязательство не было принято. Іван: її ім’я — навчальний приклад.",
  "Спасибо. Я отмечу, что сведения ещё нужно проверить."
];
const translatedSegments = originalSegments.map((segment, index) => ({ ...segment, text: russian[index]! }));
const plainText = "Synthetischer Text ohne Sprecherzuordnung und Zeitmarken. Das Dokument ist noch nicht eingegangen. Es gibt keine bestätigte Frist.";
const plainRevision = revisionFor([], plainText);
const longSpeaker = "Навчальна служба перевірки багатомовних документів та консультацій — синтетичний приклад без реального адресата";
const longText = ["TURN-LONG-START", ...Array.from({ length: 90 }, (_, index) =>
  `Частина ${index + 1}. Її заяву ще не отримано. Ім’я та адресу потрібно перевірити, суму CHF 25.00 не слід змінювати, а строк не підтверджено. Це лише вигаданий приклад для перевірки перенесення довгої репліки між сторінками.`), "TURN-LONG-END"].join(" ");
const longSegments = [
  { ...originalSegments[0]!, id: "long-introduction", text: "Початок синтетичного багатосторінкового прикладу." },
  { ...originalSegments[1]!, id: "long-single-turn", text: longText, startSeconds: 3661, endSeconds: 3800 },
  { ...originalSegments[2]!, id: "long-conclusion", text: "AFTER-LONG-TURN — увесь текст має залишатися доступним після довгої репліки." }
];
const longRevision = revisionFor(longSegments.map((segment) => ({
  ...segment, text: `Synthetische deutsche Quelle für ${segment.id}. Angaben sind noch nicht bestätigt.`
})));
const boundarySegments: SourceSegment[] = Array.from({ length: 40 }, (_, index) => ({
  id: `boundary-source-${String(index + 1).padStart(2, "0")}`,
  role: index % 2 === 0 ? "assistant" : "recipient",
  text: `BOUNDARY-${String(index + 1).padStart(2, "0")} ${Array.from({ length: 1 + index % 3 }, () =>
    "The supplied details still need checking; no date or commitment was confirmed.").join(" ")}`,
  startSeconds: index * 14 + 1, endSeconds: index * 14 + 10
}));
const boundaryRevision = revisionFor(boundarySegments);

type Fixture = {
  file: string; definition: TDocumentDefinitions; expectedText: string[];
  excludedText?: string[]; sourceSegmentIds?: string[]; sourceHash?: string; minimumPages?: number;
  verifyTurnDestinations?: boolean;
};
const fixtures: Fixture[] = [
  {
    file: "01-legacy-en.pdf",
    definition: buildFinalTranscriptPdfDefinition({ brief: { ...brief, locale: "en-GB" }, finalTranscript: legacy, languageLabel: "English", uiLocale: "en" }, logoSvg),
    expectedText: ["Final transcript", "Synthetic Example Office", "The document has not arrived yet.", "CHF 25.00", "No deadline was confirmed.", "01:05"]
  },
  {
    file: "02-derived-original-de.pdf",
    definition: buildDerivedTranscriptPdfDefinition({ brief, revision, segments: originalSegments, text: revision.text, translationLanguage: null, uiLocale: "de" }, logoSvg),
    expectedText: ["Das Dokument ist noch nicht eingegangen.", "CHF 25.00", revision.id, revision.sourceHash],
    sourceSegmentIds: originalSegments.map((segment) => segment.id), sourceHash: revision.sourceHash
  },
  {
    file: "03-derived-translation-ru.pdf",
    definition: buildDerivedTranscriptPdfDefinition({ brief, revision, segments: translatedSegments, text: russian.join("\n"), translationLanguage: "ru", uiLocale: "de" }, logoSvg),
    expectedText: ["Документ ещё не получен.", "CHF 25.00", "Срок не подтверждён.", "Іван", "її ім’я", revision.id, revision.sourceHash],
    excludedText: [originalSegments[1]!.text, "00:00"], sourceSegmentIds: originalSegments.map((segment) => segment.id), sourceHash: revision.sourceHash
  },
  {
    file: "04-derived-text-only-de.pdf",
    definition: buildDerivedTranscriptPdfDefinition({ brief, revision: plainRevision, segments: [], text: plainText, translationLanguage: null, uiLocale: "de" }, logoSvg),
    expectedText: [plainText, plainRevision.sourceHash], excludedText: ["00:00"], sourceSegmentIds: [], sourceHash: plainRevision.sourceHash
  },
  {
    file: "05-legacy-text-only-en.pdf",
    definition: buildFinalTranscriptPdfDefinition({ brief: { ...brief, locale: "en-GB" }, finalTranscript: { ...legacy, segments: [], text: "Synthetic plain recording transcript. No speaker or time was supplied." }, languageLabel: "English", uiLocale: "en" }, logoSvg),
    expectedText: ["Synthetic plain recording transcript. No speaker or time was supplied."], excludedText: ["Unassigned speaker", "00:00"]
  },
  {
    file: "06-derived-long-turn-uk.pdf",
    definition: buildDerivedTranscriptPdfDefinition({ brief: { ...brief, recipientName: longSpeaker }, revision: longRevision, segments: longSegments, text: longSegments.map((segment) => segment.text).join("\n"), translationLanguage: "uk", uiLocale: "en" }, logoSvg),
    expectedText: ["TURN-LONG-START", "Частина 1.", "Частина 90.", "TURN-LONG-END", "AFTER-LONG-TURN", "Її заяву ще не отримано.", "1:01:01", longSpeaker],
    sourceSegmentIds: longSegments.map((segment) => segment.id), sourceHash: longRevision.sourceHash, minimumPages: 3
  },
  {
    file: "07-varied-turn-boundaries.pdf",
    definition: buildDerivedTranscriptPdfDefinition({
      brief: { ...brief, locale: "en-GB", recipientName: longSpeaker }, revision: boundaryRevision,
      segments: boundarySegments, text: boundaryRevision.text, translationLanguage: null, uiLocale: "en"
    }, logoSvg),
    expectedText: boundarySegments.map((_, index) => `BOUNDARY-${String(index + 1).padStart(2, "0")}`),
    sourceSegmentIds: boundarySegments.map((segment) => segment.id), sourceHash: boundaryRevision.sourceHash,
    minimumPages: 3, verifyTurnDestinations: true
  }
];

const manifest = [];
for (const { file, definition, ...expectations } of fixtures) {
  const bytes = await pdfMake.createPdf(definition).getBuffer();
  await writeFile(resolve(outputDirectory, file), bytes);
  manifest.push({ file, bytes: bytes.length, language: definition.language, ...expectations });
  process.stdout.write(`Created ${file} (${bytes.length} bytes)\n`);
}
await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify({
  fixtureSource: "Synthetic local fixtures generated with the actual transcript PDF builders; no real call data.",
  logoSource: "apps/web/public/brand/logo-light.svg", logoSha256: createHash("sha256").update(logoSvg).digest("hex"),
  fixtures: manifest
}, null, 2)}\n`);
process.stdout.write(`PDF verification fixtures: ${outputDirectory}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
