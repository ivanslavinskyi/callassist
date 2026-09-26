import { describe, expect, it } from "vitest";
import { answeringMessages } from "./i18n/answering-messages";
import { callResultCopy, callConsentLabel } from "./call-status";
import { callActivityPhase } from "./call-activity";
import { deriveCallLifecycle, emptyCallLifecycleCounts, countCallLifecycle, uiLocales, type AnsweringState } from "@callassist/contracts";

const answering: AnsweringState = { phase: "pending", policyVersion: "twilio-sync-beep-v1", mode: "Enable",
  answeredBy: null, decision: null, streamAdmitted: false, observedAt: "2026-09-26T12:00:00Z",
  durationMs: null, message: "not_requested", failure: null };
describe("answering presentation", () => {
  it("does not turn missing AMD into missing consent, and preserves no-answer", () => {
    const events = [{ callAttemptId: "attempt", sequence: 1, occurredAt: answering.observedAt,
      payload: { name: "answering.updated" as const, metadata: answering } }];
    const terminal = (providerStatus: "completed" | "no-answer") => deriveCallLifecycle("completed", [...events, {
      callAttemptId: "attempt", sequence: 2, occurredAt: answering.observedAt,
      payload: { name: "provider.status_changed", metadata: { providerStatus, callStatus: "completed", applied: true } }
    }, ...(providerStatus === "completed" ? [{ callAttemptId: "attempt", sequence: 3, occurredAt: answering.observedAt,
      payload: { name: "connection.confirmed" as const, metadata: { providerStatus: "completed" as const } } }] : [])]);
    expect(terminal("completed")).toMatchObject({ result: "answer_detection_failed", consent: "not_requested" });
    expect(terminal("no-answer").result).toBe("no_answer");
  });
  it("counts playback independently from conversations and goal assessment", () => {
    const counts = emptyCallLifecycleCounts();
    countCallLifecycle(counts, { ...deriveCallLifecycle("completed", []), result: "voicemail_detected",
      answering: { ...answering, phase: "resolved", answeredBy: "machine_end_beep", message: "playback_completed" } });
    expect(counts.results.voicemail_detected).toBe(1);
    expect(counts.messages?.playback_completed).toBe(1);
    expect(counts.conversations).toBe(0);
  });
  it.each(uiLocales)("uses explicit localized results and no invented consent in %s", locale => {
    const copy = answeringMessages[locale];
    expect(Object.keys(copy.results)).toHaveLength(5);
    for (const result of Object.keys(copy.results) as Array<keyof typeof copy.results>) {
      expect(callResultCopy[locale][result]).toEqual(copy.results[result]);
      if (locale !== "en") expect(copy.results[result][1]).not.toBe(answeringMessages.en.results[result][1]);
    }
    expect(callConsentLabel({ ...deriveCallLifecycle("completed", []), consent: "not_requested" }, locale, "fallback")).toBe(copy.notRequested);
  });
  it("distinguishes telephone connection, detection, consent and a machine response", () => {
    const lifecycle = { ...deriveCallLifecycle("in_progress", []), answering };
    expect(callActivityPhase("in_progress", false, "connected", lifecycle)).toBe("checking");
    expect(callActivityPhase("in_progress", false, "connected", { ...lifecycle, answering: { ...answering, phase: "resolved", answeredBy: "human", decision: "consent" } })).toBe("consent");
    expect(callActivityPhase("in_progress", false, "connected", { ...lifecycle, answering: { ...answering, phase: "resolved", answeredBy: "machine_start", decision: "hang_up" } })).toBe("machine");
    expect(callActivityPhase("completed", false, "connected", lifecycle)).toBeNull();
  });
});
