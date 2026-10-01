import type { CallSnapshot } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { currentCallSnapshot } from "./current-call-snapshot";
import { deriveCallLifecycle } from "@callassist/contracts";

const current = { brief: { id: "call", updatedAt: "2026-09-09T12:00:00Z" }, compilation: { revision: 2 },
  languageContext: { taskContentLanguage: "uk", selectionRevision: 3, compilationRevision: 2 }
} as CallSnapshot;
describe("late call responses", () => {
  it("keeps sources independent when an older poll arrives after Live or ASR completes", () => {
    const live={id:'live',status:'completed',updatedAt:'2026-10-01T12:01:00Z',text:'Live'};
    const asr={id:'asr',status:'completed',updatedAt:'2026-10-01T12:02:00Z',text:'ASR'};
    const newer={...current,finalTranscript:live,recordingTranscript:asr,finalTranscriptRevision:{id:'live-r'},recordingTranscriptRevision:{id:'asr-r'}} as CallSnapshot;
    const older={...newer,recordingTranscript:{...asr,status:'processing',updatedAt:'2026-10-01T12:00:00Z'},recordingTranscriptRevision:null} as CallSnapshot;
    expect(currentCallSnapshot(newer,older).recordingTranscriptRevision?.id).toBe('asr-r');
    expect(currentCallSnapshot(newer,older).finalTranscript?.text).toBe('Live');
  });
  it("does not undo a final assessment when an earlier read completes late", () => {
    const base=deriveCallLifecycle("completed",[]);
    const assessment={status:"ready" as const,conversation:"confirmed" as const,goal:"achieved" as const,reason:null,
      deadlineAt:null,updatedAt:"2026-09-15T16:30:10.000Z",transcriptRevisionId:null,evaluatorVersion:"test"};
    const ready={...current,brief:{...current.brief,lifecycle:{...base,result:"conversation_completed" as const,credit:"used" as const,assessment}}};
    const pending={...current,brief:{...current.brief,lifecycle:{...base,result:"assessment_pending" as const,credit:"reserved" as const,
      assessment:{...assessment,status:"pending" as const,updatedAt:"2026-09-15T16:30:00.000Z"}}}};
    expect(currentCallSnapshot(ready,pending).brief.lifecycle).toEqual(ready.brief.lifecycle);
    expect(currentCallSnapshot(pending,ready).brief.lifecycle).toEqual(ready.brief.lifecycle);
  });
  it("preserves a ledger settlement when its secondary event has not arrived yet", () => {
    const lifecycle = { ...deriveCallLifecycle("completed", []), eventSequence: 12, credit: "used" as const, substantiveAnswerConfirmed: true };
    const newer = { ...current, brief: { ...current.brief, lifecycle } };
    const earlier = { ...current, brief: { ...current.brief, lifecycle: { ...lifecycle, credit: "reserved" as const, substantiveAnswerConfirmed: false } } };
    expect(currentCallSnapshot(newer, earlier).brief.lifecycle?.credit).toBe("used");
  });
  it("does not regress lifecycle evidence when brief timestamps are equal", () => {
    const newer = { ...current, brief: { ...current.brief, lifecycle: { ...deriveCallLifecycle("completed", []), eventSequence: 12 } } };
    const earlier = { ...current, brief: { ...current.brief, lifecycle: { ...deriveCallLifecycle("completed", []), eventSequence: 10 } } };
    expect(currentCallSnapshot(newer, earlier).brief.lifecycle?.eventSequence).toBe(12);
  });
  it("ignores an earlier compilation even when its request completes later", () => {
    expect(currentCallSnapshot(current, { ...current, compilation: { ...current.compilation!, revision: 1 } })).toBe(current);
  });
  it("accepts status updates without undoing a newer manual language selection", () => {
    const incoming = { ...current, languageContext: { ...current.languageContext!, taskContentLanguage: "ru" as const, selectionRevision: 2 } };
    expect(currentCallSnapshot(current, incoming).languageContext?.taskContentLanguage).toBe("uk");
  });
  it("accepts removal of sensitive content after deletion", () => {
    const removed = { ...current, compilation: null, languageContext: null };
    expect(currentCallSnapshot(current, removed)).toBe(removed);
  });
});
