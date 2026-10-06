import { describe, expect, it } from "vitest";
import type { CallEvent, CallSnapshot, TranscriptSegment } from "@callassist/contracts";
import { applyLiveTranscriptEvent, emptyLiveTranscript, mergeTranscriptSegments, liveTranscriptRows } from "./live-transcript-state";
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


it("keeps the 28-fragment opening in one stable card across every persistence acknowledgment", () => {
  let state = emptyLiveTranscript(); const saved: TranscriptSegment[] = [];
  const parts = Array.from({ length: 28 }, (_, i) => ({ ...segment(`id-${i}`), text: ` word${i}`,
    createdAt: new Date(Date.parse("2026-09-27T10:00:00Z") + i * 200).toISOString(),
    nativeTiming: { sessionId: "session", eventId: `event-${i}`, sessionStartedAt: "2026-09-27T10:00:00.000Z", startMs: i * 200, endMs: (i + 1) * 200 } }));
  for (const [i, part] of parts.entries()) state = applyLiveTranscriptEvent(state, { ...delta(`key-${i}`, part.text), type: "transcript.delta", nativeTiming: part.nativeTiming } as CallEvent);
  const initial = liveTranscriptRows(saved, state);
  expect(initial).toHaveLength(1);
  for (const [i, part] of parts.entries()) {
    saved.push(part);
    // HTTP snapshot can arrive before the SSE acknowledgment.
    expect(liveTranscriptRows(saved, state)[0].text).toBe(initial[0].text);
    state = applyLiveTranscriptEvent(state, { type: "transcript.added", key: `key-${i}`, segment: part });
    const rows = liveTranscriptRows(saved, state);
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(initial[0].id); expect(rows[0].text).toBe(initial[0].text);
  }
});

it("keeps streamed words after the saved prefix when persistence arrives later than speech", () => {
  let state = emptyLiveTranscript();
  const saved: TranscriptSegment[] = [];
  const parts = ["Good", " morning", ", how", " can", " I help?"];
  let cardId: string | undefined;
  for (const [i, text] of parts.entries()) {
    const nativeTiming = { sessionId: "delayed", eventId: `word-${i}`, sessionStartedAt: "2026-10-06T13:41:19.000Z", startMs: 16400 + i * 200, endMs: 16600 + i * 200 };
    const part: TranscriptSegment = { ...segment(`saved-${i}`), text, nativeTiming,
      createdAt: new Date(Date.parse(nativeTiming.sessionStartedAt) + nativeTiming.startMs).toISOString(),
      receivedAt: new Date(Date.parse(nativeTiming.sessionStartedAt) + nativeTiming.startMs + 2500).toISOString(), ingestionSequence: 100 + i };
    state = applyLiveTranscriptEvent(state, { ...delta(`stream-${i}`, text), nativeTiming } as CallEvent);
    const streaming = liveTranscriptRows(saved, state);
    cardId ??= streaming[0].id;
    expect(streaming.map(row => row.text)).toEqual([parts.slice(0, i + 1).join("")]);
    expect(streaming[0].id).toBe(cardId);
    saved.push(part);
    expect(liveTranscriptRows(saved, state)).toMatchObject([{ id: cardId, text: parts.slice(0, i + 1).join("") }]);
    state = applyLiveTranscriptEvent(state, { type: "transcript.added", key: `stream-${i}`, segment: part });
    expect(liveTranscriptRows(saved, state)).toMatchObject([{ id: cardId, text: parts.slice(0, i + 1).join("") }]);
  }
});
