import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeBridge } from "../realtime/openai-realtime-bridge";
import { OpenAILiveBridge } from "./openai-live-bridge";
import { createVoiceRuntime, voiceRuntimeDriver } from "./create-voice-runtime";
import { approvedCall, TestSocket, flush, silence, speech } from "./voice-test-helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function harness(driver = "live", recordingFailure = false, token = "valid", fallback = "true") {
  const call = await approvedCall();
  const twilio = new TestSocket(), realtime = new TestSocket(), consent = new TestSocket(), live = new TestSocket();
  const startRecording = vi.spyOn(call.service, "startRecordingAfterConsent").mockImplementation(async () => {
    if (recordingFailure) throw new Error("recording failed");
    return (await call.service.get(call.brief.id))!;
  });
  const prepareHangup = vi.spyOn(call.service, "prepareAgentHangup").mockResolvedValue(true);
  const connect = vi.fn(() => live.ws);
  const bridge = createVoiceRuntime({ apiKey: "test", service: call.service, agentHangupEnabled: true,
    validateStreamToken: (_binding, value) => value === "valid", createOpenAISocket: () => realtime.ws,
    createConsentSocket: () => consent.ws, createLiveSocket: connect },
    { VOICE_RUNTIME_DRIVER: driver, VOICE_RUNTIME_LIVE_FALLBACK: fallback });
  bridge.handleTwilioSocket(twilio.ws);
  const start = { event: "start", start: { streamSid: "MZ-LIVE", customParameters: {
    callBriefId: call.brief.id, callAttemptId: call.attempt.id, compilationSnapshotHash: call.attempt.compilationSnapshotHash, streamToken: token } } };
  twilio.receive(start); await flush();
  realtime.emit("open"); consent.emit("open");
  realtime.receive({ type: "session.updated" }); consent.receive({ type: "session.updated" });
  async function accept() {
    realtime.receive({ type: "response.done" });
    twilio.receive({ event: "mark", mark: { name: "callassist-consent-prompt-complete" } });
    consent.receive({ type: "conversation.item.input_audio_transcription.completed", transcript: "Yes" });
    await flush();
    if (!recordingFailure) {
      realtime.receive({ type: "response.created", response: { id: "opening" } });
      realtime.receive({ type: "response.done", response: { id: "opening", status: "completed" } });
      twilio.receive({ event: "mark", mark: { name: "callassist-opening-complete" } }); await flush();
    }
  }
  async function ready() {
    await accept(); live.emit("open"); live.receive({ type: "session.started", session: { id: "live-integration" } }); await flush();
  }
  cleanup.push(async () => { twilio.close(); live.receive({ type: "session.closed", usage: { seconds: 12 } }); await flush(); await call.service.close(); });
  return { ...call, bridge, twilio, realtime, consent, live, connect, startRecording, prepareHangup, accept, ready, start };
}

describe("voice runtime selection and consent gate integration", () => {
  it("defaults to unchanged Realtime and explicitly selects Live", async () => {
    expect(voiceRuntimeDriver({})).toBe("realtime");
    expect((await harness("realtime")).bridge).toBeInstanceOf(OpenAIRealtimeBridge);
    expect((await harness()).bridge).toBeInstanceOf(OpenAILiveBridge);
    expect(() => voiceRuntimeDriver({ VOICE_RUNTIME_DRIVER: "typo" })).toThrow("VOICE_RUNTIME_DRIVER");
  });
  it("never connects Live or forwards caller audio before consent, recording and opening playback", async () => {
    const h = await harness();
    h.twilio.receive({ event: "media", media: { payload: speech } });
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.startRecording).not.toHaveBeenCalled();
    await h.accept();
    expect(h.startRecording).toHaveBeenCalledOnce();
    expect(h.connect).toHaveBeenCalledOnce();
    h.twilio.receive({ event: "mark", mark: { name: "callassist-opening-complete" } });
    expect(h.connect).toHaveBeenCalledOnce();
  });
  it("rejects unauthorized media streams and duplicate asynchronous starts", async () => {
    const h = await harness("live", false, "invalid");
    expect(h.twilio.readyState).toBe(3); expect(h.connect).not.toHaveBeenCalled();
    const valid = await harness(); valid.twilio.receive(valid.start); await flush();
    await valid.accept(); expect(valid.connect).toHaveBeenCalledOnce();
  });
  it("keeps consent failure and recording failure out of Live", async () => {
    const h = await harness();
    h.realtime.receive({ type: "response.done" });
    h.twilio.receive({ event: "mark", mark: { name: "callassist-consent-prompt-complete" } });
    h.consent.receive({ type: "conversation.item.input_audio_transcription.completed", transcript: "No" });
    expect(h.startRecording).not.toHaveBeenCalled(); expect(h.connect).not.toHaveBeenCalled();
    const failure = await harness("live", true); await failure.accept();
    expect(failure.connect).not.toHaveBeenCalled();
  });
  it("relays native Live audio without sending caller input to both runtimes", async () => {
    const h = await harness(); await h.ready();
    h.twilio.receive({ event: "media", media: { payload: silence } });
    expect(h.live.sent.at(-1)).toMatchObject({ type: "session.input_audio.append", audio: silence });
    expect(h.realtime.sent.filter(e => e.type === "input_audio_buffer.append")).toHaveLength(0);
    h.live.receive({ type: "session.output_audio.delta", delta: silence });
    expect(h.twilio.sent.at(-1)).toMatchObject({ event: "media", streamSid: "MZ-LIVE", media: { payload: silence } });
  });
  it.each(["error", "session.closed"])("falls back to the prepared Realtime session on startup %s", async type => {
    const h = await harness(); await h.accept();
    h.live.emit("open"); h.live.receive({ type, usage: { seconds: 0 }, reason: "startup_failed" }); await flush();
    expect(h.twilio.readyState).toBe(1);
    expect(h.startRecording).toHaveBeenCalledOnce();
    h.twilio.receive({ event: "media", media: { payload: silence } });
    expect(h.realtime.sent.at(-1)).toMatchObject({ type: "input_audio_buffer.append", audio: silence });
    expect(h.realtime.sent.some(e => e.type === "session.update" && e.session.tools?.some((t: any) => t.name === "end_call"))).toBe(true);
    expect(h.realtime.sent.filter(e => e.type === "response.create").at(-1).response.instructions).toContain("mandatory opening already played");
  });
  it("can disable startup fallback; never silently restarts a running Live conversation", async () => {
    const startup = await harness("live", false, "valid", "false"); await startup.accept(); startup.live.receive({ type: "error" }); await flush();
    expect(startup.twilio.readyState).toBe(3);
    const active = await harness(); await active.ready(); active.live.close(); await flush();
    expect(active.twilio.readyState).toBe(3);
    expect(active.realtime.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  });
  it.each([false, true])("requires an uncleared Twilio farewell mark to disconnect (interrupted=%s)", async (interrupted) => {
    const h = await harness(); await h.ready();
    const backend = (event: object) => h.live.receive({ type: "response.event", delegation_id: "d", event });
    backend({ type: "response.created", response: { id: "end" } });
    backend({ type: "response.output_item.done", item: { type: "function_call", name: "end_call", call_id: "end-tool", arguments: '{"reason":"recipient_requested_end"}' } });
    backend({ type: "response.completed", response: { id: "end", status: "completed", output: [] } });
    await flush();
    const farewell = h.realtime.sent.filter(e => e.type === "response.create").at(-1);
    expect(farewell.response.metadata.farewell_generation).toBe("1");
    h.realtime.receive({ type: "response.created", response: { id: "farewell", metadata: { farewell_generation: "1" } } });
    h.realtime.receive({ type: "response.output_audio.delta", response_id: "farewell", delta: silence });
    h.realtime.receive({ type: "response.done", response: { id: "farewell", status: "completed" } });
    const mark = h.twilio.sent.filter(e => e.event === "mark").at(-1).mark.name;
    expect(h.prepareHangup).not.toHaveBeenCalled();
    if (interrupted) h.twilio.receive({ event: "media", media: { payload: speech } });
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect(h.prepareHangup).toHaveBeenCalledTimes(interrupted ? 0 : 1);
    if (interrupted) expect(h.twilio.sent.filter(e => e.event === "clear").length).toBeGreaterThan(0);
  });
});
