import { describe, expect, it } from "vitest";
import type { CallSnapshot, TranscriptSegment } from "@callassist/contracts";
import { assembleNativeTranscript, type NativeTranscriptCapture } from "./native-transcript";

const origin = "2026-09-28T12:00:00.000Z";
const capture: NativeTranscriptCapture = { version: 1, sessionId: "session", model: "gpt-live-1", status: "complete", updatedAt: origin };
function fragment(eventId: string, role: "recipient" | "assistant", text: string, startMs: number, endMs = startMs + 100): TranscriptSegment {
  return { id: eventId, role, text, final: true, createdAt: origin,
    nativeTiming: { sessionId: "session", eventId, sessionStartedAt: origin, startMs, endMs } } as TranscriptSegment;
}
function snapshot(transcript: TranscriptSegment[], startedAt = origin) {
  return { transcript, recording: { startedAt } } as CallSnapshot;
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
    expect(result.segments[2]).toMatchObject({ text: closing.text, source: "application_playback", startSeconds: 1.1, endSeconds: 2, applicationPlayback });
  });
  it("preserves words and whitespace, orders late fragments and deduplicates event IDs", () => {
    const second = fragment("b", "recipient", " хочу жареной картошки", 300);
    const result = assembleNativeTranscript(snapshot([second, fragment("a", "recipient", "М-м, я", 100), second,
      fragment("c", "recipient", ", да, да.", 500), fragment("d", "assistant", "Понял.", 450)]), capture)!;
    expect(result.text).toBe("М-м, я хочу жареной картошки, да, да.\nПонял.");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ startSeconds: 0.1, endSeconds: 0.6 });
  });
  it("excludes disclosure, pre-consent and crossing fragments using the audio boundary", () => {
    const result = assembleNativeTranscript(snapshot([fragment("a", "assistant", "Disclosure", 100),
      fragment("b", "recipient", "Yes", 950, 1050), fragment("c", "recipient", "Answer", 1200)],
      "2026-09-28T12:00:01.000Z"), capture)!;
    expect(result.text).toBe("Answer");
    expect(result.segments[0]?.startSeconds).toBe(0.2);
  });
  it("leaves a real fallback for incomplete captures, missing origins and other sessions", () => {
    const data = snapshot([fragment("a", "recipient", "Answer", 100)]);
    expect(assembleNativeTranscript(data, { ...capture, status: "collecting" })).toBeNull();
    expect(assembleNativeTranscript(data, { ...capture, status: "incomplete" })).toBeNull();
    expect(assembleNativeTranscript(data, { ...capture, sessionId: "other" })).toBeNull();
    expect(assembleNativeTranscript(snapshot(data.transcript, "invalid"), capture)).toBeNull();
  });
});
