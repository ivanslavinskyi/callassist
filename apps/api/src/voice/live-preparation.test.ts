import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAILiveBridge } from "./openai-live-bridge";
import { approvedCall, TestSocket, flush, silence } from "./voice-test-helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0)) await stop(); vi.useRealTimers(); });
async function fixture() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const call = await approvedCall(); const live = new TestSocket(); const twilio = new TestSocket();
  const connect = vi.fn(() => live.ws);
  const complete = vi.spyOn(call.service, "completeProviderOperation");
  const speechFetch = vi.fn<typeof fetch>(async () => new Response(Buffer.alloc(4_800)));
  const runtime = new OpenAILiveBridge({ apiKey: "test", service: call.service, agentHangupEnabled: true,
    createLiveSocket: connect, speechFetch, validateStreamToken: (_binding, token) => token === "valid" });
  const binding = { callBriefId: call.brief.id, callAttemptId: call.attempt.id,
    compilationSnapshotHash: call.snapshot.compilationSnapshotHash, providerCallId: "CA-LIVE" };
  cleanup.push(async () => { twilio.close(); runtime.close(); live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 5 } }); await flush(); await call.service.close(); });
  async function warm() { const promise = runtime.prepareCall(binding); await flush(); live.emit("open");
    live.startLive("prepared-session"); await promise; }
  function attach(token = "valid") { runtime.handleTwilioSocket(twilio.ws); twilio.receive({ event: "connected" });
    twilio.receive({ event: "start", start: { callSid: "CA-LIVE", streamSid: "MZ", customParameters: { ...binding, streamToken: token } } }); }
  return { ...call, live, twilio, connect, complete, runtime, binding, warm, attach };
}

describe("attempt-bound Live preparation", () => {
  it("warms without task, tools or speech; adopts the same session only after human admission", async () => {
    const h = await fixture(); await h.warm(); await vi.advanceTimersByTimeAsync(100);
    expect(h.live.sent.filter(e => e.type === "session.instructions.append")).toHaveLength(0);
    expect(h.live.sent.find(e => e.type === "session.input_audio.append").audio).toBe(silence);
    expect(JSON.stringify(h.live.sent)).not.toContain(h.snapshot.plan.localizedObjective);
    await h.runtime.prepareCall(h.binding); expect(h.connect).toHaveBeenCalledOnce();
    await h.repository.transitionAnswering(h.brief.id, { attemptId: h.attempt.id, providerCallId: "CA-LIVE", snapshotHash: h.snapshot.compilationSnapshotHash,
      kind: "resolve", answeredBy: "human", now: new Date().toISOString() });
    h.attach(); await flush();
    expect(h.connect).toHaveBeenCalledOnce();
    expect(h.live.sent.filter(e => e.type === "session.instructions.append")).toHaveLength(0);
    const mark = h.twilio.sent.find(e => e.event === "mark")?.mark.name;
    expect(mark).toMatch(/^rendered-consent-required:/);
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect(h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses.tools.map((t: {name: string}) => t.name)).toEqual(["report_consent"]);
    const count = h.live.sent.filter(e => e.type === "session.input_audio.append").length;
    await vi.advanceTimersByTimeAsync(100);
    expect(h.live.sent.filter(e => e.type === "session.input_audio.append")).toHaveLength(count);
    await h.runtime.prepareCall(h.binding); expect(h.connect).toHaveBeenCalledOnce();
  });
  it.each(["machine_start", "fax"])("never speaks or admits prepared audio for explicit non-human result %s", async answer => {
    const h = await fixture(); await h.warm();
    await h.repository.transitionAnswering(h.brief.id, { attemptId: h.attempt.id, providerCallId: "CA-LIVE", snapshotHash: h.snapshot.compilationSnapshotHash,
      kind: "resolve", answeredBy: answer, now: new Date().toISOString() });
    h.attach(); await flush();
    expect(h.twilio.readyState).toBe(3);
    expect(h.live.sent.some(e => e.type === "session.instructions.append")).toBe(false);
      expect(h.live.sent.some(e => e.type === "session.close")).toBe(true);
  });
  it("admits prepared audio and starts disclosure for an inconclusive current-policy result", async () => {
    const h = await fixture(); await h.warm();
    await h.repository.transitionAnswering(h.brief.id, { attemptId: h.attempt.id, providerCallId: "CA-LIVE", snapshotHash: h.snapshot.compilationSnapshotHash,
      kind: "resolve", answeredBy: "unknown", now: new Date().toISOString() });
    h.attach(); await flush();
    expect(h.twilio.readyState).toBe(1);
    expect(h.live.sent.some(e => e.type === "session.close")).toBe(false);
    expect(h.twilio.sent.some(e => e.event === "mark" && String(e.mark.name).startsWith("rendered-consent-required:"))).toBe(true);
  });
  it("does not consume a prepared session for a forged binding", async () => {
    const h = await fixture(); await h.warm(); h.attach("invalid"); await flush();
    expect(h.twilio.readyState).toBe(3);
    expect(h.live.sent.some(e => e.type === "session.close")).toBe(false);
  });
  it.each(["expiry", "terminal", "shutdown"])("closes unused sessions on %s and accounts final waiting duration", async reason => {
    const h = await fixture(); await h.warm();
    if (reason === "expiry") await vi.advanceTimersByTimeAsync(45_001);
    else if (reason === "terminal") h.runtime.releasePrepared(h.attempt.id);
    else h.runtime.close();
    expect(h.live.sent.filter(e => e.type === "session.close")).toHaveLength(1);
    h.live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12.5 } }); await flush();
    expect(h.complete).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded", usage: expect.objectContaining({ durationSeconds: 12.5 }) }));
  });
  it("rejects stale attempts before opening a provider socket", async () => {
    const h = await fixture(); await h.runtime.prepareCall({ ...h.binding, callAttemptId: "other" });
    expect(h.connect).not.toHaveBeenCalled();
  });
});


it("handles a Twilio socket error before its start frame without opening a provider", async () => {
  const h = await fixture(); h.runtime.handleTwilioSocket(h.twilio.ws);
  expect(() => h.twilio.emit("error", new Error("transport error"))).not.toThrow();
  expect(h.twilio.readyState).toBe(3);
  expect(h.connect).not.toHaveBeenCalled();
});
