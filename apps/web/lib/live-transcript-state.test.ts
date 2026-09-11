import { describe, expect, it } from "vitest";
import type { CallEvent, CallSnapshot, TranscriptSegment } from "@callassist/contracts";
import { applyLiveTranscriptEvent, emptyLiveTranscript, mergeTranscriptSegments } from "./live-transcript-state";
import { currentCallSnapshot } from "./current-call-snapshot";

const segment = (id: string, seconds = "01"): TranscriptSegment => ({ id, role: "assistant", text: id, locale: "en-GB", final: true, createdAt: `2026-09-11T00:00:${seconds}.000Z` });
const delta = (key: string, text: string): CallEvent => ({ type: "transcript.delta", key, delta: text, role: "assistant", locale: "en-GB" });
describe("streaming transcript continuity", () => {
  it("finalizes only the matching part, retains another same-speaker turn and ignores late deltas", () => {
    let state = applyLiveTranscriptEvent(emptyLiveTranscript(), delta("first", "First"));
    state = applyLiveTranscriptEvent(state, delta("second", "Second"));
    state = applyLiveTranscriptEvent(state, { type: "transcript.added", key: "first", segment: segment("final-first") });
    expect(state.partials).toEqual({ second: { role: "assistant", locale: "en-GB", text: "Second" } });
    expect(applyLiveTranscriptEvent(state, delta("first", " stale"))).toBe(state);
    expect(applyLiveTranscriptEvent(state, { type: "transcript.added", segment: segment("system") })).toBe(state);
    expect(applyLiveTranscriptEvent(state, delta("second", " continues")).partials.second?.text).toBe("Second continues");
  });

  it("deduplicates snapshots and preserves final segments delivered during reconnect", () => {
    const first = segment("one"); const second = segment("two", "02");
    expect(mergeTranscriptSegments([first, second], [first])).toEqual([first, second]);
    expect(mergeTranscriptSegments([second], [first, second])).toEqual([first, second]);
    const current = { brief: { id: "call", updatedAt: "2026-09-11T00:00:00.000Z" }, compilation: { revision: 1 }, transcript: [first, second] } as CallSnapshot;
    expect(currentCallSnapshot(current, { ...current, transcript: [first] }).transcript).toEqual([first, second]);
    expect(currentCallSnapshot(current, { ...current, compilation: null, transcript: [] }).transcript).toEqual([]);
  });
  it("discards an interrupted partial without erasing another turn or reviving late text", () => {
    let state = applyLiveTranscriptEvent(emptyLiveTranscript(), delta("cancelled", "Let me"));
    state = applyLiveTranscriptEvent(state, delta("new", "An answer"));
    state = applyLiveTranscriptEvent(state, {type:"transcript.discarded",key:"cancelled"});
    expect(Object.keys(state.partials)).toEqual(["new"]);
    expect(applyLiveTranscriptEvent(state,delta("cancelled"," check"))).toBe(state);
  });
});
