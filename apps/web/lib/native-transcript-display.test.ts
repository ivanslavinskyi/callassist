import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@callassist/contracts";
import { emptyLiveTranscript, groupNativeTranscriptSegments, liveTranscriptRows } from "./live-transcript-state";
import { transcriptDisplayText } from "./assistant-identity";

const fragment = (id: string, role: "assistant" | "recipient", text: string, startMs: number, endMs: number): TranscriptSegment => ({
  id, role, text, locale: "en-GB", final: true,
  createdAt: new Date(Date.UTC(2026, 8, 25) + startMs).toISOString(),
  nativeTiming: { sessionId: "live-1", eventId: id, sessionStartedAt: "2026-09-25T00:00:00.000Z", startMs, endMs }
});
describe("native transcript display", () => {
  it("shows the brand spelling after joining a fragmented introduction without changing evidence", () => {
    const fragments = [fragment("1", "assistant", "Grüezi, ich bin Schpro", 0, 300), fragment("2", "assistant", "chli, ein KI-Assistent.", 300, 1000)];
    const original = structuredClone(fragments);
    const rows = liveTranscriptRows(fragments, emptyLiveTranscript());
    expect(rows.map(transcriptDisplayText)).toEqual(["Grüezi, ich bin Shprohli, ein KI-Assistent."]);
    expect(rows[0].text).toContain("Schprochli");
    expect(fragments).toEqual(original);
  });
  it("leaves other speakers, other people's names and longer words unchanged", () => {
    const segments = [
      { role: "recipient", text: "Ich bin Schprochli." },
      { role: "unknown", text: "Ich bin Schprochli." },
      { role: "system", text: "Ich bin Schprochli." },
      { role: "assistant", text: "Ich rufe Frau Schprochli an." },
      { role: "assistant", text: "Ich bin Schprochlin." },
      { role: "assistant", text: "Ich bin Shprohli." }
    ];
    expect(segments.map(transcriptDisplayText)).toEqual(segments.map(segment => segment.text));
  });
  it("joins late, overlapping fragments by speaker without trimming or losing repetition", () => {
    const fragments = [fragment("3", "assistant", " yes", 500, 800), fragment("1", "assistant", "Yes", 100, 600), fragment("2", "recipient", "wait", 400, 700)];
    const original = structuredClone(fragments);
    expect(groupNativeTranscriptSegments(fragments).map(row => row.text)).toEqual(["Yes yes", "wait"]);
    expect(fragments).toEqual(original);
  });
  it("keeps separate sessions, speech gaps and legacy utterances separate", () => {
    const legacy = { ...fragment("old", "assistant", "Opening", 0, 0), nativeTiming: undefined };
    const fragments = [legacy, fragment("1", "assistant", "Yes", 500, 800), fragment("2", "assistant", "Later", 3000, 3500),
      { ...fragment("3", "assistant", "New call", 3501, 3600), nativeTiming: { ...fragment("3", "assistant", "", 3501, 3600).nativeTiming!, sessionId: "live-2" } }];
    expect(groupNativeTranscriptSegments(fragments).map(row => row.text)).toEqual(["Opening", "Yes", "Later", "New call"]);
  });
});
