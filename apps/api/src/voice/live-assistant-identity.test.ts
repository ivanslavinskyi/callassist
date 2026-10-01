import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_PROFILES, LIVE_VOICES, SUPPORTED_CALL_LOCALES, createApprovedExecutionSnapshot } from "@callassist/contracts";
import { buildLiveInstructions } from "./live-conversation";
import { approvedCall } from "./voice-test-helpers";
import type { VoiceConversationContext } from "./voice-runtime";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

describe("Live product identity", () => {
  it.each(ASSISTANT_PROFILES)("uses one name for new and historical $id approvals in every call language", async profile => {
    const call = await approvedCall(undefined, undefined, "en-GB", "CA-LIVE", profile.id);
    cleanup.push(() => call.service.close());
    expect(call.brief.agentName).toBe("Shprohli");
    expect(call.snapshot.runtime.agentName).toBe("Shprohli");
    expect(call.snapshot.runtime.liveVoice).toBe(LIVE_VOICES[profile.voiceGender]);
    const stored = (await call.service.get(call.brief.id))!;
    const newApproval = createApprovedExecutionSnapshot({ ...stored, brief: { ...stored.brief, agentName: profile.displayName } });
    expect(newApproval.runtime.agentName).toBe("Shprohli");

    for (const locale of SUPPORTED_CALL_LOCALES) {
      const legacy = structuredClone(call.snapshot);
      legacy.runtime.agentName = profile.displayName;
      legacy.plan.callLocale = locale;
      const before = JSON.stringify(legacy);
      const context: VoiceConversationContext = {
        brief: { ...call.brief, agentName: profile.displayName }, snapshot: legacy, attemptId: call.attempt.id,
        sendAudio: vi.fn(), clearPlayback: vi.fn(), requestFarewell: () => true,
        interruptFarewell: () => false, isClosing: () => false, telemetry: vi.fn(), fail: vi.fn()
      };
      for (const consentComplete of [false, true]) {
        const instructions = buildLiveInstructions(context, consentComplete);
        expect(instructions).toContain("You are Shprohli, an AI telephone assistant");
        expect(instructions).toContain("/ˈʃprox.li/");
        expect(instructions).toContain(`Speak ${locale}`);
        expect(instructions).not.toContain(profile.displayName);
        expect(instructions).toContain(call.brief.recipientName);
        expect(instructions).toContain(call.brief.representedPerson);
        if (!consentComplete) expect(instructions).toContain("stay silent and listen");
      }
      expect(JSON.stringify(legacy)).toBe(before);
      expect(legacy.runtime.liveVoice).toBe(LIVE_VOICES[profile.voiceGender]);
    }
  });

  it("preserves a participant whose name matches a legacy persona", async () => {
    const call = await approvedCall(); cleanup.push(() => call.service.close());
    // This fixture represents an old approval without frozen spoken identities.
    delete call.snapshot.runtime.spokenIdentities;
    const instructions = buildLiveInstructions({
      brief: { ...call.brief, recipientName: "Sebastian", representedPerson: "Anna Keller" },
      snapshot: call.snapshot, attemptId: call.attempt.id, sendAudio: vi.fn(), clearPlayback: vi.fn(),
      requestFarewell: () => true, interruptFarewell: () => false, isClosing: () => false, telemetry: vi.fn(), fail: vi.fn()
    });
    expect(instructions).toContain("You are Shprohli, an AI telephone assistant calling Sebastian on behalf of Anna Keller.");
  });
});
