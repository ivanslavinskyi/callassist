import { describe, expect, it } from "vitest";
import type { CallBrief, CallLifecycle } from "@callassist/contracts";
import { formatCallDuration, formatCallTime } from "./call-time";

describe("call duration", () => {
  const lifecycle: CallLifecycle = {
    result: "conversation_completed", eventSequence: 5,
    attemptedAt: "2026-09-17T09:55:00.000Z", ringingAt: "2026-09-17T09:55:05.000Z",
    connected: true, connectedAt: "2026-09-17T10:00:00.000Z",
    disclosureAt: null, consent: "granted", consentAt: "2026-09-17T10:00:10.000Z",
    conversationStartedAt: "2026-09-17T10:00:12.000Z", substantiveAnswerConfirmed: true,
    endedAt: "2026-09-17T10:02:37.000Z", stopRequestedBy: null, endedBy: "unknown", credit: "used"
  };
  const brief: Pick<CallBrief, "status" | "lifecycle"> = { status: "completed", lifecycle };

  it("counts connected time including consent, excluding ringing", () => {
    expect(formatCallDuration(brief)).toBe("2:37");
    expect(formatCallDuration({ ...brief, status: "stopped" })).toBe("2:37");
  });
  it("does not invent duration for unanswered, legacy, or active calls", () => {
    expect(formatCallDuration({ status: "completed" })).toBeNull();
    expect(formatCallDuration({ ...brief, lifecycle: { ...lifecycle, connectedAt: null } })).toBeNull();
    expect(formatCallDuration({ ...brief, lifecycle: { ...lifecycle, endedAt: null } })).toBeNull();
    expect(formatCallDuration({ ...brief, status: "in_progress" })).toBeNull();
  });
  it("handles zero duration, hours, and malformed or reversed timestamps", () => {
    const durationUntil = (endedAt: string) => formatCallDuration({ ...brief, lifecycle: { ...lifecycle, endedAt } });
    expect(durationUntil(lifecycle.connectedAt!)).toBe("0:00");
    expect(durationUntil("2026-09-17T11:02:03.000Z")).toBe("1:02:03");
    expect(durationUntil("2026-09-17T09:59:00.000Z")).toBeNull();
    expect(durationUntil("invalid")).toBeNull();
  });
});

describe("localized call time", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  it("formats recent calls relatively", () => {
    expect(formatCallTime("2026-08-17T10:00:00.000Z", "en", now).relative).toBe("2 hours ago");
  });
  it("uses the selected UI locale", () => {
    expect(formatCallTime("2026-08-16T12:00:00.000Z", "de", now).relative).toBe("gestern");
  });
});
