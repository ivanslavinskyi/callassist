import type { CallBrief, FinalTranscript } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import {
  buildFinalTranscriptCopyText,
  buildFinalTranscriptPdfDefinition,
  finalTranscriptPdfFileName,
  formatTranscriptOffset
} from "./final-transcript-export";

const brief = {
  id: "7c49c78e-797a-4f1e-b9a2-c9482ac3bfbf",
  recipientName: "Иван Müller",
  agentName: "Sebastian",
  locale: "ru-RU"
} as CallBrief;

const finalTranscript = {
  status: "completed",
  text: "Здравствуйте. Добрый день.",
  segments: [
    {
      role: "assistant",
      text: "Здравствуйте.",
      startSeconds: 1.8,
      endSeconds: 3
    },
    {
      role: "recipient",
      text: "Добрый день.",
      startSeconds: 65.2,
      endSeconds: 66
    }
  ],
  completedAt: "2026-08-10T12:30:00.000Z",
  updatedAt: "2026-08-10T12:30:00.000Z"
} as FinalTranscript;

const input = {
  brief,
  finalTranscript,
  languageLabel: "Russian"
};

describe("final transcript export", () => {
  it("copies the structured transcript with speakers and timestamps", () => {
    const text = buildFinalTranscriptCopyText(input);

    expect(text).toContain("Recipient: Иван Müller");
    expect(text).toContain("[00:01] Sebastian: Здравствуйте.");
    expect(text).toContain("[01:05] Иван Müller: Добрый день.");
  });

  it("preserves a full-recording transcript without invented speaker data", () => {
    const text = buildFinalTranscriptCopyText({
      ...input,
      finalTranscript: {
        ...finalTranscript,
        segments: [],
        text: "Legacy transcript text"
      }
    });

    expect(text).toContain("\n\nLegacy transcript text");
    expect(text).not.toContain("Unassigned speaker");
  });

  it("builds a searchable Unicode PDF definition", () => {
    const definition = buildFinalTranscriptPdfDefinition(input);

    expect(definition.defaultStyle).toMatchObject({ font: "Roboto" });
    expect(JSON.stringify(definition.content)).toContain("Здравствуйте.");
    expect(definition.info?.title).toBe("Final transcript — Иван Müller");
    expect(definition.language).toBe("ru-RU");
  });

  it("creates a stable, readable filename", () => {
    expect(finalTranscriptPdfFileName(input)).toBe(
      "callassist-final-transcript-иван-müller-2026-08-10.pdf"
    );
  });

  it("formats minute and hour offsets", () => {
    expect(formatTranscriptOffset(4.9)).toBe("00:04");
    expect(formatTranscriptOffset(65)).toBe("01:05");
    expect(formatTranscriptOffset(3_661)).toBe("1:01:01");
  });
});
