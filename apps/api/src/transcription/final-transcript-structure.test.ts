import type { TranscriptSegment } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { structureFinalTranscript } from "./final-transcript-structure";

const recordingStartedAt = "2026-08-12T12:00:00.000Z";

function live(
  role: "assistant" | "recipient",
  text: string,
  seconds: number
): TranscriptSegment {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    locale: "de-CH",
    final: true,
    createdAt: new Date(Date.parse(recordingStartedAt) + seconds * 1_000).toISOString()
  };
}

describe("structureFinalTranscript", () => {
  it("adds roles and approximate timestamps without changing canonical wording", () => {
    const text = "Guten Tag. Wie bitte? Ich wiederhole die Frage.";
    const segments = structureFinalTranscript(
      text,
      [
        live("assistant", "Guten Tag.", 1),
        live("recipient", "Wie bitte?", 5),
        live("assistant", "Ich wiederhole die Frage.", 6)
      ],
      { recordingStartedAt, durationSeconds: 12 }
    );

    expect(segments.map(({ role }) => role)).toEqual([
      "assistant",
      "recipient",
      "assistant"
    ]);
    expect(segments[0].startSeconds).toBe(1);
    expect(segments[1].startSeconds).toBe(3);
    expect(reconstructedText(segments)).toBe(text);
  });

  it("uses a different live draft only as structure, never as final wording", () => {
    const text =
      "Nennen Sie ein Land. Land, bitte noch einmal. Ich wiederhole die Frage.";
    const segments = structureFinalTranscript(
      text,
      [
        live("assistant", "Nennen Sie ein Land.", 1),
        live("recipient", "Wann dann bitte noch einmal.", 6),
        live("assistant", "Ich wiederhole die Frage.", 7)
      ],
      { recordingStartedAt, durationSeconds: 12 }
    );

    expect(reconstructedText(segments)).toBe(text);
    expect(segments.some(({ text: segmentText }) => segmentText.includes("Wann"))).toBe(
      false
    );
    expect(segments.map(({ role }) => role)).toEqual([
      "assistant",
      "recipient",
      "assistant"
    ]);
  });

  it("marks an uncorroborated gap as unknown instead of guessing a speaker", () => {
    const text =
      "Bitte antworten Sie. Akustisch unklare Antwort. Ich frage noch einmal.";
    const segments = structureFinalTranscript(
      text,
      [
        live("assistant", "Bitte antworten Sie.", 1),
        live("recipient", "совсем другой текст", 5),
        live("assistant", "Ich frage noch einmal.", 6)
      ],
      { recordingStartedAt, durationSeconds: 12 }
    );

    expect(segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "unknown",
          text: "Akustisch unklare Antwort."
        })
      ])
    );
    expect(reconstructedText(segments)).toBe(text);
  });

  it("falls back to unstructured text when alignment evidence is weak", () => {
    expect(
      structureFinalTranscript(
        "Eine vollständig andere Aufnahme ohne gemeinsame Wörter.",
        [live("assistant", "No matching live event exists.", 1)],
        { recordingStartedAt, durationSeconds: 12 }
      )
    ).toEqual([]);
  });

  it("ignores synthetic events before the first recorded assistant utterance", () => {
    const text = "Spreche ich mit Elena? Ja.";
    const segments = structureFinalTranscript(
      text,
      [
        live("recipient", "Taste 1 — Zustimmung erteilt", 0.01),
        live("assistant", "Spreche ich mit Elena?", 1),
        live("recipient", "Ja.", 4)
      ],
      { recordingStartedAt, durationSeconds: 8 }
    );

    expect(segments.map(({ role }) => role)).toEqual([
      "assistant",
      "recipient"
    ]);
    expect(reconstructedText(segments)).toBe(text);
  });
});

function reconstructedText(segments: Array<{ text: string }>) {
  return segments
    .map(({ text }) => text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
