import { describe, expect, it } from "vitest";
import type { CallSnapshot, TranscriptSegment } from "@callassist/contracts";
import { assembleNativeTranscript, type NativeTranscriptCapture } from "./native-transcript";

const origin = "2026-09-28T12:00:00.000Z";
const capture: NativeTranscriptCapture = { version: 1, sessionId: "session", model: "gpt-live-1", status: "complete", sessionStartedAt: origin, updatedAt: origin };
function fragment(eventId: string, role: "recipient" | "assistant", text: string, startMs: number, endMs = startMs + 100): TranscriptSegment {
  return { id: eventId, role, text, final: true, createdAt: origin, ingestionSequence: startMs,
    nativeTiming: { sessionId: "session", eventId, sessionStartedAt: origin, startMs, endMs } } as TranscriptSegment;
}
function snapshot(transcript: TranscriptSegment[], startedAt = origin) {
  return { brief: { locale: "de-CH" }, transcript, recording: { startedAt } } as CallSnapshot;
}
describe("native conversation transcript", () => {
  it("composes marked application audio without merging it with native words or including another session", () => {
    const applicationPlayback = { sessionId: "session", markId: "closing-mark", sentAt: "2026-09-28T12:00:01.000Z",
      acknowledgedAt: "2026-09-28T12:00:02.000Z", durationMs: 900 };
    const closing = { ...fragment("closing", "assistant", "Sie möchten Pizza. Auf Wiederhören.", 0), nativeTiming: undefined, applicationPlayback };
    const other = { ...closing, applicationPlayback: { ...applicationPlayback, sessionId: "other" } };
    const result = assembleNativeTranscript(snapshot([closing, fragment("q", "assistant", "Was möchten Sie?", 100),
      fragment("a", "recipient", "Pizza", 700), closing, other]), capture)!;
    expect(result.source).toBe("live_composed");
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0].source).toBe("live_native");
    expect(result.segments[2]).toMatchObject({ text: closing.text, source: "application_playback", startSeconds: 1, endSeconds: 2, applicationPlayback });
  });
  it("preserves words and whitespace, orders late fragments and deduplicates event IDs", () => {
    const second = fragment("b", "recipient", " хочу жареной картошки", 300);
    const result = assembleNativeTranscript(snapshot([second, fragment("a", "recipient", "М-м, я", 100), second,
      fragment("c", "recipient", ", да, да.", 500), fragment("d", "assistant", "Понял.", 450)]), capture)!;
    expect(result.text).toBe("М-м, я хочу жареной картошки, да, да.\nПонял.");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ startSeconds: 0.1, endSeconds: 0.6 });
  });
  it("excludes pre-consent and crossing native fragments using the consent boundary", () => {
    const result = assembleNativeTranscript(snapshot([fragment("a", "assistant", "Disclosure", 100),
      fragment("b", "recipient", "Yes", 950, 1050), fragment("c", "recipient", "Answer", 1200)],
      "2026-09-28T12:00:01.000Z"), { ...capture, transcriptBoundaryMs: 1100 })!;
    expect(result.text).toBe("Answer");
    expect(result.segments[0]?.startSeconds).toBe(1.2);
  });
  it("preserves partial native data without an ASR fallback and isolates sessions", () => {
    const data = snapshot([fragment("a", "recipient", "Answer", 100)]);
    expect(assembleNativeTranscript(data, { ...capture, status: "collecting" })).toBeNull();
    expect(assembleNativeTranscript(data, { ...capture, status: "incomplete" })).toMatchObject({ text: "Answer", quality: { coverage: "partial", issues: [{ code: "legacy_incomplete" }] } });
    expect(assembleNativeTranscript(data, { ...capture, sessionId: "other" })).toMatchObject({ text: "", quality: { coverage: "unavailable" } });
    expect(assembleNativeTranscript(snapshot(data.transcript, "invalid"), capture)?.text).toBe("Answer");
  });
  it("preserves receive order even when alignment moves backwards", () => {
    const first = { ...fragment("a", "recipient", "Ja", 500, 1000), ingestionSequence: 1 };
    const second = { ...fragment("b", "recipient", ", ja", 400, 900), ingestionSequence: 3 };
    const result = assembleNativeTranscript(snapshot([second, first, second]), capture)!;
    expect(result.text).toBe("Ja, ja");
    expect(result.segments[0]).toMatchObject({ startSeconds: 0.4, endSeconds: 1 });
    expect(first.text).toBe("Ja");
  });
  it("keeps a receipt-backed disclaimer and a separate consent fact without inventing a recipient quote", () => {
    const applicationPlayback = { sessionId: "session", markId: "opening", sentAt: origin,
      acknowledgedAt: "2026-09-28T12:00:01.000Z", durationMs: 900 };
    const data = snapshot([{ ...fragment("opening", "assistant", "Darf ich aufzeichnen?", 0), nativeTiming: undefined, applicationPlayback }]);
    data.brief.lifecycle = { consent: "granted", consentAt: "2026-09-28T12:00:01.100Z", consentMethod: "dtmf" } as NonNullable<CallSnapshot["brief"]["lifecycle"]>;
    const result = assembleNativeTranscript(data, capture)!;
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ source: "application_playback", text: "Darf ich aufzeichnen?" });
    expect(result.segments[1]).toMatchObject({ role: "system", source: "consent_event", startSeconds: 1.1 });
    expect(result.segments[1].text).toContain("Telefontaste");
    expect(result.segments.some(segment => segment.role === "recipient")).toBe(false);
  });
});
