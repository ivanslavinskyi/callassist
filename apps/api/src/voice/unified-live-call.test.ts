import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRuntime } from "./create-voice-runtime";
import { approvedCall, authorization, TestSocket, flush, silence, speech } from "./voice-test-helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });

async function harness(answer: string | null = "human", recordingFailure = false, appointment = false) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const call = await approvedCall(appointment ? authorization : undefined);
  if (answer) await call.repository.transitionAnswering(call.brief.id, { attemptId: call.attempt.id, providerCallId: "CA-LIVE",
    snapshotHash: call.snapshot.compilationSnapshotHash, kind: "resolve", answeredBy: answer, now: new Date().toISOString() });
  const twilio = new TestSocket(), live = new TestSocket();
  const legacy = vi.fn(() => { throw new Error("Realtime must not connect"); });
  const connect = vi.fn(() => live.ws);
  const recording = vi.spyOn(call.service, "startRecordingAfterConsent").mockImplementation(async () => {
    if (recordingFailure) throw new Error("recording failed");
    return (await call.service.get(call.brief.id))!;
  });
  const hangup = vi.spyOn(call.service, "prepareAgentHangup").mockResolvedValue(true);
  const bridge = createVoiceRuntime({ apiKey: "test", service: call.service, agentHangupEnabled: true,
    validateStreamToken: (_binding, token) => token === "valid", createLiveSocket: connect,
    createOpenAISocket: legacy, createConsentSocket: legacy }, { VOICE_RUNTIME_DRIVER: "live" });
  bridge.handleTwilioSocket(twilio.ws);
  const start = { event: "start", start: { callSid: "CA-LIVE", streamSid: "MZ", customParameters: { callBriefId: call.brief.id,
    callAttemptId: call.attempt.id, compilationSnapshotHash: call.snapshot.compilationSnapshotHash, streamToken: "valid" } } };
  twilio.receive(start); await flush();
  live.emit("open"); live.receive({ type: "session.started", session: { id: "one-live" } }); await flush();
  let time = 0;
  function transcript(role: "input" | "output", text: string) {
    live.receive({ type: `session.${role}_transcript.delta`, delta: text, start_ms: time, end_ms: time += 100 });
  }
  function requestedSpeech() {
    const instruction = live.sent.filter(e => e.type === "session.instructions.append").at(-1)?.content as string;
    return instruction.match(/<speech>([\s\S]*)<\/speech>/)?.[1] ?? "";
  }
  async function play(acknowledge = true) {
    const text = requestedSpeech();
    expect(text).not.toBe("");
    transcript("output", text);
    live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(501);
    const mark = twilio.sent.filter(e => e.event === "mark").at(-1)?.mark.name;
    expect(mark).toBeTruthy();
    if (acknowledge) twilio.receive({ event: "mark", mark: { name: mark } });
    await flush();
    return mark as string;
  }
  async function accept() {
    await play();
    transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(601); await flush();
    if (!recordingFailure) await play();
  }
  async function tool(name: string, args: object, id = "tool-1") {
    await vi.advanceTimersByTimeAsync(601);
    const envelope = (event: object) => live.receive({ type: "response.event", delegation_id: id, event });
    envelope({ type: "response.created", response: { id } });
    envelope({ type: "response.completed", response: { id, status: "completed", output: [
      { type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }
    ] } });
    await flush();
    return JSON.parse(live.sent.findLast(e => e.type === "response.item.create" && e.item.call_id === id)?.item.output ?? "{}");
  }
  cleanup.push(async () => { twilio.close(); live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12 } }); await flush(); await call.service.close(); });
  return { ...call, twilio, live, legacy, connect, recording, hangup, transcript, requestedSpeech, play, accept, tool, start };
}

describe("one Live session, application-owned lifecycle", () => {
  it("starts with minimal consent context, PCMU and no task/tools; never opens Realtime", async () => {
    const h = await harness();
    const session = h.live.sent.find(e => e.type === "session.start").session;
    expect(session.audio.format).toEqual({ type: "audio/pcmu", rate: 8000 });
    expect(session.delegation.responses).toMatchObject({ tools: [], tool_choice: "none", parallel_tool_calls: false });
    expect(JSON.stringify(session)).not.toContain(h.snapshot.plan.localizedObjective);
    h.twilio.receive({ event: "media", media: { payload: silence } });
    expect(h.live.sent.at(-1)).toMatchObject({ type: "session.input_audio.append", audio: silence });
    await h.accept();
    expect(h.recording).toHaveBeenCalledOnce();
    expect(h.connect).toHaveBeenCalledOnce(); expect(h.legacy).not.toHaveBeenCalled();
    expect(h.live.sent.find(e => e.type === "session.update").session.delegation.responses.tools.some((t: { name: string }) => t.name === "end_call")).toBe(true);
    expect(h.live.sent.find(e => e.type === "session.update").session.delegation.type).toBe("responses");
  });
  it.each([null, "machine_start", "unknown", "fax"])("rejects non-human AMD %s before provider startup", async answer => {
    const h = await harness(answer);
    expect(h.connect).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(3);
  });
  it("does not grant for pre-playback speech or fabricated marks and never persists pre-consent transcripts", async () => {
    const h = await harness();
    h.transcript("input", "Yes");
    h.twilio.receive({ event: "mark", mark: { name: "live-speech:fake" } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.recording).not.toHaveBeenCalled();
    expect((await h.service.get(h.brief.id))!.transcript).toEqual([]);
    expect(await h.tool("end_call", { reason: "objective_resolved", recap: [] })).toMatchObject({ ok: false });
  });
  it("requires complete expected text and a real playback mark, not backend completion", async () => {
    const h = await harness();
    h.transcript("output", h.requestedSpeech().slice(0, 20));
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(900);
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(1);
    expect(h.twilio.sent.filter(e => e.event === "mark")).toEqual([]);
  });
  it("stops on mismatching controlled text without playing it", async () => {
    const h = await harness(); h.transcript("output", "I booked your appointment.");
    expect(h.twilio.readyState).toBe(3); expect(h.recording).not.toHaveBeenCalled();
  });
  it("completes controlled speech despite continuous native silence packets", async () => {
    const h = await harness();
    h.transcript("output", h.requestedSpeech());
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    for (let i = 0; i < 30; i++) {
      h.live.receive({ type: "session.output_audio.delta", delta: silence });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(h.twilio.sent.filter(e => e.event === "mark")).toHaveLength(1);
    expect(h.recording).not.toHaveBeenCalled();
  });
  it("waits for the complete answer and handles negation before recording", async () => {
    const h = await harness(); await h.play();
    h.twilio.receive({ event: "media", media: { payload: speech } });
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(900);
    expect(h.recording).not.toHaveBeenCalled();
    h.transcript("input", ", but do not record.");
    for (let i = 0; i < 30; i++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(601);
    expect(h.recording).not.toHaveBeenCalled();
    expect(h.requestedSpeech()).toContain("cannot continue");
  });
  it("does not enable tools or persist transcripts when recording fails", async () => {
    const h = await harness("human", true); await h.accept();
    expect(h.requestedSpeech()).toContain("recording could not");
    expect(h.live.sent.some(e => e.type === "session.update")).toBe(false);
  });
  it("streams native transcripts and unchanged audio after consent, with full-duplex clear", async () => {
    const h = await harness(); await h.accept();
    h.transcript("input", "We received the application yesterday.");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.at(-1)).toMatchObject({ event: "media", media: { payload: speech } });
    h.twilio.receive({ event: "media", media: { payload: speech } });
    expect(h.twilio.sent.at(-1).event).toBe("clear"); await flush();
    expect((await h.service.get(h.brief.id))!.transcript.some(segment => segment.text.includes("yesterday") && segment.nativeTiming)).toBe(true);
  });
  it("requires recipient evidence for a recap and appointment confirmation remains enforced", async () => {
    const h = await harness("human", false, true); await h.accept();
    expect(await h.tool("end_call", { reason: "objective_resolved", recap: ["You are booked for tomorrow."] })).toMatchObject({ ok: false });
    h.transcript("input", "Your appointment is confirmed for tomorrow.");
    expect(await h.tool("end_call", { reason: "objective_resolved", recap: ["Your appointment is confirmed for tomorrow."] }, "tool-2"))
      .toMatchObject({ ok: false, reason: "appointment_confirmation_required" });
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("cannot remove a negation by selecting a substring of recipient evidence", async () => {
    const h = await harness(); await h.accept();
    h.transcript("input", "It is not true that your appointment is confirmed for tomorrow.");
    expect(await h.tool("end_call", { reason: "objective_resolved", recap: ["your appointment is confirmed for tomorrow."] }))
      .toMatchObject({ ok: false, reason: "recipient_evidence_required" });
  });
  it.each([false, true])("reads the recap before farewell; an interruption cancels every pending mark (interrupt=%s)", async interrupted => {
    const h = await harness(); await h.accept();
    h.transcript("input", "We received your application yesterday.");
    expect(await h.tool("end_call", { reason: "objective_resolved", recap: ["We received your application yesterday."] })).toMatchObject({ ok: true });
    expect(h.requestedSpeech()).toContain("I have noted");
    const mark = await h.play(!interrupted);
    if (interrupted) {
      h.twilio.receive({ event: "media", media: { payload: speech } });
      h.twilio.receive({ event: "mark", mark: { name: mark } });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(h.hangup).not.toHaveBeenCalled();
    } else {
      await vi.advanceTimersByTimeAsync(1_501);
      expect(h.requestedSpeech()).toContain("Goodbye");
      expect(h.hangup).not.toHaveBeenCalled();
      await h.play(); expect(h.hangup).toHaveBeenCalledOnce();
    }
  });
  it("closes on disconnect instead of opening a second runtime", async () => {
    const h = await harness(); await h.accept(); h.live.close(); await flush();
    expect(h.twilio.readyState).toBe(3); expect(h.legacy).not.toHaveBeenCalled();
  });
});
