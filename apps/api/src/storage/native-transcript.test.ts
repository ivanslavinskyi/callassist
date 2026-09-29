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
