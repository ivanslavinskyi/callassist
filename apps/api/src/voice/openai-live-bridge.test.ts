import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAILiveConversation } from "./openai-live-bridge";
import { approvedCall, authorization, proposal, TestSocket, flush, silence, speech } from "./voice-test-helpers";
import { liveResponsesUsage } from "./live-usage";
import { PcmuActivity } from "./pcmu-activity";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });

async function harness(appointment = false, start = true) {
  const call = await approvedCall(appointment ? authorization : undefined);
  const socket = new TestSocket();
  let closing = false;
  const context = {
    brief: call.brief, snapshot: structuredClone(call.snapshot), attemptId: call.attempt.id,
    sendAudio: vi.fn(), clearPlayback: vi.fn(),
    requestFarewell: vi.fn(() => { closing = true; return true; }),
    interruptFarewell: vi.fn(() => { const was = closing; closing = false; return was; }),
    isClosing: () => closing, telemetry: vi.fn(), fail: vi.fn()
  };
  const completion = vi.spyOn(call.service, "completeProviderOperation");
  const reserve = vi.spyOn(call.service, "recordRealtimeProviderOperation");
  const connect = vi.fn(() => socket.ws);
  const runtime = new OpenAILiveConversation({ apiKey: "test", service: call.service,
    validateStreamToken: () => true, createLiveSocket: connect, agentHangupEnabled: true }, context);
  const started = runtime.start();
  await flush();
  socket.emit("open");
  if (start) { socket.receive({ type: "session.started", session: { id: "live-test", model: "gpt-live-1" } }); await started; }
  cleanup.push(async () => {
    runtime.close(); socket.receive({ type: "session.closed", usage: { seconds: 20 }, reason: "close_requested" });
    await flush(); await call.service.close();
  });
  let sequence = 0;
  const backend = (event: object, delegation = "delegation-1") => socket.receive({ type: "response.event", delegation_id: delegation, event });
  const begin = (id = `response-${++sequence}`) => { backend({ type: "response.created", response: { id } }); return id; };
  const item = (name: string, args: unknown, callId = `tool-${++sequence}`) => {
    backend({ type: "response.output_item.done", item: { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) } });
    return callId;
  };
  const finish = (id: string, status = "completed") => backend({ type: `response.${status}`, response: { id, status, output: [], model: "gpt-6-luna",
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 10, total_tokens: 110 } } });
  const tool = async (name: string, args: unknown) => { const id = begin(); const callId = item(name, args); finish(id); await flush(); return result(callId); };
  const result = (id: string) => JSON.parse(socket.sent.findLast(e => e.type === "response.item.create" && e.item.call_id === id).item.output);
  const recipientTurn = () => { runtime.inputAudio(speech); for (let i = 0; i < 30; i++) runtime.inputAudio(silence); };
  return { ...call, socket, context, runtime, started, connect, completion, reserve, backend, begin, item, finish, tool, result, recipientTurn };
}

describe("native Live protocol and full duplex", () => {
  it("starts the official endpoint, PCMU, GPT-6 Luna delegation and approved backend prompt", async () => {
    const h = await harness();
    expect(h.connect).toHaveBeenCalledWith("wss://api.openai.com/v1/live/sessions", "test");
    expect(h.socket.sent[0]).toMatchObject({ type: "session.start", session: { model: "gpt-live-1", store: false,
      audio: { format: { type: "audio/pcmu", rate: 8000 } }, delegation: { type: "responses", responses: { model: "gpt-6-luna", parallel_tool_calls: false } } } });
    expect(h.socket.sent[0].session.delegation.responses.instructions).not.toContain("The recipient has not consented yet");
    expect(h.socket.sent[0].session.instructions).not.toContain("# Ordered questions");
    expect(h.socket.sent[0].session.delegation.responses.instructions).toContain("# Ordered questions");
  });
  it("buffers bounded input until session.started and relays PCMU byte-for-byte", async () => {
    const h = await harness(false, false);
    h.runtime.inputAudio(silence);
    expect(h.socket.sent.filter(e => e.type === "session.input_audio.append")).toHaveLength(0);
    h.socket.receive({ type: "session.started", session: { id: "live-test" } }); await h.started;
    expect(h.socket.sent.at(-1)).toMatchObject({ type: "session.input_audio.append", audio: silence });
    h.socket.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.context.sendAudio).toHaveBeenCalledWith(speech);
    expect(h.socket.sent.some(e => ["input_audio_buffer.append", "response.cancel", "conversation.item.create"].includes(e.type))).toBe(false);
  });
  it("keeps input and output running simultaneously, clearing queued audio on local speech onset", async () => {
    const h = await harness();
    h.runtime.inputAudio(speech);
    h.socket.receive({ type: "session.output_audio.delta", delta: silence });
    expect(h.context.clearPlayback).toHaveBeenCalledOnce();
    expect(h.context.sendAudio).toHaveBeenCalledWith(silence);
    expect(h.socket.sent.at(-1)).toMatchObject({ type: "session.input_audio.append", audio: speech });
  });
  it("does not infer speech or completion from silence, backend completion or transcript gaps", async () => {
    const h = await harness();
    h.runtime.inputAudio(silence);
    const id = h.begin(); h.finish(id);
    expect(h.context.clearPlayback).not.toHaveBeenCalled();
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
    expect(h.socket.sent.filter(e => e.type === "response.create")).toHaveLength(0);
  });
  it("preserves overlapping and late native transcript fragments, timestamps and spaces without duplication", async () => {
    const h = await harness();
    const persist = vi.spyOn(h.service, "addNativeLiveTranscript");
    const fragment = { type: "session.input_transcript.delta", event_id: "in1", delta: " to change", start_ms: 1100, end_ms: 1400 };
    h.socket.receive(fragment);
    h.socket.receive({ type: "session.output_transcript.delta", event_id: "out1", delta: "Yes yes", start_ms: 1000, end_ms: 1300 });
    h.socket.receive(fragment);
    h.socket.receive({ type: "session.input_transcript.delta", event_id: "in0", delta: "I want", start_ms: 700, end_ms: 1000 });
    await flush();
    expect(persist).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenCalledWith(h.brief.id, "recipient", " to change", expect.stringContaining(":recipient:1100:1400:in1"), expect.objectContaining({ startMs: 1100, endMs: 1400, sessionId: "live-test" }));
    const stored = await h.repository.get(h.brief.id);
    expect(stored!.transcript.map(t => t.text)).toContain(" to change");
  });
  it("fails closed on malformed audio, provider error or disconnect", async () => {
    for (const failure of ["audio", "error", "disconnect"]) {
      const h = await harness();
      if (failure === "audio") h.runtime.inputAudio("invalid");
      else if (failure === "error") h.socket.receive({ type: "error", error: { message: "private provider data" } });
      else h.socket.close();
      expect(h.context.fail).toHaveBeenCalled();
      await flush();
      expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ outcome: "network_error", errorCode: "LIVE_FINAL_USAGE_UNCONFIRMED" }));
    }
  });
  it("rejects startup safely and never runs a conversation after cancellation", async () => {
    const h = await harness(false, false);
    const rejected = expect(h.started).rejects.toThrow("LIVE_START_FAILED");
    h.socket.receive({ type: "error" }); await rejected;
    expect(h.context.fail).not.toHaveBeenCalled();
    h.socket.receive({ type: "session.started", session: { id: "late" } });
    h.socket.receive({ type: "session.output_audio.delta", delta: silence });
    expect(h.context.sendAudio).not.toHaveBeenCalled();
  });
  it("bounds startup and final usage waiting without inventing successful usage", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const startup = await harness(false, false);
    const rejected = expect(startup.started).rejects.toThrow("LIVE_START_FAILED");
    await vi.advanceTimersByTimeAsync(8_000); await rejected;
    expect(startup.socket.readyState).toBe(3);
    const active = await harness();
    active.socket.receive({ type: "session.usage.updated", usage: { seconds: 9 } });
    active.runtime.close(); await vi.advanceTimersByTimeAsync(15_000); await flush();
    expect(active.completion).toHaveBeenCalledWith(expect.objectContaining({ outcome: "network_error", usage: expect.objectContaining({ rawUsage: expect.objectContaining({ finalized: false }) }) }));
  });
});

describe("application-owned delegation controls", () => {
  it("does not execute tool effects if ledger persistence fails or new speech arrives during a write", async () => {
    const failed = await harness();
    failed.reserve.mockRejectedValueOnce(new Error("database unavailable"));
    const id = failed.begin(); failed.item("end_call", { reason: "recipient_requested_end" }); failed.finish(id); await flush();
    expect(failed.context.requestFarewell).not.toHaveBeenCalled();
    expect(failed.context.fail).toHaveBeenCalled();
    const interrupted = await harness();
    let release!: () => void;
    interrupted.completion.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const run = interrupted.begin(); const tool = interrupted.item("end_call", { reason: "recipient_requested_end" }); interrupted.finish(run); await flush();
    interrupted.recipientTurn(); release(); await flush();
    expect(interrupted.result(tool).ok).toBe(false);
    expect(interrupted.context.requestFarewell).not.toHaveBeenCalled();
  });
  it("accepts an affirmative keypad confirmation only after appointment authorization", async () => {
    const h = await harness(true);
    h.runtime.keypad("1");
    await h.tool("check_appointment", proposal);
    expect(await h.tool("end_call", { reason: "objective_resolved" })).toMatchObject({ ok: false });
    h.runtime.keypad("2");
    expect(await h.tool("end_call", { reason: "objective_resolved" })).toMatchObject({ ok: false });
    h.runtime.keypad("1");
    expect(await h.tool("end_call", { reason: "objective_resolved" })).toMatchObject({ ok: true });
  });
  it("collects output items, ignores argument-done alone, waits for completion, returns results then continues", async () => {
    const h = await harness(true); const id = h.begin();
    h.backend({ type: "response.function_call_arguments.done", arguments: JSON.stringify(proposal) });
    const call = h.item("check_appointment", proposal);
    expect(h.socket.sent.some(e => e.type === "response.item.create")).toBe(false);
    h.finish(id); await flush();
    expect(h.result(call)).toMatchObject({ ok: true, actionCompleted: false });
    expect(h.socket.sent.at(-1)).toMatchObject({ type: "response.create" });
    expect(h.socket.sent.at(-1).response).toBeUndefined();
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
  });
  it("rejects appointments outside the immutable approved authorization and without confirmation", async () => {
    const h = await harness(true);
    expect(await h.tool("check_appointment", { ...proposal, startTime: "19:00" })).toMatchObject({ ok: false, reason: "outside_authorized_window" });
    expect(await h.tool("check_appointment", { ...proposal, detailsConfirmed: false })).toMatchObject({ ok: false, reason: "unconfirmed_details" });
    expect(await h.tool("check_appointment", { ...proposal, requiresPaymentOrNewTerms: true })).toMatchObject({ ok: false, reason: "financial_terms_not_allowed" });
    const noAuthorization = await harness();
    expect(await noAuthorization.tool("check_appointment", proposal)).toMatchObject({ ok: false, reason: "missing_authorization" });
  });
  it("requires a recipient turn after authorization, prevents duplicate booking and uses application farewell", async () => {
    const h = await harness(true);
    expect(await h.tool("check_appointment", proposal)).toMatchObject({ ok: true });
    expect(await h.tool("end_call", { reason: "objective_resolved" })).toMatchObject({ ok: false, reason: "appointment_confirmation_required" });
    expect(await h.tool("check_appointment", proposal)).toMatchObject({ ok: false, reason: "appointment_already_authorized" });
    h.recipientTurn();
    h.socket.receive({ type: "session.input_transcript.delta", event_id: "confirmed", delta: "Yes, the appointment is confirmed.", start_ms: 1000, end_ms: 1500 });
    expect(await h.tool("end_call", { reason: "objective_resolved" })).toMatchObject({ ok: true });
    expect(h.context.requestFarewell).toHaveBeenCalledOnce();
    h.socket.receive({ type: "session.output_audio.delta", delta: silence });
    expect(h.context.sendAudio).not.toHaveBeenCalled();
  });
  it("rejects stale, concurrent and replayed functions", async () => {
    const h = await harness(true); const stale = h.begin(); const call = h.item("check_appointment", proposal);
    h.recipientTurn(); h.finish(stale); await flush();
    expect(h.result(call).ok).toBe(false);
    const multi = h.begin(); const a = h.item("check_appointment", proposal); const b = h.item("end_call", { reason: "recipient_requested_end" }); h.finish(multi); await flush();
    expect(h.result(a).ok).toBe(false); expect(h.result(b).ok).toBe(false);
    const repeat = h.begin(); h.item("check_appointment", proposal, call); h.finish(repeat); await flush();
    expect(h.result(call).ok).toBe(false);
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
  });
  it("interrupts closing, rejects stale ending, routes new questions and requires a fresh end_call", async () => {
    const h = await harness();
    await h.tool("end_call", { reason: "recipient_requested_end" });
    h.recipientTurn();
    expect(h.context.interruptFarewell).toHaveBeenCalledOnce();
    expect((await h.tool("end_call", { reason: "recipient_requested_end" })).ok).toBe(false);
    expect(await h.tool("route_interrupted_closing", { action: "answer" })).toMatchObject({ ok: true });
    h.socket.receive({ type: "session.output_audio.delta", delta: silence });
    expect(h.context.sendAudio).toHaveBeenCalledWith(silence);
    await h.tool("end_call", { reason: "recipient_requested_end" });
    expect(h.context.requestFarewell).toHaveBeenCalledTimes(2);
  });
  it("does not execute tools from failed responses or after shutdown", async () => {
    const h = await harness(); const id = h.begin(); h.item("end_call", { reason: "recipient_requested_end" }); h.finish(id, "failed");
    const next = h.begin(); h.item("end_call", { reason: "recipient_requested_end" }); h.runtime.close(); h.finish(next);
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
  });
});

describe("Live usage ledger", () => {
  it("records cumulative voice duration once and delegates tokens independently, including late close usage", async () => {
    const h = await harness(); const id = h.begin(); h.finish(id); h.finish(id);
    h.socket.receive({ type: "session.usage.updated", usage: { seconds: 12 } });
    h.socket.receive({ type: "session.usage.updated", usage: { seconds: 15 } });
    h.runtime.close();
    expect(h.socket.sent.at(-1).type).toBe("session.close");
    h.socket.receive({ type: "session.closed", usage: { seconds: 15.5 }, reason: "close_requested" });
    await flush();
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.completion).toHaveBeenCalledTimes(2);
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ providerModel: "gpt-6-luna", usage: expect.objectContaining({ inputTextTokens: 100, cachedInputTextTokens: 20, outputTextTokens: 10 }) }));
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ providerModel: "gpt-live-1", usage: expect.objectContaining({ durationSeconds: 15.5, rawUsage: expect.objectContaining({ finalized: true }) }) }));
  });
  it("retains latest observed usage and unconfirmed status on connection loss", async () => {
    const h = await harness(); h.socket.receive({ type: "session.usage.updated", usage: { seconds: 12 } }); h.socket.close(); await flush();
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ outcome: "network_error", usage: expect.objectContaining({ durationSeconds: 12, rawUsage: expect.objectContaining({ finalized: false }) }) }));
  });
  it("uses final provider seconds as authoritative instead of retaining a higher provisional estimate", async () => {
    const h = await harness();
    h.socket.receive({ type: "session.usage.updated", usage: { seconds: 12 } });
    h.runtime.close(); h.socket.receive({ type: "session.closed", usage: { seconds: 11.5 }, reason: "close_requested" }); await flush();
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded", usage: expect.objectContaining({ durationSeconds: 11.5 }) }));
  });
  it("rejects impossible usage and never stores provider text in the ledger", () => {
    expect(liveResponsesUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 4 })).toBeNull();
    expect(liveResponsesUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 3, input_tokens_details: { cached_tokens: 5 } })).toBeNull();
    expect(JSON.stringify(liveResponsesUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 3, private_text: "SECRET" }))).not.toContain("SECRET");
  });
});

it("PCMU activity requires sustained energy and silence without altering audio", () => {
  const activity = new PcmuActivity();
  const quiet = Buffer.from(silence, "base64");
  expect(activity.push(quiet)).toBeNull();
  expect(activity.push(Buffer.from(speech, "base64"))).toBe("started");
  for (let i = 0; i < 29; i++) expect(activity.push(quiet)).toBeNull();
  expect(activity.push(quiet)).toBe("stopped");
  expect(quiet.toString("base64")).toBe(silence);
});
