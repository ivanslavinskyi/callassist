import { describe, expect, it, vi } from "vitest";
import { liveRuntimeDescriptor } from "./runtime-descriptor";
import { UnifiedLiveCall } from "./unified-live-call";
import { approvedCall, flush, TestSocket } from "./voice-test-helpers";
import type { VoiceConversationContext } from "./voice-runtime";
import { voiceConsentRuntimePolicy } from "@callassist/contracts";

describe("immutable runtime descriptor boundary", () => {
  it("keeps user content and arbitrary environment values out of the descriptor", async () => {
    const call = await approvedCall();
    try {
      const snapshot = (await call.service.get(call.brief.id))!;
      const context = { brief: snapshot.brief, snapshot: call.snapshot } as VoiceConversationContext;
      const models = { live: "gpt-live-1", delegation: "gpt-6-luna", speech: "gpt-4o-mini-tts" };
      const descriptor = liveRuntimeDescriptor(context, snapshot.compilation!, "private runtime instructions Nina Keller",
        models, { SHPROHLI_RELEASE_SHA: "not-a-release-secret" });
      expect(descriptor.releaseSha).toBeNull();
      expect(descriptor.runtimeVersion).toBe("live-managed-v9");
      expect(descriptor.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(descriptor)).not.toMatch(/Nina|Keller|private runtime|not-a-release-secret|41710000001/);
      expect(liveRuntimeDescriptor(context, snapshot.compilation!, "private runtime instructions Nina Keller", models,
        { SHPROHLI_RELEASE_SHA: "A".repeat(40) }).releaseSha).toBe("a".repeat(40));
      const policy = voiceConsentRuntimePolicy("hybrid_deterministic_v1", 3);
      expect(liveRuntimeDescriptor(context, snapshot.compilation!, "instructions", models, {}, policy).consentPolicy)
        .toEqual(policy);
    } finally { await call.service.close(); }
  });

  it.each(["warmup", "admission"] as const)("does not start providers after cancellation during %s descriptor persistence", async path => {
    const call = await approvedCall();
    await call.service.transitionAnswering(call.brief.id, { attemptId: call.attempt.id, providerCallId: "CA-LIVE",
      snapshotHash: call.snapshot.compilationSnapshotHash, kind: "resolve", answeredBy: "human", now: new Date().toISOString() });
    let release!: () => void;
    const pendingWrite = new Promise<void>(resolve => { release = resolve; });
    const write = vi.spyOn(call.service, "recordRuntimeDescriptor").mockReturnValue(pendingWrite);
    const connect = vi.fn(() => new TestSocket().ws);
    const speechFetch = vi.fn<typeof fetch>();
    const socket = new TestSocket();
    const live = new UnifiedLiveCall({ apiKey: "test", service: call.service, validateStreamToken: () => true,
      createLiveSocket: connect, speechFetch }, socket.ws);
    let preparation: Promise<void> | undefined;
    try {
      const binding = { callBriefId: call.brief.id, callAttemptId: call.attempt.id,
        compilationSnapshotHash: call.snapshot.compilationSnapshotHash, providerCallId: "CA-LIVE" };
      if (path === "warmup") preparation = live.prepare(binding);
      else {
        live.attach();
        socket.receive({ event: "start", start: { callSid: "CA-LIVE", streamSid: "MZ",
          customParameters: { ...binding, streamToken: "valid" } } });
      }
      await flush(); expect(write).toHaveBeenCalledOnce();
      live.dispose(); release(); await preparation; await flush();
      expect(live.closed).toBe(true);
      expect(connect).not.toHaveBeenCalled(); expect(speechFetch).not.toHaveBeenCalled();
    } finally { release(); live.dispose(); await call.service.close(); }
  });
});
