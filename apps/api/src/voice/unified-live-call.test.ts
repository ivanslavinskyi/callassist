import type { CallLocale, AssistantProfileId } from "@callassist/contracts";
import { ANSWERING_POLICY_VERSION } from "@callassist/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRuntime } from "./create-voice-runtime";
import { approvedCall, authorization, proposal, TestSocket, flush, silence, speech } from "./voice-test-helpers";


const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });

async function harness(answer: string | null = "human", recordingFailure = false, appointment = false, locale: CallLocale = "en-GB", asyncAnswering = false, profile: AssistantProfileId = "anna", assistanceReason: "none" | "speech_impairment" = "speech_impairment") {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  const call = await approvedCall(appointment ? authorization : undefined, undefined, locale, "CA-LIVE", profile, assistanceReason);
  if (asyncAnswering) await call.repository.appendCallTelemetryEvent(call.brief.id, { callAttemptId: call.attempt.id,
    idempotencyKey: "async-pending", payload: { name: "answering.updated", metadata: { policyVersion: ANSWERING_POLICY_VERSION,
      phase: "pending", execution: "async", mode: "Enable", answeredBy: null, decision: null, streamAdmitted: false,
      observedAt: new Date().toISOString(), durationMs: null, message: "not_requested", failure: null } } });
  if (answer) await call.repository.transitionAnswering(call.brief.id, { attemptId: call.attempt.id, providerCallId: "CA-LIVE",
    snapshotHash: call.snapshot.compilationSnapshotHash, kind: "resolve", answeredBy: answer, now: new Date().toISOString() });
  const twilio = new TestSocket(), live = new TestSocket();
  live.autoAcknowledge = true;
  const legacy = vi.fn(() => { throw new Error("Realtime must not connect"); });
  const connect = vi.fn(() => live.ws);
  const recording = vi.spyOn(call.service, "startRecordingAfterConsent").mockImplementation(async () => {
    if (recordingFailure) throw new Error("recording failed");
    return (await call.service.get(call.brief.id))!;
  });
  const providerOperation = vi.spyOn(call.service, "recordRealtimeProviderOperation");
  const hangup = vi.spyOn(call.service, "prepareAgentHangup").mockResolvedValue(true);
  const dispatch = vi.spyOn(call.service, "dispatchAsyncAnswering").mockResolvedValue(true);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const speechRequests: Array<{ input: string; voice: string; model: string }> = [];
  const speechFetch = vi.fn<typeof fetch>(async (_url, init) => {
    speechRequests.push(JSON.parse(init!.body as string));
    return new Response(Buffer.alloc(4_800), { status: 200, headers: { "x-request-id": "speech-test" } });
  });
  const semanticFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(init!.body as string);
    const input = JSON.parse(request.input[0].content);
    const decision = input.kind === "speech" ? "different" : "equivalent";
    return new Response(JSON.stringify({ id: "semantic-test", model: "gpt-6-luna", status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ decision }) }] }],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }
    }));
  });
  const bridge = createVoiceRuntime({ apiKey: "test", service: call.service, agentHangupEnabled: true,
    validateStreamToken: (_binding, token) => token === "valid", createLiveSocket: connect,
    createOpenAISocket: legacy, createConsentSocket: legacy, semanticFetch, speechFetch, logger }, { VOICE_RUNTIME_DRIVER: "live" });
  bridge.handleTwilioSocket(twilio.ws);
  const start = { event: "start", start: { callSid: "CA-LIVE", streamSid: "MZ", customParameters: { callBriefId: call.brief.id,
    callAttemptId: call.attempt.id, compilationSnapshotHash: call.snapshot.compilationSnapshotHash, streamToken: "valid" } } };
  twilio.receive(start); await flush();
  live.emit("open"); if (connect.mock.calls.length) live.startLive("one-live"); await flush();
  let time = 0;
  function transcript(role: "input" | "output", text: string) {
    if (role === "input") {
      const forwardedMs = live.sent.filter(e => e.type === "session.input_audio.append")
        .reduce((total, e) => total + Buffer.from(e.audio as string, "base64").length / 8, 0);
      time = Math.max(time, forwardedMs);
    }
    live.receive({ type: `session.${role}_transcript.delta`, delta: text, start_ms: time, end_ms: time += 100 });
  }
  function requestedSpeech() {
    const instruction = live.sent.filter(e => e.type === "session.instructions.append").at(-1)?.content as string;
    const controlled = instruction?.match(/<speech>([\s\S]*)<\/speech>/)?.[1];
    if (controlled) return controlled;
    const rendered = twilio.sent.filter(e => e.event === "mark" && String(e.mark.name).startsWith("rendered-disclosure:")).at(-1)?.mark.name;
    return rendered && rendered !== lastPlayedMark ? speechRequests.at(-1)?.input ?? "" : "";
  }
  let lastPlayedMark = "";
  async function play(acknowledge = true) {
    await flush();
    const rendered = twilio.sent.filter(e => e.event === "mark" && String(e.mark.name).startsWith("rendered-disclosure:")).at(-1)?.mark.name;
    if (rendered && rendered !== lastPlayedMark) {
      lastPlayedMark = rendered;
      if (acknowledge) twilio.receive({ event: "mark", mark: { name: rendered } });
      await flush();
      return rendered as string;
    }
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
    transcript("input", "Yes"); await tool("report_consent", { decision: "affirmative" });
    if (!recordingFailure && call.snapshot.runtime.assistanceDisclosure) await play();
  }
  async function closeNaturally(acknowledge = true, text = "Thank you for your help. Goodbye.") {
    transcript("output", text);
    live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_001); await flush();
    const mark = twilio.sent.filter(e => e.event === "mark").at(-1)?.mark.name;
    expect(mark).toMatch(/^live-closing:/);
    if (acknowledge) twilio.receive({ event: "mark", mark: { name: mark } });
    await flush(); return mark as string;
  }
  let sequence = 0;
  async function continueClosing(delegation: string, status = "completed") {
    const id = delegation + "-continuation";
    live.receive({ type: "response.event", delegation_id: delegation, event: { type: "response.created", response: { id } } });
    live.receive({ type: "response.event", delegation_id: delegation, event: { type: `response.${status}`, response: { id, status, output: [] } } });
    await flush(); await flush();
  }
  async function tool(name: string, args: unknown, text?: string, settlePlayback = true) {
    if (text) { transcript("input", text); await vi.advanceTimersByTimeAsync(601); await flush(); }
    const id = "response-" + ++sequence;
    const backend = (event: object) => live.receive({ type: "response.event", delegation_id: id, event });
    const toolArgs = name === "end_call" && args && typeof args === "object" && !("resultSummary" in args)
      ? { ...args, resultSummary: "The recipient's answer was recorded." }
      : args;
    backend({ type: "response.created", response: { id } });
    backend({ type: "response.output_item.done", item: { type: "function_call", call_id: id, name, arguments: JSON.stringify(toolArgs) } });
    backend({ type: "response.completed", response: { id, status: "completed", output: [], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } });
    await flush(); await flush();
    if (settlePlayback && name === "end_call" && result(id).ok) await continueClosing(id);
    if (settlePlayback && (name === "end_call" || name === "request_appointment")) await vi.advanceTimersByTimeAsync(501);
    return id;
  }
  const result = (id: string) => JSON.parse(live.sent.findLast(e => e.type === "response.item.create" && e.item.call_id === id).item.output);
  cleanup.push(async () => { twilio.close(); live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12 } }); await flush(); await call.service.close(); });
  const resolveAnswer = async (answeredBy: string) => { await call.service.transitionAnswering(call.brief.id, {
    attemptId: call.attempt.id, providerCallId: "CA-LIVE", snapshotHash: call.snapshot.compilationSnapshotHash,
    kind: "resolve", answeredBy, now: new Date().toISOString() }); await flush(); await flush(); };
  return { ...call, twilio, live, legacy, connect, recording, hangup, dispatch, resolveAnswer, semanticFetch, speechFetch,
    speechRequests, providerOperation, logger, transcript, requestedSpeech, play, accept, closeNaturally, tool, continueClosing, result, start };
}

describe("asynchronous answering alongside the disclosure", () => {
  it("drains late transcript fragments before completing capture without resuming speech or tools", async () => {
    const h = await harness(); await h.accept();
    const capture = vi.spyOn(h.service, "setNativeTranscriptCapture");
    h.transcript("input", "The application arrived."); await flush();
    h.twilio.close(); await flush();
    const effects = h.live.sent.length;
    h.transcript("output", "Goodbye.");
    h.live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12 } });
    for (let i = 0; i < 8; i++) await flush();
    expect((await h.repository.get(h.brief.id))!.transcript.some(segment => segment.text === "Goodbye.")).toBe(true);
    expect(capture).toHaveBeenCalledWith(h.brief.id, h.attempt.id, expect.objectContaining({ status: "complete" }));
    expect(h.live.sent).toHaveLength(effects);
  });
  it.each([["sebastian", "cedar"], ["anna", "marin"]] as const)("keeps %s / %s in one session from disclosure through consent, task and farewell", async (profile, voice) => {
    const h = await harness(null, false, false, "de-CH", true, profile);
    expect(h.snapshot.runtime.liveVoice).toBe(voice);
    expect(h.live.sent.find(e => e.type === "session.start").session.audio.output.voice).toBe(voice);
    await h.accept();
    expect(h.result(await h.tool("end_call", { reason: "objective_resolved" }, "Die Bewerbung ist angekommen."))).toMatchObject({ ok: true });
    await h.closeNaturally(true, "Danke für Ihre Hilfe. Auf Wiederhören.");
    expect(h.connect).toHaveBeenCalledOnce();
    expect(h.live.sent.filter(e => e.type === "session.start")).toHaveLength(1);
    expect(h.live.sent.filter(e => e.type === "session.update").every(e => !e.session.audio)).toBe(true);
    const checks = (await h.repository.listCallTelemetryEvents(h.brief.id)).filter(e => e.payload.name === "realtime.voice").map(e => e.payload.metadata);
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "startup", result: "confirmed", requestedVoice: voice, confirmedVoice: voice }),
      expect.objectContaining({ phase: "consent", result: "confirmed", confirmedVoice: voice }),
      expect.objectContaining({ phase: "conversation", result: "confirmed", confirmedVoice: voice })
    ]));
  });
  it("clears playback and stops without another voice if the provider reports a different voice after consent", async () => {
    const h = await harness(null, false, false, "de-CH", true, "sebastian");
    await h.accept();
    const count = h.twilio.sent.filter(e => e.event === "media").length;
    h.live.receive({ type: "session.updated", session: { id: "one-live", audio: { output: { voice: "marin" } } } });
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await flush();
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(count);
    expect(h.twilio.sent.some(e => e.event === "clear")).toBe(true);
    expect(h.twilio.readyState).toBe(3);
    expect(h.connect).toHaveBeenCalledOnce(); expect(h.legacy).not.toHaveBeenCalled();
    expect((await h.repository.listCallTelemetryEvents(h.brief.id)).some(e => e.payload.name === "realtime.voice" && e.payload.metadata.result === "mismatch")).toBe(true);
  });
  it("speaks and starts recording on consent before AMD, without requiring a human result", async () => {
    const h = await harness(null, false, false, "en-GB", true);
    expect(h.connect).toHaveBeenCalledOnce();
    expect(h.requestedSpeech()).toContain("Nina Keller");
    await h.play(); h.transcript("input", "Yes");
    const id = await h.tool("report_consent", { decision: "affirmative" });
    expect(h.recording).toHaveBeenCalledOnce();
    expect((await h.service.get(h.brief.id))!.brief.lifecycle?.answering).toMatchObject({ phase: "pending", streamAdmitted: true });
    await h.resolveAnswer("human");
    expect(h.recording).toHaveBeenCalledOnce();
    expect(h.result(id)).toMatchObject({ ok: true });
    expect(h.connect).toHaveBeenCalledOnce();
  });
  it.each(["machine_start", "fax"])("cancels pre-consent speech on %s without closing Twilio before handoff", async answer => {
    const h = await harness(null, false, false, "en-GB", true);
    await h.play();
    await h.resolveAnswer(answer);
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.recording).not.toHaveBeenCalled();
    expect(h.twilio.readyState).toBe(1);
    const audioCount = h.twilio.sent.filter(e => e.event === "media").length;
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(audioCount);
    await h.resolveAnswer(answer); expect(h.dispatch).toHaveBeenCalledOnce();
  });
  it("keeps the disclosure and accepts consent when AMD is inconclusive while the recipient listens", async () => {
    const h = await harness(null, false, false, "en-GB", true);
    const mark = await h.play(false);
    const clears = h.twilio.sent.filter(e => e.event === "clear").length;
    await h.resolveAnswer("unknown");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.twilio.readyState).toBe(1);
    expect(h.twilio.sent.filter(e => e.event === "clear")).toHaveLength(clears);
    expect((await h.service.get(h.brief.id))!.brief.lifecycle?.answering).toMatchObject({
      phase: "resolved", answeredBy: "unknown", decision: "consent", streamAdmitted: true
    });
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    h.transcript("input", "Yes");
    const id = await h.tool("report_consent", { decision: "affirmative" });
    expect(h.recording).toHaveBeenCalledOnce();
    expect(h.result(id)).toMatchObject({ ok: true });
  });
  it("handles AMD before the stream without opening Live or losing the non-human action", async () => {
    const h = await harness("machine_start", false, false, "en-GB", true);
    expect(h.connect).not.toHaveBeenCalled(); expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.twilio.readyState).toBe(1); expect(h.recording).not.toHaveBeenCalled();
  });
  it.each(["machine_start", "unknown", "fax"])("does not interrupt an accepted conversation on late AMD %s", async answer => {
    const h = await harness(null, false, false, "en-GB", true);
    await h.accept(); await h.resolveAnswer(answer);
    expect(h.recording).toHaveBeenCalledOnce(); expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.twilio.readyState).toBe(1);
    expect((await h.service.get(h.brief.id))!.brief.lifecycle?.answering?.answeredBy).toBe(answer);
  });
  it("bounds missing AMD and blocks a late human result", async () => {
    const h = await harness(null, false, false, "en-GB", true);
    await h.play(); // No affirmative consent; clarification may run during detection.
    for (let index = 0; index < 2; index++) { await vi.advanceTimersByTimeAsync(12_001); await flush(); await h.play(); }
    await vi.advanceTimersByTimeAsync(11_001); await flush(); await flush();
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect((await h.service.get(h.brief.id))!.brief.lifecycle?.answering).toMatchObject({ phase: "failed", failure: "timeout" });
    await h.resolveAnswer("human"); expect(h.recording).not.toHaveBeenCalled();
  });
});

describe("one Live session, application-owned lifecycle", () => {
  it("starts with minimal consent context, PCMU and no task/tools; never opens Realtime", async () => {
    const h = await harness();
    const session = h.live.sent.find(e => e.type === "session.start").session;
    expect(session.audio.format).toEqual({ type: "audio/pcmu", rate: 8000 });
    expect(session.delegation).toMatchObject({ type: "responses", responses: { model: "gpt-6-luna", tools: [], tool_choice: "none" } });
    expect(JSON.stringify(session)).not.toContain(h.snapshot.plan.localizedObjective);
    h.twilio.receive({ event: "media", media: { payload: silence } });
    expect(h.live.sent.at(-1)).toMatchObject({ type: "session.input_audio.append", audio: silence });
    await h.accept();
    expect(h.recording).toHaveBeenCalledOnce();
    expect(h.connect).toHaveBeenCalledOnce(); expect(h.legacy).not.toHaveBeenCalled();
    expect(h.live.sent.some(e => e.type === "session.update")).toBe(true);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  });
  it.each([null, "machine_start", "fax"])("rejects missing or explicit non-human AMD %s before provider startup", async answer => {
    const h = await harness(answer);
    expect(h.connect).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(3);
  });
  it("admits an inconclusive current-policy result before provider startup", async () => {
    const h = await harness("unknown");
    expect(h.connect).toHaveBeenCalledOnce();
    expect(h.twilio.readyState).toBe(1);
    expect(h.requestedSpeech()).toContain("Nina Keller");
  });
  it("does not grant for pre-playback speech or fabricated marks and never persists pre-consent transcripts", async () => {
    const h = await harness();
    h.transcript("input", "Yes");
    h.twilio.receive({ event: "mark", mark: { name: "live-speech:fake" } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.recording).not.toHaveBeenCalled();
    expect((await h.service.get(h.brief.id))!.transcript).toEqual([]);
    h.live.receive({ type: "session.delegation.created", delegation: { id: "early", target: "client" }, offset_ms: 0 });
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
  });
  it("plays application-rendered disclosure and suppresses unrelated Live output before its real mark", async () => {
    const h = await harness(); await flush();
    const media = h.twilio.sent.filter(e => e.event === "media").length;
    const mark = h.twilio.sent.findLast(e => e.event === "mark")?.mark.name;
    expect(mark).toMatch(/^rendered-disclosure:/);
    expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(0);
    h.transcript("output", "I booked your appointment.");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(media);
    expect(h.recording).not.toHaveBeenCalled();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect(h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses.tools.map((t: {name: string}) => t.name))
      .toEqual(["report_consent"]);
  });
  it("does not run the former disclosure speech classifier or retry loop", async () => {
    const h = await harness(); await h.play();
    expect(h.semanticFetch).not.toHaveBeenCalled();
    expect(h.speechFetch).toHaveBeenCalledOnce();
    expect((await h.repository.listCallTelemetryEvents(h.brief.id)).filter(e => e.payload.name === "disclosure.started")).toHaveLength(1);
    expect(h.twilio.readyState).toBe(1);
  });
  it("waits for the complete answer and handles negation before recording", async () => {
    const h = await harness(); await h.play();
    h.twilio.receive({ event: "media", media: { payload: speech } });
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(900);
    expect(h.recording).not.toHaveBeenCalled();
    h.transcript("input", ", but do not record.");
    for (let i = 0; i < 30; i++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await h.tool("report_consent", { decision: "negative" });
    expect(h.recording).not.toHaveBeenCalled();
    expect(h.requestedSpeech()).toContain("cannot continue");
  });
  it("does not enable tools or persist transcripts when recording fails", async () => {
    const h = await harness("human", true); await h.accept();
    expect(h.requestedSpeech()).toContain("recording could not");
    expect(h.live.sent.filter(e => e.type === "session.update").every(e => e.session.delegation.responses.tools.every((t: {name: string}) => t.name === "report_consent"))).toBe(true);
  });
  it("streams native transcripts and unchanged audio after consent, with full-duplex clear", async () => {
    const h = await harness(); await h.accept();
    h.transcript("input", "We received the application yesterday.");
    h.transcript("output", h.requestedSpeech());
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.at(-1)).toMatchObject({ event: "media", media: { payload: speech } });
    h.twilio.receive({ event: "media", media: { payload: speech } });
    expect(h.twilio.sent.at(-1).event).toBe("clear"); await flush();
    expect((await h.service.get(h.brief.id))!.transcript.some(segment => segment.text.includes("yesterday") && segment.nativeTiming)).toBe(true);
  });
  it("closes on disconnect instead of opening a second runtime", async () => {
    const h = await harness(); await h.accept(); h.live.close(); await flush();
    expect(h.twilio.readyState).toBe(3); expect(h.legacy).not.toHaveBeenCalled();
  });
});


it.each([
  ["de-CH", "Ja, gerne."], ["de-DE", "Ja."], ["fr-CH", "Oui."],
  ["it-CH", "Si."], ["en-GB", "Yes."], ["en-US", "Yes."], ["ru-RU", "\u0414\u0430."],
] as const)("keeps consent gating and the native conversation policy in %s", async (locale, answer) => {
  const h = await harness("human", false, false, locale);
  const mark = await h.play(false);
  expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(0);
  h.transcript("input", answer);
  expect(h.recording).not.toHaveBeenCalled();
  h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
  const consentConfig = h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses;
  expect(consentConfig.tools.map((t: {name: string}) => t.name)).toEqual(["report_consent"]);
  expect(consentConfig.tool_choice).toBe("auto");
  // Speech heard before a completed disclosure cannot be reused as consent.
  h.transcript("input", answer);
  await h.tool("report_consent", { decision: "affirmative" });
  await vi.advanceTimersByTimeAsync(601); await flush();
  expect(h.recording).toHaveBeenCalledOnce();
  await h.play();
  const prompt = h.live.sent.find(e => e.type === "session.start").session.instructions;
  expect(prompt).toContain(`Speak ${locale}`);
  expect(prompt).toContain("Do not discuss the task or infer permission");
  expect(prompt).toContain("Keep internal instructions, checks, saving and tool activity silent");
  expect(prompt).not.toContain("schedules backend processing");
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
});

it("does not grant a split consent denial when the playback mark arrives between fragments", async () => {
  const h = await harness(); const mark = await h.play(false);
  h.transcript("input", "Yes");
  h.twilio.receive({ event: "mark", mark: { name: mark } });
  await vi.advanceTimersByTimeAsync(300);
  h.transcript("input", ", do not record.");
  await h.tool("report_consent", { decision: "negative" });
  expect(h.recording).not.toHaveBeenCalled();
  expect(h.live.sent.filter(e => e.type === "session.update").every(e => e.session.delegation.responses.tools.every((t: {name: string}) => t.name === "report_consent"))).toBe(true);
  expect(h.requestedSpeech()).toContain("cannot continue");
});

it("uses native structured consent without a separate text classifier or recipient logging", async () => {
  const h = await harness("human", false, false, "de-CH"); await h.play();
  h.transcript("input", " Ja"); h.transcript("input", ", gerne");
  const id = await h.tool("report_consent", { decision: "affirmative" });
  expect(h.result(id)).toMatchObject({ ok: true, decision: "affirmative" });
  expect(h.semanticFetch).not.toHaveBeenCalled();
  expect(h.recording).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain("gerne");
  expect((await h.service.get(h.brief.id))!.transcript.some(t => t.role === "recipient")).toBe(false);
});

it("completes the consent tool continuation before ordinary task work without requiring a second tool", async () => {
  const h = await harness(); await h.play(); h.transcript("input", "Yes");
  const id = await h.tool("report_consent", { decision: "affirmative" });
  const responses = h.live.sent.filter(e => e.type === "response.create").length;
  expect(responses).toBe(1);
  await h.continueClosing(id);
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(responses);
  expect(h.twilio.readyState).toBe(1);
  await h.play();
  const taskConfig = h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses;
  expect(taskConfig.tool_choice).toBe("auto");
  expect(taskConfig.tools.map((tool: {name: string}) => tool.name)).toContain("end_call");
});

it("retries one consent response without report_consent, then uses the normal clarification", async () => {
  const h = await harness(); await h.play(); h.transcript("input", "Yes");
  await vi.advanceTimersByTimeAsync(601); await flush();
  const initial = h.live.sent.filter(e => e.type === "response.create").length;
  expect(initial).toBe(1);
  const miss = async (delegation: string, id: string) => {
    h.live.receive({ type: "response.event", delegation_id: delegation, event: { type: "response.created", response: { id } } });
    h.live.receive({ type: "response.event", delegation_id: delegation, event: {
      type: "response.completed", response: { id, status: "completed", output: [] }
    } });
    await flush(); await flush();
  };
  await miss("consent-miss-1", "consent-miss-response-1");
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(initial + 1);
  await miss("consent-miss-2", "consent-miss-response-2");
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(initial + 1);
  expect(h.requestedSpeech()).toContain("Nina Keller");
  expect(h.recording).not.toHaveBeenCalled();
});

it("retries one task-stage Live command rejection before a bounded spoken failure", async () => {
  const h = await harness(); await h.accept();
  await h.tool("delete_account", { evidence: [] });
  const command = h.live.sent.findLast(e => e.type === "response.create");
  expect(command?.event_id).toEqual(expect.any(String));
  h.live.receive({ type: "error", event_id: "command-error-1", error: { type: "invalid_request_error", code: "invalid_request_error",
    message: "Responses handoff incomplete.", param: "session.delegation.responses", client_event_id: command.event_id } });
  await flush();
  const retry = h.live.sent.findLast(e => e.type === "response.create");
  expect(retry.event_id).not.toBe(command.event_id);
  expect(h.requestedSpeech()).toBe("");
  h.live.receive({ type: "error", event_id: "command-error-2", error: { type: "invalid_request_error", code: "invalid_request_error",
    message: "Responses handoff incomplete.", param: "session.delegation.responses", client_event_id: retry.event_id } });
  await vi.advanceTimersByTimeAsync(501); await flush();
  expect(h.twilio.readyState).toBe(1);
  expect(h.requestedSpeech()).toContain("can't reliably continue this call");
  expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({
    code: "invalid_request_error", type: "invalid_request_error", param: "session.delegation.responses",
    clientEventId: retry.event_id, command: "response.create", phase: "conversation", disposition: "fatal"
  }), "Live command failed");
  expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain("Responses handoff incomplete.");
});

it("keeps spoken consent available after clarification and keypad fallback", async () => {
  const h = await harness("human", false, false, "de-CH"); await h.play();
  for (let i = 0; i < 2; i++) {
    await h.tool("report_consent", { decision: "unclear" }, "Unclear speech");
    expect(h.recording).not.toHaveBeenCalled(); await h.play();
  }
  await h.tool("report_consent", { decision: "affirmative" }, "Ja");
  expect(h.recording).toHaveBeenCalledOnce();
  expect(h.semanticFetch).not.toHaveBeenCalled();
});

it.each(["correction", "disconnect", "timeout", "dtmf"])("ignores a delegated affirmative result after %s", async event => {
  const h = await harness(); await h.play(); h.transcript("input", "Of course");
  const backend = (event: object) => h.live.receive({ type: "response.event", delegation_id: "late", event });
  backend({ type: "response.created", response: { id: "late" } });
  if (event === "correction") h.transcript("input", ", but don't record.");
  if (event === "disconnect") h.twilio.close();
  if (event === "timeout") await vi.advanceTimersByTimeAsync(12_001);
  if (event === "dtmf") h.twilio.receive({ event: "dtmf", dtmf: { digit: "2" } });
  backend({ type: "response.completed", response: { id: "late", status: "completed", output: [
    { type: "function_call", call_id: "late", name: "report_consent", arguments: '{"decision":"affirmative"}' }
  ] } });
  await flush(); await flush();
  expect(h.recording).not.toHaveBeenCalled();
  if (event === "correction") {
    expect(h.result("late")).toMatchObject({ ok: false, reason: "stale_or_unauthorized_request" });
    await h.tool("report_consent", { decision: "negative" });
    expect(h.requestedSpeech()).toContain("cannot continue");
  }
});

it("does not infer consent from model output without a recipient answer or enable task tools early", async () => {
  const h = await harness(); await h.play();
  const config = h.live.sent.find(e => e.type === "session.update").session.delegation.responses;
  expect(config.tools.map((t: {name: string}) => t.name)).toEqual(["report_consent"]);
  expect(JSON.stringify(config)).not.toContain(h.snapshot.plan.localizedObjective);
  expect(h.result(await h.tool("report_consent", { decision: "affirmative" }))).toMatchObject({ ok: false, reason: "awaiting_recipient_answer" });
  expect(h.result(await h.tool("end_call", { reason: "objective_resolved" }))).toMatchObject({ ok: false });
  expect(h.recording).not.toHaveBeenCalled(); expect(h.hangup).not.toHaveBeenCalled();
});

it("does not refresh stale consent by continuing the same delegation with an older answer", async () => {
  const h = await harness(); await h.play(); h.transcript("input", "Yes");
  const backend = (event: object, delegation_id = "old-context") => h.live.receive({ type: "response.event", delegation_id, event });
  const complete = async (id: string, delegation = "old-context") => {
    backend({ type: "response.completed", response: { id, status: "completed", output: [
      { type: "function_call", call_id: id, name: "report_consent", arguments: '{"decision":"affirmative"}' }
    ] } }, delegation);
    await flush(); await flush();
  };
  backend({ type: "response.created", response: { id: "first" } });
  h.transcript("input", ", but don't record.");
  await complete("first");
  backend({ type: "response.created", response: { id: "retry-old-context" } });
  await complete("retry-old-context");
  expect(h.result("retry-old-context")).toMatchObject({ ok: false, reason: "stale_or_unauthorized_request" });
  expect(h.recording).not.toHaveBeenCalled();
  const count = h.live.sent.filter(e => e.type === "response.create").length;
  backend({ type: "response.created", response: { id: "old-continuation" } });
  backend({ type: "response.completed", response: { id: "old-continuation", status: "completed", output: [] } });
  await flush(); await flush();
  await vi.advanceTimersByTimeAsync(601); await flush();
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(count + 1);
  backend({ type: "response.created", response: { id: "duplicate-old-continuation" } });
  backend({ type: "response.completed", response: { id: "duplicate-old-continuation", status: "completed", output: [] } });
  await flush(); await flush();
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(count + 1);
  await h.tool("report_consent", { decision: "negative" });
  expect(h.requestedSpeech()).toContain("cannot continue");
});

it("does not start a recovery while Live already processes a newer consent delegation", async () => {
  const h = await harness(); await h.play(); h.transcript("input", "Yes");
  const backend = (delegation_id: string, event: object) => h.live.receive({ type: "response.event", delegation_id, event });
  backend("older", { type: "response.created", response: { id: "older" } });
  h.transcript("input", ", but no recording.");
  backend("newer", { type: "response.created", response: { id: "newer" } });
  const requests = h.live.sent.filter(e => e.type === "response.create").length;
  backend("older", { type: "response.completed", response: { id: "older", status: "completed", output: [] } });
  await flush(); await flush();
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(requests);
  backend("newer", { type: "response.completed", response: { id: "newer", status: "completed", output: [
    { type: "function_call", call_id: "newer", name: "report_consent", arguments: '{"decision":"negative"}' }
  ] } });
  await flush(); await flush();
  expect(h.recording).not.toHaveBeenCalled();
  expect(h.requestedSpeech()).toContain("cannot continue");
});

it("waits for the semantic boundary and rejects an affirmative made stale by a correction", async () => {
  const h = await harness(); await h.play();
  for (let i = 0; i < 5; i++) h.twilio.receive({ event: "media", media: { payload: speech } });
  h.transcript("input", "Yes");
  const pending = await h.tool("report_consent", { decision: "affirmative" });
  expect(h.live.sent.some(e => e.type === "response.item.create" && e.item.call_id === pending)).toBe(false);
  expect(h.recording).not.toHaveBeenCalled();
  h.transcript("input", ", but don't record.");
  for (let i = 0; i < 30; i++) h.twilio.receive({ event: "media", media: { payload: silence } });
  await flush(); await flush();
  expect(h.result(pending)).toMatchObject({ ok: false, reason: "stale_or_unauthorized_request" });
  await h.tool("report_consent", { decision: "negative" });
  expect(h.recording).not.toHaveBeenCalled();
});

it("rejects invalid consent arguments and grants only once", async () => {
  const h = await harness(); await h.play(); h.transcript("input", "Yes");
  for (const args of [{ decision: "yes" }, { decision: "affirmative", text: "Yes" }, {}]) {
    expect(h.result(await h.tool("report_consent", args))).toMatchObject({ ok: false });
  }
  await h.tool("report_consent", { decision: "affirmative" });
  expect(h.result(await h.tool("report_consent", { decision: "affirmative" }))).toMatchObject({ ok: false });
  expect(h.recording).toHaveBeenCalledOnce();
});

it("waits for disclosure playback and rechecks corrections before applying the decision", async () => {
  const h = await harness(); const mark = await h.play(false);
  h.transcript("input", "Yes");
  const id = await h.tool("report_consent", { decision: "affirmative" });
  expect(h.result(id)).toMatchObject({ ok: false }); expect(h.recording).not.toHaveBeenCalled();
  h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush(); await flush();
  h.transcript("input", "No, do not record");
  await h.tool("report_consent", { decision: "negative" });
  expect(h.requestedSpeech()).toContain("cannot continue");
});

it("keeps Live input full-duplex and replays a disclosure interrupted by recipient speech", async () => {
  const h = await harness("human", false, false, "en-GB", false, "sebastian", "none");
  const oldMark = await h.play(false);
  const before = h.live.sent.filter(e => e.type === "session.input_audio.append").length;
  h.twilio.receive({ event: "media", media: { payload: speech } });
  expect(h.live.sent.filter(e => e.type === "session.input_audio.append")).toHaveLength(before + 1);
  expect(h.twilio.sent.at(-1).event).toBe("clear");
  h.twilio.receive({ event: "mark", mark: { name: oldMark } }); await flush();
  expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(0);
  for (let index = 0; index < 30; index++) h.twilio.receive({ event: "media", media: { payload: silence } });
  await flush(); await flush();
  const newMark = h.twilio.sent.filter(e => e.event === "mark").at(-1)?.mark.name;
  expect(newMark).toMatch(/^rendered-disclosure:/); expect(newMark).not.toBe(oldMark);
  h.twilio.receive({ event: "mark", mark: { name: oldMark } });
  expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(0);
  h.twilio.receive({ event: "mark", mark: { name: newMark } }); await flush();
  h.transcript("input", "Yes, I agree"); await h.tool("report_consent", { decision: "affirmative" });
  expect(h.recording).toHaveBeenCalledOnce();
});

it("does not treat a delayed transcript from before the completed replay as consent", async () => {
  const h = await harness("human", false, false, "en-GB", false, "sebastian", "none");
  await h.play(false);
  h.twilio.receive({ event: "media", media: { payload: speech } });
  for (let index = 0; index < 30; index++) h.twilio.receive({ event: "media", media: { payload: silence } });
  await flush(); await flush(); await h.play();
  const decisions = h.live.sent.filter(e => e.type === "response.create").length;
  h.live.receive({ type: "session.input_transcript.delta", delta: "Yes", start_ms: 0, end_ms: 100 });
  await vi.advanceTimersByTimeAsync(601); await flush();
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(decisions);
  expect(h.recording).not.toHaveBeenCalled();
  h.transcript("input", "Yes, I agree");
  await h.tool("report_consent", { decision: "affirmative" });
  expect(h.recording).toHaveBeenCalledOnce();
});

it("keeps keypad recovery after unanswered disclosure attempts", async () => {
  const h = await harness(); await h.play();
  h.twilio.receive({ event: "dtmf", dtmf: { digit: "1" } }); await flush();
  expect(h.recording).not.toHaveBeenCalled();
  for (let i = 0; i < 2; i++) { await vi.advanceTimersByTimeAsync(12_001); await h.play(); }
  h.twilio.receive({ event: "dtmf", dtmf: { digit: "1" } }); await flush();
  expect(h.recording).toHaveBeenCalledOnce(); expect(h.connect).toHaveBeenCalledOnce();
});

describe("rendered disclosure recovery without conversation-specific rules", () => {
  it.each(["ru-RU", "de-CH", "fr-CH", "it-CH", "en-GB"] as const)("renders the localized exact application text in %s", async locale => {
    const h = await harness("human", false, false, locale, true, "sebastian", "none");
    expect(h.speechRequests).toHaveLength(1);
    expect(h.speechRequests[0]).toMatchObject({ input: h.requestedSpeech(), voice: "cedar", model: "gpt-4o-mini-tts" });
    expect(h.speechRequests[0].input).toContain("Nina Keller");
    expect(h.semanticFetch).not.toHaveBeenCalled();
    expect(h.providerOperation).toHaveBeenCalledWith(expect.objectContaining({
      parentOperationId: expect.any(String), operationType: "realtime_response", stage: "live_disclosure_synthesis",
      requestedModel: "gpt-4o-mini-tts", result: expect.objectContaining({ outcome: "succeeded",
        providerResponseId: "speech-test", usage: expect.objectContaining({ requestCount: 1, durationSeconds: 0.1 }) })
    }));
    await h.play(); h.transcript("input", "Yes");
    await h.tool("report_consent", { decision: "affirmative" });
    expect(h.recording).toHaveBeenCalledOnce();
  });
  it("keeps consent interpretation available after an unclear answer and rejects an old mark", async () => {
    const h = await harness(); const oldMark = await h.play();
    h.transcript("input", "What does that mean?");
    await h.tool("report_consent", { decision: "unclear" });
    h.twilio.receive({ event: "mark", mark: { name: oldMark } });
    expect(h.recording).not.toHaveBeenCalled();
    await h.play();
    expect(h.speechRequests).toHaveLength(1);
    expect(h.speechRequests[0].input).toContain("Nina Keller");
    expect(h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses.tools.map((t: {name: string}) => t.name))
      .toEqual(["report_consent"]);
    h.transcript("input", "Yes"); await h.tool("report_consent", { decision: "affirmative" });
    expect(h.recording).toHaveBeenCalledOnce();
  });
});

describe("bounded answer processing", () => {
  it.each([false, true])("rejects pre-playback consent and uses only a post-disclosure answer (%s)", async corrected => {
    const h = await harness(); const mark = await h.play(false);
    h.transcript("input", "Yes, I agree.");
    const id = await h.tool("report_consent", { decision: "affirmative" });
    expect(h.result(id)).toMatchObject({ ok: false });
    expect(h.recording).not.toHaveBeenCalled();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush(); await flush();
    h.transcript("input", corrected ? "No, do not record." : "Yes, I agree.");
    if (corrected) {
      await h.tool("report_consent", { decision: "negative" });
      expect(h.recording).not.toHaveBeenCalled();
    } else {
      await h.tool("report_consent", { decision: "affirmative" });
      expect(h.recording).toHaveBeenCalledOnce();
    }
  });
  it("caps consent waiting even when acoustic activity repeatedly restarts", async () => {
    const h = await harness(); await h.play();
    const renderings = h.speechRequests.length;
    for (let n = 0; n < 2; n++) {
      await vi.advanceTimersByTimeAsync(9_000);
      for (let i = 0; i < 5; i++) h.twilio.receive({ event: "media", media: { payload: speech } });
      for (let i = 0; i < 30; i++) h.twilio.receive({ event: "media", media: { payload: silence } });
    }
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.speechRequests).toHaveLength(renderings);
    await vi.advanceTimersByTimeAsync(2); await flush();
    expect(h.speechRequests).toHaveLength(renderings);
    expect(h.requestedSpeech()).toContain("Nina Keller");
    expect(h.recording).not.toHaveBeenCalled();
  });
  it("does not create a second task response when native delegation is absent", async () => {
    const h = await harness(); await h.accept(); await h.continueClosing("response-1");
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    h.transcript("input", "I like pizza."); h.transcript("output", "Noted, thank you.");
    await vi.advanceTimersByTimeAsync(601); await flush();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    await h.tool("end_call", { reason: "objective_resolved" });
    expect(h.hangup).not.toHaveBeenCalled();
    await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("does not duplicate a native decision announced before response.created", async () => {
    const h = await harness(); await h.accept(); await h.continueClosing("response-1");
    h.transcript("input", "It arrived.");
    h.live.receive({ type: "session.delegation.created", delegation: { id: "native", response_id: "native-response", target: "responses" } });
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    await vi.advanceTimersByTimeAsync(601);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    const backend = (event: object) => h.live.receive({ type: "response.event", delegation_id: "native", event });
    backend({ type: "response.created", response: { id: "native-response" } });
    backend({ type: "response.completed", response: { id: "native-response", status: "completed", output: [] } });
    await flush(); await flush();
    // Noise changes effect freshness, but is not a new answer to process.
    for (let i = 0; i < 5; i++) h.twilio.receive({ event: "media", media: { payload: speech } });
    for (let i = 0; i < 30; i++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(601);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
  });
});

describe("autonomous conversation and protected effects", () => {
  it("continues the task after an unattributed Live error and persists bounded diagnostics", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none");
    await h.accept();
    h.live.receive({ type: "error", event_id: "live-error-1", error: {
      type: "server_error", code: "output_interrupted", message: "private provider data"
    } });
    await flush();
    expect(h.twilio.readyState).toBe(1);
    expect(h.requestedSpeech()).toBe("");
    expect(h.hangup).not.toHaveBeenCalled();
    const errors = (await h.repository.listCallTelemetryEvents(h.brief.id)).filter(e => e.payload.name === "realtime.error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.payload.metadata).toMatchObject({ disposition: "continued", code: "output_interrupted",
      command: null, phase: "conversation" });
    expect(JSON.stringify(errors)).not.toContain("private provider data");
  });
  it("waits for current model audio to drain before starting a fatal fallback", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none");
    await h.accept();
    h.transcript("output", "What would you like for dinner?");
    h.live.receive({ type: "session.output_audio.delta", delta: Buffer.alloc(8_000, 128).toString("base64") });
    const id = "failed-task-response";
    h.live.receive({ type: "response.event", delegation_id: "failed-task", event: { type: "response.created", response: { id } } });
    h.live.receive({ type: "response.event", delegation_id: "failed-task", event: {
      type: "response.failed", response: { id, status: "failed", output: [] }
    } });
    await flush(); await flush();
    expect(h.requestedSpeech()).toBe("");
    expect(h.hangup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_149);
    expect(h.requestedSpeech()).toBe("");
    await vi.advanceTimersByTimeAsync(851); await flush();
    expect(h.requestedSpeech()).toContain("can't reliably continue this call");
  });
  it("enables a native opening after recording without a script mark and preserves immediate task answers", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none");
    await h.accept();
    expect(h.requestedSpeech()).toBe("");
    expect(h.twilio.sent.filter(e => e.event === "mark")).toHaveLength(1);
    const opening = h.live.sent.filter(e => e.type === "session.instructions.append").at(-1).content;
    expect(opening).toContain("check readiness only if the recipient has not already invited continuation or answered the task");
    expect(opening).toContain("continue naturally on behalf of the represented person");
    h.transcript("input", "It arrived yesterday.");
    h.transcript("output", "Thank you."); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(601); await flush();
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text === "It arrived yesterday.")).toBe(true);
    expect((await h.repository.listCallTelemetryEvents(h.brief.id)).filter(t => t.payload.name === "conversation.first_audio")).toHaveLength(1);
    expect(h.result(await h.tool("end_call", { reason: "objective_resolved" }))).toMatchObject({ ok: true });
    await h.closeNaturally(); expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("continues end_call normally and does not inspect acknowledgments before its terminal result", async () => {
    const h = await harness(); await h.accept();
    const instructions = h.live.sent.filter(e => e.type === "session.instructions.append").length;
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    expect(h.live.sent.at(-1).type).toBe("response.create");
    expect(h.live.sent.filter(e => e.type === "session.instructions.append")).toHaveLength(instructions);
    h.transcript("output", "Understood."); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(701);
    expect(h.semanticFetch).not.toHaveBeenCalled();
    await h.continueClosing(id); await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it.each(["backend_failed", "backend_missing"])("recovers %s with one bounded exact farewell", async failure => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    if (failure === "backend_missing") await vi.advanceTimersByTimeAsync(8_001);
    else await h.continueClosing(id, "failed");
    expect(h.requestedSpeech()).toBe("Thank you. Goodbye.");
    await h.play(false);
    expect(h.hangup).not.toHaveBeenCalled();
    const mark = h.twilio.sent.findLast(e => e.event === "mark").mark.name;
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("uses the authorized structured summary and tracks closing playback without reclassification", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", {
      reason: "objective_resolved", resultSummary: "The application arrived yesterday."
    }, "It arrived yesterday.", false);
    expect(h.result(id)).toMatchObject({ ok: true, resultSummary: "The application arrived yesterday." });
    await h.continueClosing(id);
    const checks = h.semanticFetch.mock.calls.length;
    h.transcript("output", "The application arrived yesterday. Thank you, goodbye.");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_001); await flush();
    const mark = h.twilio.sent.filter(e => e.event === "mark").at(-1)?.mark.name;
    expect(mark).toMatch(/^live-closing:/);
    expect(h.semanticFetch).toHaveBeenCalledTimes(checks);
    expect(h.hangup).not.toHaveBeenCalled();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("ignores old continuation and playback after the recipient interrupts a fallback", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    await vi.advanceTimersByTimeAsync(8_001);
    const oldMark = await h.play(false);
    h.transcript("input", "Thank you, one more question.");
    await h.continueClosing(id, "failed");
    h.twilio.receive({ event: "mark", mark: { name: oldMark } }); await flush();
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(1);
    expect(h.requestedSpeech()).toBe("");
  });
  it("bounds failed fallback playback without reporting successful hangup", async () => {
    const h = await harness(); await h.accept();
    await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    await vi.advanceTimersByTimeAsync(8_001); await h.play(false);
    await vi.advanceTimersByTimeAsync(8_001); await flush();
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(3);
  });
  it("does not let an interrupted closing continuation time out a resumed conversation", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    h.live.receive({ type: "response.event", delegation_id: id, event: { type: "response.created", response: { id: "pending-closing" } } });
    h.transcript("input", "Wait, I have a correction.");
    await vi.advanceTimersByTimeAsync(30_001); await flush();
    expect(h.twilio.readyState).toBe(1); expect(h.hangup).not.toHaveBeenCalled();
  });
  it.each([false, true])("ordinary speech needs no classification (appointment=%s)", async appointment => {
    const h = await harness("human", false, appointment); await h.accept();
    const calls = h.semanticFetch.mock.calls.length, media = h.twilio.sent.filter(e => e.event === "media").length;
    h.transcript("output", "Which date works for you?"); h.live.receive({ type: "session.output_audio.delta", delta: speech }); await flush();
    expect(h.semanticFetch).toHaveBeenCalledTimes(calls);
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(media + 1);
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text.includes("Which date"))).toBe(true);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  });
  it("lets Live close without a backend script and hangs up only after verified playback", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived yesterday.");
    expect(h.result(id)).toMatchObject({ ok: true, state: "closing_authorized", actionCompleted: false });
    expect(h.live.sent.filter(e => e.type === "response.item.create" && e.item.type === "message")).toEqual([]);
    expect(h.requestedSpeech()).toBe("");
    const mark = await h.closeNaturally(false);
    expect(h.hangup).not.toHaveBeenCalled();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text === "Thank you for your help. Goodbye.")).toBe(true);
  });
  it("does not hang up on a cleared mark; resumes naturally after an interruption", async () => {
    const h = await harness(); await h.accept();
    await h.tool("end_call", { reason: "recipient_requested_end" }, "Goodbye.");
    const mark = await h.closeNaturally(false); h.transcript("input", "Wait, a correction.");
    h.twilio.receive({ event: "mark", mark: { name: mark } });
    h.transcript("output", "What would you like to correct?"); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.hangup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(601); await flush();
    await h.tool("end_call", { reason: "recipient_requested_end" }); await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("recovers cleared closing playback without reopening the task on acoustic noise alone", async () => {
    const h = await harness(); await h.accept();
    await h.tool("end_call", { reason: "recipient_requested_end" }, "Goodbye.");
    const staleMark = await h.closeNaturally(false);
    h.twilio.receive({ event: "media", media: { payload: speech } });
    expect(h.requestedSpeech()).toBe("Thank you. Goodbye.");
    h.twilio.receive({ event: "mark", mark: { name: staleMark } }); await flush();
    expect(h.hangup).not.toHaveBeenCalled();
    const fallbackMark = await h.play(false);
    h.twilio.receive({ event: "mark", mark: { name: fallbackMark } }); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("rejects unsupported tools and invented evidence", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved", recap: ["All done."], evidence: ["invented"] });
    expect(h.result(id).ok).toBe(false); expect(h.hangup).not.toHaveBeenCalled();
    expect(h.result(await h.tool("delete_account", { evidence: [] })).reason).toBe("unsupported_tool");
  });
  it("cannot claim success without observed recipient evidence or required appointment confirmation", async () => {
    const h = await harness(); await h.accept();
    expect(h.result(await h.tool("end_call", { reason: "objective_resolved" })).reason).toBe("recipient_evidence_required");
    const a = await harness("human", false, true); await a.accept();
    expect(a.result(await a.tool("end_call", { reason: "objective_resolved" }, "That time is available.")).reason).toBe("appointment_confirmation_required");
    expect(h.hangup).not.toHaveBeenCalled(); expect(a.hangup).not.toHaveBeenCalled();
  });
  it("rejects legacy scripted recaps and does not close merely because the tool succeeded", async () => {
    const h = await harness(); await h.accept();
    const old = await h.tool("end_call", { reason: "objective_resolved", recap: ["An internal policy."] }, "Tuesday.");
    expect(h.result(old).reason).toBe("invalid_closing_request");
    await h.tool("end_call", { reason: "objective_resolved" });
    const count = h.twilio.sent.filter(e => e.event === "mark").length;
    for (let i = 0; i < 50; i++) {
      h.live.receive({ type: "session.output_audio.delta", delta: silence });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(h.hangup).not.toHaveBeenCalled();
    expect(h.twilio.sent.filter(e => e.event === "mark")).toHaveLength(count);
    await h.closeNaturally(); expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("rejects a proposal outside permission before speech or classification", async () => {
    const h = await harness("human", false, true); await h.accept(); const count = h.semanticFetch.mock.calls.length;
    const id = await h.tool("request_appointment", { proposal: { ...proposal, startTime: "20:00" }, content: "Please book it." }, "20:00 is available.");
    expect(h.result(id).reason).toBe("outside_authorized_window"); expect(h.semanticFetch).toHaveBeenCalledTimes(count);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions).toEqual([]);
  });
  it("journals before buffered commitment playback, requires later exact confirmation and prevents repeat booking", async () => {
    const h = await harness("human", false, true); await h.accept();
    const before = h.twilio.sent.filter(e => e.event === "media").length;
    await h.tool("request_appointment", { proposal, content: "Please book 16 September 2099 at 15:00. Is it confirmed?" }, "That time is available.");
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("sending");
    h.transcript("output", h.requestedSpeech()); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(501); h.twilio.receive({ event: "mark", mark: h.twilio.sent.findLast(e => e.event === "mark").mark }); await flush();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("delivered");
    const early = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" });
    expect(h.result(early).reason).toBe("another_action_pending");
    const changed = await h.tool("confirm_appointment", { proposal: { ...proposal, startTime: "16:00" }, confirmation: "affirmative" }, "Actually, 16:00.");
    expect(h.result(changed).reason).toBe("exact_delivered_proposal_required");
    const confirmed = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" }, "Yes, the original 15:00 is booked.");
    expect(h.result(confirmed)).toMatchObject({ ok: true, source: "recipient_report", externallyVerified: false });
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].observations).toContainEqual({ id: "turn-3", text: "Yes, the original 15:00 is booked." });
    const duplicate = await h.tool("request_appointment", { proposal, content: "Please book again." });
    expect(h.result(duplicate).reason).toBe("appointment_already_requested");
  });
  it("retains disclosure evidence without persisting pre-consent recipient words", async () => {
    const h = await harness(); await h.accept(); const transcript = (await h.service.get(h.brief.id))!.transcript;
    expect(transcript.some(t => t.text.includes("May I record"))).toBe(true);
    expect(transcript.some(t => t.role === "recipient")).toBe(false);
  });
  it("does not replay an interrupted commitment or accept its cleared mark", async () => {
    const h = await harness("human", false, true); await h.accept();
    await h.tool("request_appointment", { proposal, content: "Please book 16 September 2099 at 15:00. Is it confirmed?" }, "That time is available.");
    const mark = await h.play(false);
    h.transcript("input", "Wait, that time no longer works."); await flush();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("uncertain");
    await vi.advanceTimersByTimeAsync(601); await flush();
    const repeat = await h.tool("request_appointment", { proposal, content: "Please book again." });
    expect(h.result(repeat).reason).toBe("appointment_already_requested");
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("drains prior autonomous speech before buffering an authorized appointment request", async () => {
    const h = await harness("human", false, true); await h.accept();
    const previous = h.requestedSpeech(), content = "Please book 16 September 2099 at 15:00. Is it confirmed?";
    await h.tool("request_appointment", { proposal, content }, "That time is available.", false);
    h.transcript("output", "One moment, please.");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.requestedSpeech()).toBe(previous);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(501);
    expect(h.requestedSpeech()).toBe(content);
    await h.play();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("delivered");
    expect(h.twilio.readyState).toBe(1);
  });
  it("continues the appointment tool with the actual subsequent answer, never a premature waiting report", async () => {
    const h = await harness("human", false, true); await h.accept();
    const id = await h.tool("request_appointment", { proposal, content: "Please book 16 September 2099 at 15:00. Is it confirmed?" }, "That time is available.");
    await h.play();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
    expect(h.live.sent.some(e => e.type === "response.item.create" && e.item.call_id === id)).toBe(false);
    h.transcript("input", "No, that time is no longer available.");
    await vi.advanceTimersByTimeAsync(601); await flush();
    expect(h.result(id)).toMatchObject({ state: "delivered", actionCompleted: false,
      recipientReply: { source: "observed_recipient_speech", text: "No, that time is no longer available." } });
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(2);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("delivered");
  });
});
