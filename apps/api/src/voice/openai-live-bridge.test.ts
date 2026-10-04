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
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const runtime = new OpenAILiveConversation({ apiKey: "test", service: call.service,
    validateStreamToken: () => true, createLiveSocket: connect, agentHangupEnabled: true, logger }, context);
  const started = runtime.start();
  await flush();
  socket.emit("open");
  if (start) { socket.startLive("live-test"); await started; }
  cleanup.push(async () => {
    runtime.close(); socket.receive({ type: "session.closed", usage: { seconds: 20 }, reason: "close_requested" });
    await flush(); await call.service.close();
  });
  let sequence = 0;
  const backend = (event: object, delegation = "delegation-1") => socket.receive({ type: "response.event", delegation_id: delegation, event });
  const begin = (id = `response-${++sequence}`) => { backend({ type: "response.created", response: { id } }); return id; };
  const item = (name: string, args: unknown, callId = `tool-${++sequence}`) => {
    const toolArgs = name === "end_call" && args && typeof args === "object" && !("resultSummary" in args)
      ? { ...args, resultSummary: "The recipient asked to end the call." }
      : args;
    backend({ type: "response.output_item.done", item: { type: "function_call", name, call_id: callId, arguments: JSON.stringify(toolArgs) } });
    return callId;
  };
  const finish = (id: string, status = "completed") => backend({ type: `response.${status}`, response: { id, status, output: [], model: "gpt-6-luna",
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 10, total_tokens: 110 } } });
  const tool = async (name: string, args: unknown) => { const id = begin(); const callId = item(name, args); finish(id); await flush(); return result(callId); };
  const result = (id: string) => JSON.parse(socket.sent.findLast(e => e.type === "response.item.create" && e.item.call_id === id).item.output);
  const recipientTurn = () => { runtime.inputAudio(speech); for (let i = 0; i < 30; i++) runtime.inputAudio(silence); };
  return { ...call, logger, socket, context, runtime, started, connect, completion, reserve, backend, begin, item, finish, tool, result, recipientTurn };
}

describe("native Live protocol and full duplex", () => {
  it.each([null, "cedar"])("rejects startup with an unconfirmed or wrong voice: %s", async voice => {
    const h = await harness(false, false);
    const rejected = expect(h.started).rejects.toThrow("LIVE_START_FAILED");
    h.socket.receive({ type: "session.started", session: { id: "bad-voice", audio: { output: { voice } } } });
    await rejected;
    expect(h.context.sendAudio).not.toHaveBeenCalled();
    expect(h.socket.readyState).toBe(3);
    expect(h.context.telemetry).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name: "realtime.voice", metadata: expect.objectContaining({ requestedVoice: "marin", result: voice ? "mismatch" : "unconfirmed" }) }));
  });
  it("does not accept a new session identity on an update even with the same voice", async () => {
    const h = await harness();
    h.socket.receive({ type: "session.updated", session: { id: "other-session", audio: { output: { voice: "marin" } } } });
    expect(h.context.fail).toHaveBeenCalledOnce();
    expect(h.socket.readyState).toBe(3);
  });
  it("starts the official endpoint, PCMU, GPT-6 Luna delegation and approved backend prompt", async () => {
    const h = await harness();
    expect(h.connect).toHaveBeenCalledWith("wss://api.openai.com/v1/live/sessions", "test");
    expect(h.socket.sent[0]).toMatchObject({ type: "session.start", session: { model: "gpt-live-1", store: false,
      audio: { format: { type: "audio/pcmu", rate: 8000 } }, delegation: { type: "responses", responses: { model: "gpt-6-luna", parallel_tool_calls: false } } } });
    expect(h.socket.sent[0].session.instructions).not.toContain("# Ordered questions");
    expect(h.socket.sent[0].session.instructions).toContain("You are Shprohli, an AI telephone assistant");
    expect(h.socket.sent[0].session.instructions).toContain("/ˈʃprox.li/");
    expect(h.socket.sent[0].session.instructions).toContain(`${h.snapshot.plan.addressingStyle} address`);
    expect(h.context.telemetry).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name: "realtime.ready",
      metadata: expect.objectContaining({ runtimeVersion: "live-managed-v9" }) }));
  });
  it("buffers bounded input until session.started and relays PCMU byte-for-byte", async () => {
    const h = await harness(false, false);
    h.runtime.inputAudio(silence);
    expect(h.socket.sent.filter(e => e.type === "session.input_audio.append")).toHaveLength(0);
    h.socket.startLive("live-test"); await h.started;
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
  it("fails closed on malformed audio or disconnect", async () => {
    for (const failure of ["audio", "disconnect"]) {
      const h = await harness();
      if (failure === "audio") h.runtime.inputAudio("invalid");
      else h.socket.close();
      expect(h.context.fail).toHaveBeenCalled();
      await flush();
      expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ usage: null }));
    }
  });
  it("keeps an active session alive for an unattributed or late command error and stores no provider message", async () => {
    const h = await harness();
    h.runtime.instruct("Listen.");
    const command = h.socket.sent.at(-1);
    h.socket.receive({ type: "session.instructions.appended", client_event_id: command.event_id });
    h.socket.receive({ type: "error", event_id: "provider-error-1", error: {
      type: "server_error", code: "output_interrupted", client_event_id: command.event_id,
      message: "private provider data"
    } });
    expect(h.context.fail).not.toHaveBeenCalled();
    expect(h.socket.readyState).toBe(1);
    expect(h.context.telemetry).toHaveBeenCalledWith(expect.any(String), { name: "realtime.error", metadata: expect.objectContaining({
      disposition: "continued", command: "session.instructions.append", clientEventId: command.event_id
    }) });
    expect(JSON.stringify(h.context.telemetry.mock.calls)).not.toContain("private provider data");
  });
  it("retries one rejected command and fails only when the retry is also rejected", async () => {
    const h = await harness();
    h.runtime.instruct("Listen.");
    const first = h.socket.sent.at(-1);
    h.socket.receive({ type: "error", event_id: "provider-error-1", error: {
      type: "invalid_request_error", code: "temporary_rejection", client_event_id: first.event_id
    } });
    const retry = h.socket.sent.at(-1);
    expect(retry).toMatchObject({ type: first.type, content: first.content });
    expect(retry.event_id).not.toBe(first.event_id);
    expect(h.context.fail).not.toHaveBeenCalled();
    h.socket.receive({ type: "error", event_id: "provider-error-2", error: {
      type: "invalid_request_error", code: "temporary_rejection", client_event_id: retry.event_id
    } });
    expect(h.context.fail).toHaveBeenCalledOnce();
    expect(h.context.telemetry.mock.calls.map(([, payload]) => payload.metadata.disposition)).toEqual(expect.arrayContaining(["retrying", "fatal"]));
  });
  it("correlates a function output without inventing a success acknowledgement", async () => {
    const h = await harness(); await h.tool("end_call", { reason: "recipient_requested_end" });
    const first = h.socket.sent.findLast(event => event.type === "response.item.create");
    expect(first?.event_id).toEqual(expect.any(String));
    h.socket.receive({ type: "error", event_id: "tool-output-error-1", error: {
      type: "invalid_request_error", code: "temporary_rejection", client_event_id: first.event_id
    } });
    const retry = h.socket.sent.findLast(event => event.type === "response.item.create");
    expect(retry).toMatchObject({ item: first.item });
    expect(retry.event_id).not.toBe(first.event_id);
    expect(h.context.fail).not.toHaveBeenCalled();
    h.socket.receive({ type: "error", event_id: "tool-output-error-2", error: {
      type: "invalid_request_error", code: "temporary_rejection", client_event_id: retry.event_id
    } });
    expect(h.context.fail).toHaveBeenCalledOnce();
    expect(h.context.telemetry).toHaveBeenCalledWith(expect.any(String), { name: "realtime.error", metadata: expect.objectContaining({
      command: "response.item.create", disposition: "fatal", attempt: 2
    }) });
  });
  it("does not duplicate an ambiguously accepted command after its acknowledgement times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = await harness();
    h.runtime.instruct("Listen once.");
    const commandsBeforeTimeout = h.socket.sent.filter(event => event.type === "session.instructions.append");
    expect(commandsBeforeTimeout).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.socket.sent.filter(event => event.type === "session.instructions.append")).toHaveLength(1);
    expect(h.context.fail).toHaveBeenCalledOnce();
    expect(h.context.telemetry).toHaveBeenCalledWith(expect.any(String), { name: "realtime.error", metadata: expect.objectContaining({
      disposition: "fatal", code: "ack_timeout", command: "session.instructions.append", attempt: 1
    }) });
  });
  it("rejects startup safely and never runs a conversation after cancellation", async () => {
    const h = await harness(false, false);
    const rejected = expect(h.started).rejects.toThrow("LIVE_START_FAILED");
    h.socket.receive({ type: "error" }); await rejected;
    expect(h.context.fail).not.toHaveBeenCalled();
    h.socket.startLive("late");
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
    expect(active.completion).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ rawUsage: expect.objectContaining({ finalized: false }) }) }));
  });
});

describe("Live usage ledger", () => {
  it("retains latest observed usage and unconfirmed status on connection loss", async () => {
    const h = await harness(); h.socket.receive({ type: "session.usage.updated", usage: { seconds: 12 } }); h.socket.close(); await flush();
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ durationSeconds: 12, rawUsage: expect.objectContaining({ finalized: false }) }) }));
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


describe("managed backend tools", () => {
  it("does not schedule a response for each recipient answer", async () => {
    const h = await harness(); h.recipientTurn();
    h.socket.receive({ type: "session.input_transcript.delta", event_id: "answer", delta: "It arrived.", start_ms: 0, end_ms: 100 }); await flush();
    expect(h.socket.sent.some(e => e.type === "response.create")).toBe(false);
  });
  it("does not invalidate backend work from acoustic activity without recipient semantics", async () => {
    const h = await harness();
    const id = h.begin();
    h.item("end_call", { reason: "recipient_requested_end" });
    h.runtime.inputAudio(speech);
    h.finish(id); await flush();
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
    for (let index = 0; index < 30; index++) h.runtime.inputAudio(silence);
    await flush();
    expect(h.context.requestFarewell).toHaveBeenCalledOnce();
  });
  it("collects completed function items despite empty response.output, returns all results then continues", async () => {
    const h = await harness(); await h.tool("end_call", { reason: "recipient_requested_end" });
    expect(h.context.requestFarewell).toHaveBeenCalledOnce();
    expect(h.socket.sent.at(-1).type).toBe("response.create");
    expect(h.socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ providerModel: "gpt-6-luna", usage: expect.objectContaining({ cachedInputTextTokens: 20 }) }));
  });
  it("does not execute the same function twice", async () => {
    const h = await harness(); const id = h.begin(); h.item("end_call", { reason: "recipient_requested_end" }, "same"); h.finish(id); await flush();
    const second = h.begin(); h.item("end_call", { reason: "recipient_requested_end" }, "same"); h.finish(second); await flush();
    expect(h.context.requestFarewell).toHaveBeenCalledOnce();
  });
  it("rejects a reused tool ID with different arguments", async () => {
    const h = await harness();
    const first = h.begin(); h.item("end_call", { reason: "recipient_requested_end" }, "collision"); h.finish(first); await flush();
    const second = h.begin(); h.item("end_call", { reason: "objective_resolved" }, "collision"); h.finish(second); await flush();
    expect(h.result("collision")).toMatchObject({ ok: false, reason: "tool_call_id_collision" });
    expect(h.context.requestFarewell).toHaveBeenCalledOnce();
  });
  it("returns a result for every unexpected parallel call without executing any effect", async () => {
    const h = await harness(); const id = h.begin();
    const first = h.item("end_call", { reason: "recipient_requested_end" });
    const second = h.item("end_call", { reason: "objective_resolved" });
    h.finish(id); await flush();
    expect(h.result(first).ok).toBe(false); expect(h.result(second).ok).toBe(false);
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
    expect(h.socket.sent.at(-1).type).toBe("response.create");
    expect(h.socket.sent.filter(e => e.type === "response.item.create")).toHaveLength(2);
  });
  it("accounts late completion after close without executing its tool", async () => {
    const h = await harness(); const id = h.begin(); h.item("end_call", { reason: "objective_resolved" });
    h.runtime.close(); h.finish(id); h.finish(id); await flush();
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
    expect(h.completion.mock.calls.filter(([value]) => value.providerResponseId === id)).toHaveLength(1);
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ providerResponseId: id,
      outcome: "succeeded", usage: expect.objectContaining({ inputTextTokens: 100, outputTextTokens: 10 }) }));
  });
  it.each(["failed", "incomplete", "cancelled"])("accounts %s backend work without executing proposed tools", async status => {
    const h = await harness(); const id = h.begin(); h.item("end_call", { reason: "objective_resolved" });
    h.finish(id, status); await flush();
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
    expect(h.context.fail).toHaveBeenCalled();
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ providerResponseId: id, outcome: "provider_error" }));
  });
  it("rejects stale actions after recipient speech", async () => {
    const h = await harness(); const id = h.begin(); h.item("end_call", { reason: "recipient_requested_end" });
    h.recipientTurn();
    h.socket.receive({ type: "session.input_transcript.delta", event_id: "correction", delta: "Wait.", start_ms: 0, end_ms: 100 });
    h.finish(id); await flush();
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
  });
  it("does not execute tools if ledger persistence failed", async () => {
    const h = await harness(); h.completion.mockRejectedValue(new Error("DB"));
    const id = h.begin(); h.item("end_call", { reason: "recipient_requested_end" }); h.finish(id); await flush(); await flush();
    expect(h.context.requestFarewell).not.toHaveBeenCalled();
  });
  it("accounts incomplete backend work without inventing usage", async () => {
    const h = await harness(); h.begin(); h.socket.close(); await flush();
    expect(h.completion).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "LIVE_DELEGATION_INTERRUPTED", usage: null }));
  });
  it("context acknowledgement does not mean playback completion", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = await harness(); h.runtime.instruct("Listen."); const command = h.socket.sent.at(-1);
    h.socket.receive({ type: "session.instructions.appended", client_event_id: command.event_id });
    await vi.advanceTimersByTimeAsync(15_001); expect(h.context.fail).not.toHaveBeenCalled(); expect(h.context.requestFarewell).not.toHaveBeenCalled();
  });
});
