import type { CallLocale, AssistantProfileId, AssistanceReason, AppointmentAuthorization } from "@callassist/contracts";
import { ANSWERING_POLICY_VERSION, getAssistanceDisclosure, buildInitialDisclosure, SUPPORTED_CALL_LOCALES } from "@callassist/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRuntime } from "./create-voice-runtime";
import { approvedCall, authorization, proposal, TestSocket, flush, silence, speech } from "./voice-test-helpers";
import backendReplay from './fixtures/appointment-backend-replay-2026-11-02.json';
import { liveTaskFailureCopy } from './live-failure-copy';


const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("opt-in native informational conversation", () => {
  const native = (appointment = false, recordingFailure = false) => harness("human", recordingFailure, appointment,
    "en-GB", false, "anna", "none", "semantic_native", undefined, true);
  it("preloads the approved brief while keeping speech, task effects and persistence behind consent", async () => {
    const h = await native();
    const start = h.live.sent.find(e => e.type === "session.start").session;
    expect(JSON.stringify(start.input)).toContain(h.snapshot.plan.localizedObjective);
    expect(start.delegation.responses.tools).toEqual([]);
    const media = h.twilio.sent.filter(e => e.event === "media").length;
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    h.transcript("input", "Private before consent");
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(media);
    const id = await h.tool("end_call", { reason: "objective_resolved" });
    expect(h.result(id).ok).toBe(false); expect(h.recording).not.toHaveBeenCalled();
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toEqual([]);
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.role === "recipient")).toBe(false);
  });
  it("uses one handoff, end_call only, no task recovery timer and no VAD playback clear", async () => {
    const h = await native(); await h.accept();
    expect(h.live.sent.filter(e => e.type === "session.instructions.append" && e.content.startsWith("Task enabled:"))).toHaveLength(1);
    expect(h.live.sent.filter(e => e.type === "session.thinking.append")).toHaveLength(0);
    expect(h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses.tools.map((t: any) => t.name)).toEqual(["end_call"]);
    const requests = h.live.sent.filter(e => e.type === "response.create").length;
    const clears = h.twilio.sent.filter(e => e.event === "clear").length;
    for (let n = 0; n < 5; n++) h.twilio.receive({ event: "media", media: { payload: speech } });
    h.transcript("input", "It arrived yesterday.");
    for (let n = 0; n < 30; n++) h.twilio.receive({ event: "media", media: { payload: silence } });
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(12_000); await flush();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(requests);
    expect(h.twilio.sent.filter(e => e.event === "clear")).toHaveLength(clears);
    expect(h.twilio.readyState).toBe(1);
  });
  it("finishes with native audio and an acknowledged drain, without an extra TTS request", async () => {
    const h = await native(); await h.accept(); const renders = h.speechRequests.length;
    const id = await h.tool("end_call", { reason: "objective_resolved", resultSummary: "The application arrived yesterday." }, "It arrived yesterday.");
    expect(h.result(id)).toMatchObject({ ok: true, state: "closing_authorized" });
    expect(h.speechRequests).toHaveLength(renders);
    h.transcript("output", "Thank you. Goodbye."); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_500); await flush();
    expect(h.hangup).not.toHaveBeenCalled();
    const mark = h.twilio.sent.findLast(e => e.event === "mark").mark.name;
    expect(mark).toMatch(/^live-native-close:/);
    h.twilio.receive({ event: "mark", mark: { name: mark } });
    await vi.advanceTimersByTimeAsync(350); await flush();
    expect(h.hangup).toHaveBeenCalledOnce(); expect(h.speechRequests).toHaveLength(renders);
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toHaveLength(1);
  });
  it("cancels closing for a correction and rejects the old returned mark", async () => {
    const h = await native(); await h.accept();
    await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.");
    h.transcript("output", "Goodbye."); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_500);
    const old = h.twilio.sent.findLast(e => e.event === "mark").mark.name;
    h.transcript("input", "Actually it did not arrive.");
    h.twilio.receive({ event: "mark", mark: { name: old } });
    await vi.advanceTimersByTimeAsync(1_000); expect(h.hangup).not.toHaveBeenCalled();
    const corrected = await h.tool("end_call", { reason: "cannot_proceed", resultSummary: "It has not arrived." });
    expect(h.result(corrected).ok).toBe(true);
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions?.map(d => d.revision)).toEqual([1, 2]);
  });
  it("does not require a task-state tool from a reasoning delegation", async () => {
    const h = await native(); await h.accept();
    for (let n = 0; n < 3; n++) {
      h.live.receive({ type: "response.event", delegation_id: `reason-${n}`, event: { type: "response.created", response: { id: `reason-${n}` } } });
      h.live.receive({ type: "response.event", delegation_id: `reason-${n}`, event: { type: "response.completed", response: { id: `reason-${n}`, status: "completed", output: [] } } });
    }
    await flush(); await flush(); await vi.advanceTimersByTimeAsync(12_000);
    expect(h.twilio.readyState).toBe(1); expect(h.hangup).not.toHaveBeenCalled();
  });
  it("accepts optional missing delegation scope for usage but cannot execute an unattributed tool", async () => {
    const h = await native(); await h.accept(); h.transcript("input", "It arrived."); await vi.advanceTimersByTimeAsync(901);
    h.live.receive({ type: "response.event", event: { type: "response.created", response: { id: "unscoped" } } });
    h.live.receive({ type: "response.event", event: { type: "response.completed", response: { id: "unscoped", status: "completed", output: [
      { type: "function_call", call_id: "unscoped-call", name: "end_call", arguments: JSON.stringify({ reason: "objective_resolved", resultSummary: "It arrived." }) }
    ] } } });
    await flush(); await flush();
    expect(h.result("unscoped-call")).toEqual({ ok: false, reason: "unattributed_response" });
    expect(h.providerOperation).toHaveBeenCalledWith(expect.objectContaining({ stage: "live_delegation" }));
    expect(h.twilio.readyState).toBe(1); expect(h.hangup).not.toHaveBeenCalled();
  });
  it("selects managed control for protected appointments before startup", async () => {
    const h = await native(true);
    expect(h.live.sent.find(e => e.type === "session.start").session.input).toEqual([]);
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ runtime: "unified_live", selection: "protected_action" }), "Live runtime selected");
    await h.accept();
    expect(h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses.tools.map((t: any) => t.name)).toContain("request_appointment");
  });
  it("does not enable the task if recording startup fails", async () => {
    const h = await native(false, true); await h.accept();
    expect(h.live.sent.some(e => e.type === "session.instructions.append" && e.content.startsWith("Task enabled:"))).toBe(false);
  });
  it("returns tool results immediately despite an unrelated physical response still running", async () => {
    const h = await native(); await h.accept();
    h.live.receive({ type: "response.event", delegation_id: "slow", event: { type: "response.created", response: { id: "slow" } } });
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    expect(h.result(id).ok).toBe(true);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("returns every announced call output before one continuation for the completed batch", async () => {
    const h = await native(); await h.accept(); h.transcript("input", "It arrived."); await vi.advanceTimersByTimeAsync(901);
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    const send = (id: string, event: object) => h.live.receive({ type: "response.event", delegation_id: id, event });
    const item = (id: string) => ({ type: "function_call", call_id: id, name: "end_call", arguments: JSON.stringify({ reason: "objective_resolved", resultSummary: "It arrived." }) });
    for (const id of ["batch-a", "batch-b"]) {
      send(id, { type: "response.created", response: { id } });
      send(id, { type: "response.output_item.added", item: { ...item(id), arguments: "" } });
    }
    send("batch-a", { type: "response.output_item.done", item: item("batch-a") });
    send("batch-a", { type: "response.completed", response: { id: "batch-a", status: "completed", output: [] } });
    await flush(); await flush();
    expect(h.result("batch-a").ok).toBe(true);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    send("batch-b", { type: "response.output_item.done", item: item("batch-b") });
    send("batch-b", { type: "response.completed", response: { id: "batch-b", status: "completed", output: [] } });
    await flush(); await flush();
    expect(h.result("batch-b").ok).toBe(false);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
  });
  it("uses exact client correlation without optional delegation ID and preserves stale action fencing", async () => {
    const h = await native(); await h.accept();
    await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    const command = h.live.sent.findLast(e => e.type === "response.create");
    h.transcript("input", "Correction: it never arrived."); await vi.advanceTimersByTimeAsync(901);
    h.live.receive({ type: "response.event", client_event_id: command.event_id, event: { type: "response.created", response: { id: "late-continuation" } } });
    h.live.receive({ type: "response.event", event: { type: "response.completed", response: { id: "late-continuation", status: "completed", output: [
      { type: "function_call", call_id: "stale-finish", name: "end_call", arguments: JSON.stringify({ reason: "objective_resolved", resultSummary: "It arrived." }) }
    ] } } });
    await flush(); await flush();
    expect(h.result("stale-finish")).toMatchObject({ ok: false, reason: "stale_or_unauthorized_request" });
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toHaveLength(1);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("deduplicates repeated call IDs and rejects changed arguments without a second decision", async () => {
    const h = await native(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved", resultSummary: "It arrived." }, "It arrived.", false);
    const send = (responseId: string, summary: string) => {
      h.live.receive({ type: "response.event", delegation_id: responseId, event: { type: "response.created", response: { id: responseId } } });
      h.live.receive({ type: "response.event", delegation_id: responseId, event: { type: "response.completed", response: { id: responseId, status: "completed", output: [
        { type: "function_call", call_id: id, name: "end_call", arguments: JSON.stringify({ reason: "objective_resolved", resultSummary: summary }) }
      ] } } });
    };
    send("replay", "It arrived."); await flush(); await flush();
    send("collision", "Different result."); await flush(); await flush();
    const results = h.live.sent.filter(e => e.type === "response.item.create" && e.item.call_id === id).map(e => JSON.parse(e.item.output));
    expect(results.map(r => r.ok)).toEqual([true, true, false]);
    expect(results.at(-1).reason).toBe("tool_call_id_collision");
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toHaveLength(1);
  });
  it("never retries a continuation whose acceptance is ambiguous", async () => {
    const h = await native(); await h.accept();
    await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    const count = h.live.sent.filter(e => e.type === "response.create").length;
    await vi.advanceTimersByTimeAsync(15_001); await flush();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(count);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("revokes pending closing for a keypad answer too", async () => {
    const h = await native(); await h.accept();
    await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.");
    h.transcript("output", "Goodbye."); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_500);
    const mark = h.twilio.sent.findLast(e => e.event === "mark").mark.name;
    h.twilio.receive({ event: "dtmf", dtmf: { digit: "2" } });
    h.twilio.receive({ event: "mark", mark: { name: mark } });
    await vi.advanceTimersByTimeAsync(1_000); expect(h.hangup).not.toHaveBeenCalled();
  });
});

describe("opt-in hybrid consent", () => {
  const hybrid = (locale: CallLocale = "en-GB", reason: AssistanceReason = "none") =>
    harness("human", false, false, locale, false, "anna", reason, "hybrid_deterministic_v1");

  it.each([
    ["de-CH", "Ja gerne"], ["de-DE", "Klar"], ["fr-CH", "Bien sûr"], ["it-CH", "Va bene"],
    ["en-GB", "That's fine"], ["en-US", "Sure"], ["ru-RU", "Конечно"]
  ] as const)("grants a short %s answer after 200ms without semantic work", async (locale, answer) => {
    const h = await hybrid(locale); await h.play(); h.transcript("input", answer);
    await vi.advanceTimersByTimeAsync(199); expect(h.recording).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(h.recording).toHaveBeenCalledOnce();
    expect(h.recording.mock.calls[0][1]).toMatchObject({ method: "voice", decision: "affirmative",
      decisionMethod: "deterministic_voice", locale, callAttemptId: h.attempt.id,
      consentDecision: { decision: "affirmative", decisionMethod: "deterministic_voice" } });
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.role === "recipient")).toBe(false);
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain(answer);
    expect(h.service.getConsentRuntimePolicy).toHaveBeenCalledOnce();
  });

  it.each([
    ["de-CH", "Ja", ", aber bitte nicht aufnehmen"], ["de-DE", "Ja", ", aber bitte nicht aufnehmen"],
    ["fr-CH", "Oui", ", mais sans enregistrement"], ["it-CH", "Sì", ", ma non registrare"],
    ["en-GB", "Yes", ", but don't record"], ["en-US", "Yes", ", but don't record"],
    ["ru-RU", "Да", ", но не записывайте"]
  ] as const)("keeps split %s negation ahead of an affirmative prefix", async (locale, prefix, suffix) => {
    const h = await hybrid(locale); await h.play(); h.transcript("input", prefix);
    await vi.advanceTimersByTimeAsync(150); h.transcript("input", suffix);
    await vi.advanceTimersByTimeAsync(201); await flush();
    expect(h.recording).not.toHaveBeenCalled();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
    expect(h.requestedSpeech()).toBeTruthy();
    expect((await h.repository.get(h.brief.id))!.transcript.some(t => t.role === "recipient")).toBe(false);
  });

  it.each(["Yes, if you delete it", "Yes...", "Yes?"])("sends ambiguous %s to semantic at total 900ms", async answer => {
    const h = await hybrid(); await h.play(); h.transcript("input", answer);
    await vi.advanceTimersByTimeAsync(899); expect(h.recording).not.toHaveBeenCalled();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
    await h.tool("report_consent", { decision: "unclear" });
    expect(h.recording).not.toHaveBeenCalled(); expect(h.requestedSpeech()).toBeTruthy();
  });

  it.each([
    [["Ja", " ", "ger", "ne"], true],
    [["Ja", ",", " ", "aber", " ", "bitte", " ", "nicht", " ", "auf", "nehmen"], false]
  ] as const)("preserves spaces and split words in the consent buffer (%s)", async (fragments, affirmative) => {
    const h = await hybrid("de-CH"); await h.play();
    for (const fragment of fragments) { h.transcript("input", fragment); await vi.advanceTimersByTimeAsync(10); }
    await vi.advanceTimersByTimeAsync(201); await flush();
    expect(h.recording).toHaveBeenCalledTimes(affirmative ? 1 : 0);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
  });

  it("blocks unsolicited semantic permission before local arbitration", async () => {
    const h = await hybrid(); await h.play(); h.transcript("input", "Yes, if you delete it");
    const id = await h.tool("report_consent", { decision: "affirmative" });
    expect(h.result(id).ok).toBe(false); expect(h.recording).not.toHaveBeenCalled();
  });

  it("waits for acoustic stop and cancels the fast timer when speech resumes", async () => {
    const h = await hybrid(); await h.play();
    for (let n = 0; n < 5; n++) h.twilio.receive({ event: "media", media: { payload: speech } });
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(400);
    expect(h.recording).not.toHaveBeenCalled();
    for (let n = 0; n < 30; n++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(150);
    for (let n = 0; n < 5; n++) h.twilio.receive({ event: "media", media: { payload: speech } });
    h.transcript("input", ", but don't record"); await vi.advanceTimersByTimeAsync(300);
    expect(h.recording).not.toHaveBeenCalled();
    for (let n = 0; n < 30; n++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(201); expect(h.recording).not.toHaveBeenCalled();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
  });

  it("yields on a single voiced frame before the shared acoustic started threshold", async () => {
    const h = await hybrid(); await h.play(); h.transcript("input", "Yes");
    await vi.advanceTimersByTimeAsync(199);
    h.twilio.receive({ event: "media", media: { payload: Buffer.from(speech, "base64").subarray(0, 160).toString("base64") } });
    await vi.advanceTimersByTimeAsync(2); expect(h.recording).not.toHaveBeenCalled();
    h.transcript("input", ", but don't record");
    for (let n = 0; n < 30; n++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(201); expect(h.recording).not.toHaveBeenCalled();
  });

  it.each(["correction", "dtmf", "disconnect"] as const)("rechecks %s after waiting for durable playback evidence", async event => {
    const h = await hybrid();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = h.service.recordConsentDisclosure.bind(h.service);
    vi.spyOn(h.service, "recordConsentDisclosure").mockImplementation(async (...args) => { await pending; return original(...args); });
    await h.play(); h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(201);
    expect(h.recording).not.toHaveBeenCalled();
    if (event === "correction") h.transcript("input", ", but don't record");
    else if (event === "dtmf") h.twilio.receive({ event: "dtmf", dtmf: { digit: "2" } });
    else h.twilio.close();
    release(); await flush(); await vi.advanceTimersByTimeAsync(201); await flush();
    expect(h.recording).not.toHaveBeenCalled();
  });

  it("fails closed when the disclosure receipt cannot be saved", async () => {
    const h = await hybrid(); vi.spyOn(h.service, "recordConsentDisclosure").mockRejectedValue(new Error("database unavailable"));
    await h.play(); h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(201);
    expect(h.recording).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(3);
  });

  it("preserves semantic acceptance and distinguishes its evidence", async () => {
    const h = await hybrid(); await h.play(); h.transcript("input", "You have my permission to do that");
    await vi.advanceTimersByTimeAsync(900);
    await h.tool("report_consent", { decision: "affirmative" });
    expect(h.recording).toHaveBeenCalledOnce();
    expect(h.recording.mock.calls[0][1]).toMatchObject({ decisionMethod: "semantic_voice",
      consentDecision: { decisionMethod: "semantic_voice", decision: "affirmative" } });
  });

  it("runs hybrid admission through the real service/repository and links the recording audit", async () => {
    const h = await hybrid(); h.recording.mockRestore();
    Object.defineProperty(h.service.telephonyProvider, "mode", { value: "twilio" });
    const providerStart = vi.spyOn(h.service.telephonyProvider, "startRecording").mockResolvedValue({
      providerRecordingId: "RE-HYBRID-AUDIT", providerStatus: "in-progress"
    });
    const started = vi.spyOn(h.service, "startRecordingAfterConsent");
    await h.play();
    expect((await h.service.get(h.brief.id))!.recording).toBeNull();
    expect(providerStart).not.toHaveBeenCalled();
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(201); await flush(); await flush();
    expect(started).toHaveBeenCalledOnce();
    expect(providerStart).toHaveBeenCalledOnce();
    const snapshot = (await h.service.get(h.brief.id))!;
    expect(snapshot.recording?.startedAt).toBeTruthy();
    expect(snapshot.recording?.providerRecordingId).toBeTruthy();
    const events = await h.repository.listCallTelemetryEvents(h.brief.id);
    const relevant = events.filter(e => ["disclosure.completed", "consent.decision", "consent.granted", "recording.requested", "recording.started"].includes(e.payload.name));
    expect(relevant.map(e => e.payload.name)).toEqual(["disclosure.completed", "consent.decision", "consent.granted", "recording.requested", "recording.started"]);
    const receipt = relevant[0]!, decision = relevant[1]!;
    expect(decision.payload.metadata).toMatchObject({ disclosureReceiptId: receipt.id, decision: "affirmative", decisionMethod: "deterministic_voice" });
    expect(snapshot.transcript.some(t => t.role === "recipient")).toBe(false);
  });

  it.each(["voice", "dtmf"] as const)("keeps clarification and DTMF recovery with %s acceptance", async method => {
    const h = await hybrid(); await h.play();
    h.twilio.receive({ event: "dtmf", dtmf: { digit: "1" } }); await flush();
    expect(h.recording).not.toHaveBeenCalled();
    for (let stage = 0; stage < 2; stage++) {
      h.transcript("input", "What is this about?"); await vi.advanceTimersByTimeAsync(900);
      const id = await h.tool("report_consent", { decision: "unclear" });
      await h.continueClosing(id); await h.play();
    }
    if (method === "voice") { h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(201); }
    else h.twilio.receive({ event: "dtmf", dtmf: { digit: "1" } });
    await flush(); expect(h.recording).toHaveBeenCalledOnce();
    expect(h.recording.mock.calls[0][1]?.decisionMethod).toBe(method === "voice" ? "deterministic_voice" : "dtmf");
  });

  it("never locally accepts a tail after the transport discarded its pre-disclosure prefix", async () => {
    const h = await hybrid(); const mark = await h.play(false);
    h.live.receive({ type: "session.input_transcript.delta", delta: "I did not say ", start_ms: 0, end_ms: 50 });
    h.twilio.receive({ event: "mark", mark: { name: mark } }); h.transcript("input", "Yes");
    await vi.advanceTimersByTimeAsync(201); expect(h.recording).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  });

  it("resettles a candidate for semantic fallback when an older discarded fragment arrives late", async () => {
    const h = await hybrid();
    // Leave a real positive boundary instead of the test fixture's immediate mark.
    const mark = await h.play(false);
    for (let n = 0; n < 5; n++) h.twilio.receive({ event: "media", media: { payload: silence } });
    h.twilio.receive({ event: "mark", mark: { name: mark } });
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(100);
    h.live.receive({ type: "session.input_transcript.delta", delta: "earlier words", start_ms: 0, end_ms: 50 });
    await vi.advanceTimersByTimeAsync(899); expect(h.recording).not.toHaveBeenCalled();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  });

  it("keeps an explicit keypad refusal exclusive while its audit waits", async () => {
    const h = await hybrid(); await h.play();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = h.service.recordConsentDecision.bind(h.service);
    vi.spyOn(h.service, "recordConsentDecision").mockImplementation(async (...args) => { await pending; return original(...args); });
    h.twilio.receive({ event: "dtmf", dtmf: { digit: "2" } }); await flush();
    for (let n = 0; n < 5; n++) h.twilio.receive({ event: "media", media: { payload: speech } });
    h.transcript("input", "Yes");
    for (let n = 0; n < 30; n++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(901); expect(h.recording).not.toHaveBeenCalled();
    release(); await flush(); await flush();
    expect(h.requestedSpeech()).toContain("cannot continue");
    await h.play(); expect(await playbackDiagnostics(h)).toEqual([]);
    expect(h.recording).not.toHaveBeenCalled();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
  });

  it.each(["disconnect", "refusal"] as const)("invalidates a positive timer on %s", async event => {
    const h = await hybrid(); await h.play(); h.transcript("input", "Yes");
    await vi.advanceTimersByTimeAsync(150);
    if (event === "disconnect") h.twilio.close();
    else h.twilio.receive({ event: "dtmf", dtmf: { digit: "2" } });
    await vi.advanceTimersByTimeAsync(201); await flush(); expect(h.recording).not.toHaveBeenCalled();
  });

  const disclosureCases = SUPPORTED_CALL_LOCALES.flatMap(locale =>
    (["none", "speech_impairment", "language_barrier"] as const).flatMap(reason =>
      (["anna", "sebastian"] as const).map(profile => [locale, reason, profile] as const)));
  it.each(disclosureCases)("preserves %s / %s / %s disclosure and a single grant", async (locale, reason, profile) => {
    const h = await harness("human", false, false, locale, false, profile, reason, "hybrid_deterministic_v1"); await h.play();
    h.transcript("input", ({ "de-CH": "Ja", "de-DE": "Ja", "fr-CH": "Oui", "it-CH": "Sì", "en-GB": "Yes", "en-US": "Yes", "ru-RU": "Да" })[locale]);
    await vi.advanceTimersByTimeAsync(201); await flush();
    expect(h.speechRequests[0].input).toBe(h.snapshot.runtime.initialDisclosure!.text);
    expect(h.speechRequests).toHaveLength(1);
    h.twilio.receive({ event: "dtmf", dtmf: { digit: "1" } }); h.transcript("input", "Yes");
    await vi.advanceTimersByTimeAsync(1_000); expect(h.recording).toHaveBeenCalledOnce();
    expect(h.speechRequests).toHaveLength(1);
  });

  it.each(["speech_impairment", "language_barrier"] as const)("rejects consent without replaying the selected %s explanation", async reason => {
    const h = await hybrid("ru-RU", reason); await h.play();
    h.transcript("input", "Нет, не записывайте"); await vi.advanceTimersByTimeAsync(201); await flush();
    expect(h.recording).not.toHaveBeenCalled();
    expect(h.speechRequests[0].input).toBe(h.snapshot.runtime.initialDisclosure!.text);
    expect(h.speechRequests.slice(1).some(r => r.input.includes(h.snapshot.runtime.assistanceDisclosure))).toBe(false);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(0);
  });
});

async function harness(answer: string | null = "human", recordingFailure = false, appointment: boolean | AppointmentAuthorization = false, locale: CallLocale = "en-GB", asyncAnswering = false, profile: AssistantProfileId = "anna", assistanceReason: AssistanceReason = "speech_impairment", consentMode: "semantic_native" | "hybrid_deterministic_v1" = "semantic_native", allowedFacts?: string[], nativeExperiment = false) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  const call = await approvedCall(typeof appointment === 'object' ? appointment : appointment ? authorization : undefined, undefined, locale, "CA-LIVE", profile, assistanceReason, allowedFacts);
  if (consentMode === "hybrid_deterministic_v1") vi.spyOn(call.service, "getConsentRuntimePolicy").mockResolvedValue({
    mode: consentMode, revision: 1, classifierVersion: "consent-phrases-v1", fastSettleMs: 200, semanticSettleMs: 900
  });
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
    const snapshot = (await call.service.get(call.brief.id))!;
    return { ...snapshot, recording: { ...snapshot.recording, startedAt: new Date().toISOString() } } as typeof snapshot;
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
  // Tripwire on the actual transport, not an unused option on the bridge.
  // Application TTS is injected above; native delegation uses the live socket.
  const unexpectedFetch = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected standalone provider request"); });
  vi.stubGlobal("fetch", unexpectedFetch);
  const bridge = createVoiceRuntime({ apiKey: "test", service: call.service, agentHangupEnabled: true,
    validateStreamToken: (_binding, token) => token === "valid", createLiveSocket: connect,
    createOpenAISocket: legacy, createConsentSocket: legacy, speechFetch, logger }, { VOICE_RUNTIME_DRIVER: "live",
      ...(nativeExperiment ? { VOICE_RUNTIME_LIVE_EXPERIMENT: "native_v1" } : {}) });
  bridge.handleTwilioSocket(twilio.ws);
  const start = { event: "start", start: { callSid: "CA-LIVE", streamSid: "MZ", customParameters: { callBriefId: call.brief.id,
    callAttemptId: call.attempt.id, compilationSnapshotHash: call.snapshot.compilationSnapshotHash, streamToken: "valid" } } };
  twilio.receive(start); await flush();
  live.emit("open"); if (connect.mock.calls.length) live.startLive("one-live"); await flush();
  let time = 0;
  function transcript(role: "input" | "output", text: string) {
    time = Math.max(time, Date.now() - live.liveStartedAt, live.timelineMs);
    if (role === "input") {
      const forwardedMs = live.sent.filter(e => e.type === "session.input_audio.append")
        .reduce((total, e) => total + Buffer.from(e.audio as string, "base64").length / 8, 0);
      time = Math.max(time, forwardedMs, Date.now() - live.liveStartedAt, live.timelineMs);
    }
    live.receive({ type: `session.${role}_transcript.delta`, delta: text, start_ms: time, end_ms: time += 100 });
  }
  let lastPlayedMark = '';
  function requestedSpeech() {
    const mark = twilio.sent.filter(e => e.event === 'mark' &&
      (/^rendered-consent-/.test(e.mark.name) || /^live-application-/.test(e.mark.name))).at(-1)?.mark.name;
    if (!mark || mark === lastPlayedMark) return '';
    return speechRequests.at(-1)?.input ?? '';
  }
  async function play(acknowledge = true) {
    for (let pending = 0; pending < 4; pending++) await flush();
    const mark = twilio.sent.filter(e => e.event === 'mark' &&
      (/^rendered-consent-/.test(e.mark.name) || /^live-application-/.test(e.mark.name))).at(-1)?.mark.name;
    expect(mark).toBeTruthy();
    lastPlayedMark = mark;
    if (acknowledge) twilio.receive({ event: 'mark', mark: { name: mark } });
    await flush(); await flush();
    return mark as string;
  }
  async function accept(completeAssistance = true) {
    await play();
    transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(901); await flush();
    const id = await tool("report_consent", { decision: "affirmative" });
    await continueClosing(id);

  }
  async function closeNaturally(acknowledge = true, text = "Thank you for your help. Goodbye.") {
    // Native output cannot complete an application-owned terminal audio unit.
    transcript("output", text);
    live.receive({ type: "session.output_audio.delta", delta: speech });
    return play(acknowledge);
  }
  let sequence = 0;
  async function continueClosing(delegation: string, status = "completed") {
    const id = delegation + "-continuation";
    live.receive({ type: "response.event", delegation_id: delegation, event: { type: "response.created", response: { id } } });
    live.receive({ type: "response.event", delegation_id: delegation, event: { type: `response.${status}`, response: { id, status, output: [] } } });
    await flush(); await flush();
  }
  async function tool(name: string, args: unknown, text?: string, settlePlayback = true) {
    if (text) { transcript("input", text); await vi.advanceTimersByTimeAsync(901); await flush(); }
    const id = "response-" + ++sequence;
    const backend = (event: object) => live.receive({ type: "response.event", delegation_id: id, event });
    const toolArgs = name === "end_call" && args && typeof args === "object" && !("resultSummary" in args)
      ? { ...args, resultSummary: "The recipient's answer was recorded." }
      : name === "request_appointment" && args && typeof args === "object" && !("intent" in args) ? { ...args, intent: "request" } : args;
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
  return { ...call, twilio, live, legacy, connect, recording, hangup, dispatch, resolveAnswer, unexpectedFetch, speechFetch,
    speechRequests, providerOperation, logger, transcript, requestedSpeech, play, accept, closeNaturally, tool, continueClosing, result, start };
}

describe('recorded no-call backend findings: full runtime reproduction', () => {
  // Recorded 2026-11-02 Luna outputs; only date/time rebased to the approved
  // future fixture. Both consent and the production action journal run here.
  it('reproduces a premature request on an unanswered previous-visit question', async () => {
    const h = await harness('human', false, true, 'de-CH', false, 'anna', 'none'); await h.accept();
    h.transcript('input', '15:00 ist frei. Das unbekannte Geburtsdatum ist kein Problem.');
    await vi.advanceTimersByTimeAsync(901); await flush();
    await h.tool('request_appointment', { intent: 'request', proposal }, 'War Nina Keller schon einmal bei uns?');
    // Characterization: scope validation cannot detect a skipped semantic answer.
    const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ state: 'sending', delivery: { kind: 'request', attempt: 1 } });
    expect(h.requestedSpeech()).toBeTruthy();
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
  });

  it('rejects the recorded operation change without a second action, then recovers the original', async () => {
    const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
    await h.tool('request_appointment', { intent: 'request', proposal }, 'That time is available.');
    await h.play(false);
    h.transcript('input', 'I already booked that exact appointment. Do not create a second one.');
    await vi.advanceTimersByTimeAsync(901); await flush();
    const original = (await h.repository.exportCallTextData(h.brief.id)).voiceActions![0];
    expect(original.state).toBe('uncertain');
    const speechCount = h.speechRequests.length;
    const wrong = await h.tool('request_appointment', { intent: 'status_check', proposal: { ...proposal, operation: 'confirm_existing' } });
    expect(h.result(wrong)).toMatchObject({ ok: false, reason: 'operation_mismatch' });
    expect(h.speechRequests).toHaveLength(speechCount);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions).toEqual([original]);
    await h.tool('request_appointment', { intent: 'status_check', proposal });
    expect(h.requestedSpeech()).toContain('Do not create another booking'); await h.play();
    const confirmed = await h.tool('confirm_appointment', { proposal, confirmation: 'affirmative' }, 'Yes, that exact appointment is already booked.');
    expect(h.result(confirmed)).toMatchObject({ ok: true, state: 'confirmed', externallyVerified: false });
    const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: original.id, proposal, state: 'confirmed', delivery: { kind: 'status_check', attempt: 2 } });
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
  });
});

type RecordedBackendOutput = Array<{ type: string; name?: string; arguments?: string;
  content?: Array<{ type: string; text?: string }> }>;

async function replayBackendOutput(h: Awaited<ReturnType<typeof harness>>, output: RecordedBackendOutput) {
  for (const item of output) {
    if (item.type === 'function_call') {
      const args = JSON.parse(item.arguments!);
      // Only rebase the synthetic slot; preserve every observed decision/flag.
      if (args.proposal) args.proposal = { ...args.proposal, date: proposal.date, startTime: proposal.startTime };
      const id = await h.tool(item.name!, args);
      if (item.name === 'report_task_state') {
        expect(h.result(id).ok).toBe(true); await h.continueClosing(id);
      }
    } else if (item.type === 'message') {
      const id = 'recorded-factual-note';
      const backend = (event: object) => h.live.receive({ type: 'response.event', delegation_id: id, event });
      backend({ type: 'response.created', response: { id } });
      backend({ type: 'response.output_item.done', item: { ...item, role: 'assistant' } });
      backend({ type: 'response.completed', response: { id, status: 'completed', output: [] } });
      await flush(); await flush();
    } else throw new Error(`Unexpected recorded output type: ${item.type}`);
  }
}

describe('recorded corrected backend outputs through the full runtime', () => {
  it('includes all reviewed final candidate outputs', () => {
    expect(backendReplay.cases).toHaveLength(22);
    for (const scenario of ['visit-unknown-de', 'status-only-de', 'dob-known-de']) {
      expect(backendReplay.cases.filter(c => c.scenario === scenario)).toHaveLength(5);
    }
    expect(backendReplay.cases.filter(c => c.scenario === 'dob-withheld-de')).toHaveLength(3);
  });
  it.each(backendReplay.cases.filter(c => c.scenario === 'visit-unknown-de'))('$id answers unknown visits before allowing a booking', async record => {
    const h = await harness('human', false, true, 'de-CH', false, 'anna', 'none'); await h.accept();
    h.transcript('input', '15:00 ist frei. Das unbekannte Geburtsdatum ist kein Problem.');
    await vi.advanceTimersByTimeAsync(901); await flush();
    h.transcript('input', 'War Test Patient schon einmal bei uns?');
    await vi.advanceTimersByTimeAsync(901); await flush();
    const speechCount = h.speechRequests.length;
    await replayBackendOutput(h, record.output);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions ?? []).toEqual([]);
    expect(h.speechRequests).toHaveLength(speechCount);
    expect(h.hangup).not.toHaveBeenCalled();
    // Native speech is simulated, not an acoustic or model-quality assertion.
    h.transcript('output', 'Ob es frühere Besuche gab, ist mir nicht bekannt.');
    h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    await h.tool('request_appointment', { intent: 'request', proposal }, 'Das ist kein Problem. Alle Angaben reichen aus, der Termin um 15:00 ist frei.');
    expect(h.requestedSpeech()).toBeTruthy(); await h.play();
    const confirmed = await h.tool('confirm_appointment', { proposal, confirmation: 'affirmative' }, 'Ja, dieser eine Termin ist eingetragen.');
    expect(h.result(confirmed)).toMatchObject({ ok: true, state: 'confirmed' });
    const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ proposal, state: 'confirmed', delivery: { kind: 'request', attempt: 1 } });
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
  });

  describe.each([true, false])('existing uncertain action=%s', pending => {
    it.each(backendReplay.cases.filter(c => c.scenario === 'status-only-de'))('$id reconciles exactly one appointment', async record => {
      const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
      if (pending) { await h.tool('request_appointment', { intent: 'request', proposal }, 'That time is available.'); await h.play(false); }
      h.transcript('input', 'I already booked that exact appointment. Please do not create a second one.');
      await vi.advanceTimersByTimeAsync(901); await flush();
      const original = (await h.repository.exportCallTextData(h.brief.id)).voiceActions?.[0];
      if (pending) expect(original?.state).toBe('uncertain');
      await replayBackendOutput(h, record.output);
      expect(h.requestedSpeech()).toContain('Do not create another booking');
      const early = await h.tool('confirm_appointment', { proposal, confirmation: 'affirmative' });
      expect(h.result(early)).toMatchObject({ ok: false, reason: 'another_action_pending' });
      await h.play();
      const confirmed = await h.tool('confirm_appointment', { proposal, confirmation: 'affirmative' }, 'Yes, that exact appointment was already booked.');
      expect(h.result(confirmed)).toMatchObject({ ok: true, state: 'confirmed', externallyVerified: false });
      const duplicate = await h.tool('request_appointment', { intent: 'request', proposal });
      expect(h.result(duplicate)).toMatchObject({ ok: false, reason: 'appointment_already_requested' });
      const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ ...(pending ? { id: original!.id } : {}), proposal, state: 'confirmed',
        delivery: { kind: 'status_check', attempt: pending ? 2 : 1 } });
      expect(h.unexpectedFetch).not.toHaveBeenCalled();
    });
  });

  it.each(backendReplay.cases.filter(c => ['visit-accepted-de', 'confirm-existing-de'].includes(c.scenario)))('$id preserves both authorized appointment operations', async record => {
    const existing = record.scenario === 'confirm-existing-de';
    const exact = { ...proposal, operation: existing ? 'confirm_existing' as const : 'book' as const };
    const permission = existing ? { ...authorization, operation: 'confirm_existing' as const,
      windows: [{ date: proposal.date, startTime: proposal.startTime, endTime: proposal.startTime }] } : authorization;
    const h = await harness('human', false, permission, 'en-GB', false, 'anna', 'none'); await h.accept();
    h.transcript('input', existing ? 'That exact existing appointment is in our calendar.' :
      'The unknown birth date and previous visits are no problem. All details suffice; that exact time is available.');
    await vi.advanceTimersByTimeAsync(901); await flush();
    await replayBackendOutput(h, record.output);
    expect(h.requestedSpeech()).toBeTruthy(); await h.play();
    const confirmed = await h.tool('confirm_appointment', { proposal: exact, confirmation: 'affirmative' }, 'Yes, that one exact appointment is booked.');
    expect(h.result(confirmed)).toMatchObject({ ok: true, state: 'confirmed' });
    const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ proposal: exact, state: 'confirmed',
      delivery: { kind: existing ? 'status_check' : 'request', attempt: 1 } });
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
  });

  it.each(backendReplay.cases.filter(c => c.scenario === 'dob-withheld-de'))('$id closes an explicit impossibility without another question or booking', async record => {
    const h = await harness('human', false, true, 'de-CH', false, 'anna', 'none', 'semantic_native',
      ['Das Geburtsdatum darf nicht weitergegeben werden.']); await h.accept();
    h.transcript('input', 'Ohne Geburtsdatum kann ich keinen Termin bestätigen.');
    await vi.advanceTimersByTimeAsync(901); await flush();
    await replayBackendOutput(h, record.output);
    expect(h.requestedSpeech()).toBeTruthy();
    expect(h.hangup).not.toHaveBeenCalled();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions ?? []).toEqual([]);
    await h.play(); expect(h.hangup).toHaveBeenCalledOnce();
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
  });

  it.each(backendReplay.cases.filter(c => ['dob-known-de', 'dob-unknown-de', 'dob-unknown-ru'].includes(c.scenario)))('$id answers a factual question without a commitment', async record => {
    if (record.scenario === 'dob-known-de') {
      for (const item of record.output) if ('arguments' in item) {
        expect(item.type).toBe('function_call');
        expect(item.name).toBe('report_task_state');
        expect(JSON.parse(item.arguments!)).toMatchObject({ state: 'continue' });
      }
    }
    const h = await harness('human', false, true, record.scenario.endsWith('-ru') ? 'ru-RU' : 'de-CH', false, 'anna', 'none',
      'semantic_native', record.scenario === 'dob-known-de' ? ['Geburtsdatum: 12. April 1990.'] : []); await h.accept();
    h.transcript('input', record.scenario.endsWith('-ru') ? 'Какая дата рождения у Test Patient?' : 'Wie lautet das Geburtsdatum von Test Patient?');
    await vi.advanceTimersByTimeAsync(901); await flush();
    const before = h.speechRequests.length;
    await replayBackendOutput(h, record.output);
    expect(h.speechRequests).toHaveLength(before);
    expect(h.hangup).not.toHaveBeenCalled();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions ?? []).toEqual([]);
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
  });
});

async function playbackDiagnostics(h: Awaited<ReturnType<typeof harness>>) {
  return (await h.repository.listCallTelemetryEvents(h.brief.id)).flatMap(event =>
    event.payload.name === 'conversation.task' && event.payload.metadata.playback
      ? [{ generation: event.payload.metadata.revision, ...event.payload.metadata.playback }] : []);
}

describe('application playback diagnostics', () => {
  it('separates recording admission from first audio and stores only technical startup/render/output measurements', async () => {
    const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none', 'hybrid_deterministic_v1'); await h.play();
    h.recording.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 120));
      const snapshot = (await h.service.get(h.brief.id))!;
      return { ...snapshot, recording: { ...snapshot.recording, startedAt: new Date().toISOString() } } as typeof snapshot;
    });
    h.transcript('input', 'Yes'); await vi.advanceTimersByTimeAsync(401); await flush();
    h.live.receive({ type: 'session.output_audio.delta', delta: speech }); await flush();
    h.twilio.close(); await flush(); await flush();
    const diagnostics = (await h.repository.listCallTelemetryEvents(h.brief.id)).flatMap(event =>
      event.payload.name === 'conversation.task' && event.payload.metadata.diagnostic ? [event.payload.metadata.diagnostic] : []);
    const first = diagnostics.find(d => d.kind === 'consent_to_audio')!;
    expect(first).toMatchObject({ kind: 'consent_to_audio', source: 'native', recordingAdmissionMs: 120 });
    if (first.kind !== 'consent_to_audio') throw new Error('missing consent latency');
    expect(first.decisionToSendMs).toBe(first.recordingAdmissionMs + first.afterRecordingAdmissionMs);
    expect(first.lastBoundaryToSendMs).toBeGreaterThanOrEqual(first.decisionToSendMs);
    expect(diagnostics).toContainEqual(expect.objectContaining({ kind: 'startup', path: 'cold', outcome: 'released' }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ kind: 'speech_render', stage: 'disclosure', outcome: 'succeeded',
      journalBeforeMs: expect.any(Number), journalAfterMs: expect.any(Number), headersMs: expect.any(Number), bodyMs: expect.any(Number) }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ kind: 'audio_output', nativeFrames: 1, nativeAudioMs: 100, renderCacheMisses: 1 }));
    expect(JSON.stringify(diagnostics)).not.toContain(h.snapshot.plan.localizedObjective);
    expect(JSON.stringify(diagnostics)).not.toContain(h.brief.representedPerson);
  });
  it('writes terminal lifecycle outcomes even while optional diagnostics are hung', async () => {
    const h = await harness(); await h.accept(); let release!: () => void;
    const original = h.service.recordTelemetry.bind(h.service);
    const write = vi.spyOn(h.service, 'recordTelemetry').mockImplementation(original);
    // Only the next write hangs; terminal outcomes must not sit behind it.
    write.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined as never); }));
    h.live.receive({ type: 'session.output_audio.delta', delta: speech }); await flush();
    h.twilio.close(); await flush();
    expect(write).toHaveBeenCalledWith(h.brief.id, expect.objectContaining({
      payload: expect.objectContaining({ name: 'conversation.ended' })
    }));
    release(); await flush();
  });
  it('continues voice when general telemetry fails without exposing its error', async () => {
    const h = await harness(); await h.accept();
    vi.spyOn(h.service, 'recordTelemetry').mockRejectedValue(new Error('PRIVATE_TELEMETRY_ERROR'));
    h.transcript('output', 'The first task response.');
    h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    await flush(); await flush();
    expect(h.twilio.readyState).toBe(1);
    expect(h.twilio.sent.findLast(e => e.event === 'media').media.payload).toBe(speech);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'LIVE_TELEMETRY_UNAVAILABLE' }), expect.any(String));
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('PRIVATE_TELEMETRY_ERROR');
    const id = await h.tool('end_call', { reason: 'recipient_requested_end' }, 'Goodbye.');
    expect(h.result(id).ok).toBe(true);
    await h.play(); expect(h.hangup).toHaveBeenCalledOnce();
  });
  it.each(SUPPORTED_CALL_LOCALES)('uses one complete failure farewell after no answer in %s', async locale => {
    const h = await harness('human', false, false, locale); await h.accept();
    await vi.advanceTimersByTimeAsync(45_001);
    const id = await h.tool('end_call', { reason: 'cannot_proceed' });
    expect(h.result(id).ok).toBe(true);
    expect(h.speechRequests.at(-1)?.input).toBe(liveTaskFailureCopy[locale]);
    expect(h.hangup).not.toHaveBeenCalled();
    await h.play(); expect(h.hangup).toHaveBeenCalledOnce();
  });
  it('records interrupted and acknowledged generations without treating sent text as heard', async () => {
    const h = await harness(); await h.accept();
    expect(await playbackDiagnostics(h)).toEqual([]);
    const summary = 'The application arrived yesterday.';
    await h.tool('end_call', { reason: 'objective_resolved', resultSummary: summary }, 'It arrived yesterday.');
    const old = await h.play(false);
    expect(await playbackDiagnostics(h)).toEqual([]); // No per-frame writes.
    h.twilio.receive({ event: 'media', media: { payload: speech } }); await flush();
    const interrupted = (await playbackDiagnostics(h))[0]!;
    expect(interrupted).toMatchObject({ owner: 'closing', markId: old, outcome: 'interrupted', reason: 'acoustic_activity',
      requestedAt: expect.any(String), renderedAt: expect.any(String), releasedAt: expect.any(String), endedAt: expect.any(String), durationMs: expect.any(Number) });
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text.includes(summary))).toBe(false);
    for (let i = 0; i < 30; i++) h.twilio.receive({ event: 'media', media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(901);
    h.twilio.receive({ event: 'mark', mark: { name: old } }); await flush();
    expect(h.hangup).not.toHaveBeenCalled(); expect(await playbackDiagnostics(h)).toHaveLength(1);
    const current = await h.play();
    h.twilio.receive({ event: 'mark', mark: { name: current } }); await flush();
    const diagnostics = await playbackDiagnostics(h);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[1]).toMatchObject({ outcome: 'acknowledged', reason: 'mark', markId: current });
    expect(diagnostics[1]!.generation).toBeGreaterThan(interrupted.generation);
    expect(JSON.stringify(diagnostics)).not.toContain(summary);
    expect(JSON.stringify(diagnostics)).not.toContain(h.brief.representedPerson);
    expect(Buffer.byteLength(JSON.stringify(diagnostics[0]))).toBeLessThan(700);
    expect((await h.service.get(h.brief.id))!.transcript.filter(t => t.text.includes(summary))).toHaveLength(1);
    expect(h.hangup).toHaveBeenCalledOnce();
    h.live.receive({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 } }); await flush(); await flush();
    expect((await h.repository.getNativeTranscriptAttemptWork(h.brief.id, h.attempt.id)).capture?.issues)
      .toContainEqual({ code: 'application_interrupted' });
  });
  it('records cancellation before render without inventing release or a transcript', async () => {
    const h = await harness(); await h.accept();
    let release!: (value: Response) => void;
    h.speechFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const summary = 'The application arrived.';
    await h.tool('end_call', { reason: 'objective_resolved', resultSummary: summary }, 'It arrived.');
    h.transcript('input', 'Wait, there is a correction.'); await flush();
    const diagnostics = await playbackDiagnostics(h);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ outcome: 'not_released', reason: 'recipient_transcript', durationMs: null });
    expect(diagnostics[0]).not.toHaveProperty('renderedAt'); expect(diagnostics[0]).not.toHaveProperty('releasedAt');
    release(new Response(Buffer.alloc(4_800))); await flush(); await flush();
    expect(await playbackDiagnostics(h)).toEqual(diagnostics);
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text.includes(summary))).toBe(false);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it('records render failure separately from successful retry', async () => {
    const h = await harness(); await h.accept();
    h.speechFetch.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_ERROR'));
    await h.tool('end_call', { reason: 'recipient_requested_end' }, 'Goodbye.');
    await h.play(); await flush();
    const diagnostics = await playbackDiagnostics(h);
    expect(diagnostics.map(d => [d.outcome, d.reason])).toEqual([['not_released', 'render_failed'], ['acknowledged', 'mark']]);
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_PROVIDER_ERROR');
  });
  it('distinguishes rendered audio held for speech from audio actually released', async () => {
    const h = await harness('human', false, true); await h.accept();
    let release!: (value: Response) => void;
    h.speechFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await h.tool('request_appointment', { proposal }, 'That time is available.');
    h.twilio.receive({ event: 'media', media: { payload: speech } });
    release(new Response(Buffer.alloc(4_800))); await flush(); await flush();
    h.transcript('input', 'Wait, a required detail is missing.'); await flush();
    const diagnostics = await playbackDiagnostics(h);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ owner: 'appointment', outcome: 'not_released', renderedAt: expect.any(String), durationMs: expect.any(Number) });
    expect(diagnostics[0]).not.toHaveProperty('releasedAt');
  });
  it.each(['deadline', 'disconnect'] as const)('records %s without an acknowledged outcome', async end => {
    const h = await harness(); await h.accept();
    await h.tool('end_call', { reason: 'recipient_requested_end' }, 'Goodbye.');
    await h.play(false);
    if (end === 'deadline') await vi.advanceTimersByTimeAsync(30_001);
    else h.twilio.close();
    await flush();
    expect(await playbackDiagnostics(h)).toEqual([expect.objectContaining({ outcome: 'interrupted', reason: end === 'deadline' ? 'deadline' : 'closed' })]);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it.each(['pending', 'failed'] as const)('does not delay audio or hangup when a diagnostic write is %s', async mode => {
    const h = await harness(); await h.accept();
    const record = h.service.recordTelemetry.bind(h.service);
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, fail) => { reject = fail; });
    vi.spyOn(h.service, 'recordTelemetry').mockImplementation((id, input) =>
      input.payload.name === 'conversation.task' && input.payload.metadata.playback
        ? mode === 'pending' ? pending : Promise.reject(new Error('PRIVATE_DIAGNOSTIC_ERROR')) : record(id, input));
    await h.tool('end_call', { reason: 'recipient_requested_end' }, 'Goodbye.');
    await h.play(); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
    if (mode === 'pending') { reject(new Error('PRIVATE_DIAGNOSTIC_ERROR')); await flush(); }
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'LIVE_PLAYBACK_DIAGNOSTIC_FAILED' }), 'Playback diagnostic unavailable');
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('PRIVATE_DIAGNOSTIC_ERROR');
  });
  it('records interrupted appointment playback without changing its uncertain action', async () => {
    const h = await harness('human', false, true); await h.accept();
    const id = await h.tool('request_appointment', { proposal }, 'That time is available.');
    await h.play(false);
    h.transcript('input', 'Wait, I need a detail first.'); await vi.advanceTimersByTimeAsync(901);
    expect(h.result(id)).toMatchObject({ ok: false, state: 'uncertain' });
    expect(await playbackDiagnostics(h)).toEqual([expect.objectContaining({ owner: 'appointment', outcome: 'interrupted', reason: 'recipient_transcript' })]);
  });
});

describe('inline assistance reason admission', () => {
  const cases = SUPPORTED_CALL_LOCALES.flatMap(locale => (['none', 'speech_impairment', 'language_barrier'] as const)
    .flatMap(reason => (['anna', 'sebastian'] as const).map(profile => [locale, reason, profile] as const)));
  it.each(cases)('plays full %s / %s / %s before recording, then enables task without another reason gate', async (locale, reason, profile) => {
    const h = await harness('human', false, false, locale, false, profile, reason);
    const expected = buildInitialDisclosure(locale, h.brief.representedPerson, h.snapshot.runtime.voiceGender, reason).text;
    expect(h.snapshot.runtime.initialDisclosure?.text).toBe(expected);
    expect(h.speechRequests[0]?.input).toBe(expected);
    expect(expected).toContain('Nina Keller');
    expect(h.recording).not.toHaveBeenCalled();
    await h.accept();
    expect(h.recording).toHaveBeenCalledOnce();
    expect(h.speechRequests).toHaveLength(1);
    expect(h.live.sent.some(event => event.type === 'session.update' &&
      event.session.delegation.responses.tools.some((tool: { name: string }) => tool.name === 'report_task_state'))).toBe(true);
    expect(h.connect).toHaveBeenCalledOnce(); expect(h.legacy).not.toHaveBeenCalled();
  });
  it.each(['speech_impairment', 'language_barrier'] as const)('does not enable task or record after refusal with %s', async reason => {
    const h = await harness('human', false, false, 'ru-RU', false, 'anna', reason);
    await h.play();
    const id = await h.tool('report_consent', { decision: 'negative' }, 'Нет, не записывайте.');
    expect(h.result(id).ok).toBe(true); expect(h.recording).not.toHaveBeenCalled();
    expect(h.speechRequests[0].input).toBe(h.snapshot.runtime.initialDisclosure?.text);
    const journal = h.providerOperation.mock.invocationCallOrder[h.providerOperation.mock.calls.findIndex(([op]) => op.stage === "live_disclosure_synthesis" && op.result === null)];
    expect(journal).toBeLessThan(h.speechFetch.mock.invocationCallOrder[0]!);
  });
});

describe("complex-call orchestration regression", () => {
  it("publishes one native-based final transcript after the closing playback write drains, without recording ASR", async () => {
    const h = await harness("human", false, false, "de-CH", false, "anna", "none");
    h.recording.mockImplementation(async (_id, evidence) => {
      const begun = await h.repository.beginRecording(h.brief.id, evidence);
      await h.repository.attachProviderRecording(begun.recording.id, "RE-v6", "in-progress");
      return (await h.repository.get(h.brief.id))!;
    });
    await h.accept();
    h.transcript("output", "Was möchten Sie zum Mittagessen?");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(300);
    const id = await h.tool("end_call", { reason: "objective_resolved", resultSummary: "Sie möchten also Pizza zum Mittagessen." }, "Ich möchte Pizza.");
    expect(h.result(id).ok).toBe(true);
    const persist = h.service.addApplicationPlaybackTranscript.bind(h.service);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(h.service, "addApplicationPlaybackTranscript").mockImplementation(async (...args) => { await pending; return persist(...args); });
    await h.play();
    expect(h.hangup).toHaveBeenCalledOnce();
    h.live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12 } });
    await flush();
    const recordingId = (await h.repository.get(h.brief.id))!.recording!.id;
    expect((await h.repository.getNativeTranscriptWork(recordingId)).capture?.status).toBe("collecting");
    release(); await flush(); await flush();
    vi.useRealTimers();
    await expect.poll(async () => (await h.repository.get(h.brief.id))?.finalTranscript?.status).toBe("completed");
    const snapshot = (await h.repository.get(h.brief.id))!;
    expect(snapshot.finalTranscript?.source).toBe("live_composed");
    expect(snapshot.finalTranscript?.text).toContain("Ich möchte Pizza.");
    expect(snapshot.finalTranscript?.text).toContain("Sie möchten also Pizza zum Mittagessen.");
    expect(snapshot.finalTranscript?.segments.at(-1)).toMatchObject({ source: "application_playback", applicationPlayback: { sessionId: "one-live" } });
    expect((await h.repository.getCurrentTranscriptRevision(h.brief.id))?.segments.at(-1)?.source).toBe("application_playback");
    expect(h.legacy).not.toHaveBeenCalled();
  });
  it("retains an ambiguous announced lease and suppresses its late effects", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none"); await h.accept();
    h.live.receive({ type: "session.delegation.created", delegation: { id: "announced-old", response_id: "not-started", target: "responses" } });
    const fresh = await h.tool("report_task_state", { state: "continue", summary: "A required detail was supplied." }, "Here is a newer detail.");
    expect(h.result(fresh).ok).toBe(true); await h.continueClosing(fresh);
    await vi.advanceTimersByTimeAsync(15_001); await flush();
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(1);
    expect(h.requestedSpeech()).toContain("can't reliably continue");
    const backend = (event: object) => h.live.receive({ type: "response.event", delegation_id: "announced-old", event });
    backend({ type: "response.created", response: { id: "not-started" } });
    backend({ type: "response.output_item.done", item: { type: "function_call", call_id: "late-old-call", name: "end_call",
      arguments: JSON.stringify({ reason: "cannot_proceed", resultSummary: "Old decision" }) } });
    backend({ type: "response.completed", response: { id: "not-started", status: "completed", output: [] } });
    await flush(); await flush();
    expect(h.live.sent.some(e => e.type === "response.item.create" && e.item.call_id === "late-old-call")).toBe(false);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("does not retry an old continuation command after newer progress in the same input epoch", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none"); await h.accept();
    const old = await h.tool("report_task_state", { state: "continue", summary: "Continue to the next question." }, "The requested detail is available.");
    const command = h.live.sent.filter(e => e.type === "response.create").at(-1)!;
    const fresh = await h.tool("report_task_state", { state: "continue", summary: "The updated action state is understood." });
    expect(h.result(old).ok).toBe(true); expect(h.result(fresh).ok).toBe(true);
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    h.live.receive({ type: "error", event_id: "late-command-error", error: { code: "invalid_request_error", type: "invalid_request_error", client_event_id: command.event_id } });
    await flush();
    // The rejected old command releases the lease for the queued NEW continuation.
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ disposition: "continued" }), "Live command failed");
    expect(h.hangup).not.toHaveBeenCalled(); await h.continueClosing(fresh);
  });
  it('settles a known continuation across a recipient revision without waiting for command timeout', async () => {
    const h = await harness(); await h.accept();
    const old = await h.tool('report_task_state', { state: 'continue', summary: 'Ask the next question.' }, 'The first detail is ready.');
    const command = h.live.sent.findLast(e => e.type === 'response.create');
    const before = h.live.sent.filter(e => e.type === 'response.create').length;
    const answeredAt = Date.now();
    h.transcript('input', 'Here is a correction to that detail.'); await vi.advanceTimersByTimeAsync(601);
    await h.continueClosing(old);
    await vi.advanceTimersByTimeAsync(4_998);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(2);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before + 1);
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ requestedAt: answeredAt + 5_600 }), 'Live task decision requested');
    // A late error for the settled command must not retry or consume the fresh one.
    h.live.receive({ type: 'error', error: { code: 'invalid_request_error', client_event_id: command.event_id } }); await flush();
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before + 1);
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(1);
  });
  it('starts a queued newer continuation when the known older continuation completes', async () => {
    const h = await harness(); await h.accept();
    const old = await h.tool('report_task_state', { state: 'continue', summary: 'First progress.' }, 'The first detail is ready.');
    const fresh = await h.tool('report_task_state', { state: 'continue', summary: 'Newer progress in the same answer.' });
    const before = h.live.sent.filter(e => e.type === 'response.create').length;
    await h.continueClosing(old);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before + 1);
    await h.continueClosing(fresh); await vi.advanceTimersByTimeAsync(15_001);
    expect(h.logger.warn).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'ack_timeout' }), 'Live command failed');
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before + 1);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it('keeps a recognized stale continuation physically occupied past the command deadline until it finishes', async () => {
    const h = await harness(); await h.accept();
    const old = await h.tool('report_task_state', { state: 'continue', summary: 'Ask the next question.' }, 'The first detail is ready.');
    const before = h.live.sent.filter(e => e.type === 'response.create').length;
    h.transcript('input', 'Here is a newer detail.'); await vi.advanceTimersByTimeAsync(601);
    const id = old + '-slow';
    const backend = (event: object) => h.live.receive({ type: 'response.event', delegation_id: old, event });
    backend({ type: 'response.created', response: { id } });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before);
    expect(h.logger.warn).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'ack_timeout' }), 'Live command failed');
    backend({ type: 'response.completed', response: { id, status: 'completed', output: [] } });
    await flush(); await vi.advanceTimersByTimeAsync(1);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before + 1);
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(1);
  });
  it.each(['answer', 'progress'] as const)('does not refresh an old continuation appointment tool after newer %s', async changed => {
    const h = await harness('human', false, true); await h.accept();
    const old = await h.tool('report_task_state', { state: 'continue', summary: 'Collect required details.' }, 'That time is available.');
    if (changed === 'answer') {
      h.transcript('input', 'Wait, that time is no longer available.'); await vi.advanceTimersByTimeAsync(601);
    } else {
      await h.tool('report_task_state', { state: 'continue', summary: 'Newer progress invalidates the older decision.' });
    }
    const backend = (event: object) => h.live.receive({ type: 'response.event', delegation_id: old, event });
    const id = old + '-late';
    backend({ type: 'response.created', response: { id } });
    backend({ type: 'response.completed', response: { id, status: 'completed', output: [{
      type: 'function_call', call_id: 'stale-booking', name: 'request_appointment', arguments: JSON.stringify({ proposal, intent: 'request' })
    }] } }); await flush(); await flush();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions).toEqual([]);
    expect(h.result('stale-booking')).toMatchObject({ ok: false, reason: 'stale_or_unauthorized_request' });
    expect(h.speechRequests).toHaveLength(1);
  });
  it("keeps the total pre-consent wait finite even while input energy continues", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none");
    for (let voiced = 0; voiced < 5; voiced++) h.twilio.receive({ event: "media", media: { payload: speech } });
    await vi.advanceTimersByTimeAsync(60_001); await flush();
    expect(h.twilio.readyState).toBe(3); expect(h.recording).not.toHaveBeenCalled();
    expect((await h.repository.get(h.brief.id))!.transcript).toHaveLength(0);
  });
  it("keeps one mandatory disclosure through repeated short energy bursts without recognized speech", async () => {
    const h = await harness("human", false, false, "ru-RU", false, "sebastian", "none");
    for (let interruption = 0; interruption < 4; interruption++) {
      h.twilio.receive({ event: "media", media: { payload: speech } });
      for (let quiet = 0; quiet < 30; quiet++) h.twilio.receive({ event: "media", media: { payload: silence } });
      await flush(); await flush();
    }
    expect((await h.repository.listCallTelemetryEvents(h.brief.id)).filter(e => e.payload.name === "disclosure.started")).toHaveLength(1);
    expect(h.connect).toHaveBeenCalledOnce(); expect(h.recording).not.toHaveBeenCalled();
    await h.accept(); expect(h.recording).toHaveBeenCalledOnce();
  });
  it("bounds sustained disclosure interruption without accepting cleared marks", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none");
    for (let interruption = 0; interruption < 3; interruption++) {
      for (let voiced = 0; voiced < 5; voiced++) h.twilio.receive({ event: "media", media: { payload: speech } });
      for (let quiet = 0; quiet < 30; quiet++) h.twilio.receive({ event: "media", media: { payload: silence } });
      await flush(); await flush();
    }
    expect(h.twilio.readyState).toBe(3); expect(h.recording).not.toHaveBeenCalled();
    expect((await h.repository.listCallTelemetryEvents(h.brief.id)).filter(e => e.payload.name === "disclosure.started")).toHaveLength(3);
  });
  it("does not end newer successful work when an old response times out", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none"); await h.accept();
    const completed = vi.spyOn(h.service, "completeProviderOperation");
    h.live.receive({ type: "response.event", delegation_id: "old-task", event: { type: "response.created", response: { id: "old-task-response" } } });
    const fresh = await h.tool("report_task_state", { state: "continue", summary: "A new required detail was supplied." }, "Here is the additional detail.");
    expect(h.result(fresh).ok).toBe(true); await h.continueClosing(fresh);
    await vi.advanceTimersByTimeAsync(30_001); await flush(); await flush();
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ providerResponseId: "old-task-response", errorCode: "LIVE_BACKEND_TIMEOUT" }));
    expect(h.live.sent.some(e => String(e.content).includes("can't reliably continue"))).toBe(false);
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(1);
  });
  it("revokes an already pending failure after a newer accepted decision", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none"); await h.accept();
    h.live.receive({ type: "response.event", delegation_id: "old-task", event: { type: "response.created", response: { id: "old-task-response" } } });
    await vi.advanceTimersByTimeAsync(29_500);
    h.transcript("output", "Here is the requested detail.");
    h.live.receive({ type: "session.output_audio.delta", delta: Buffer.alloc(16_000, 128).toString("base64") });
    await vi.advanceTimersByTimeAsync(501);
    const fresh = await h.tool("report_task_state", { state: "continue", summary: "The recipient confirmed the additional detail." }, "The detail is correct.");
    expect(h.result(fresh).ok).toBe(true); await h.continueClosing(fresh);
    await vi.advanceTimersByTimeAsync(2_200); await flush();
    expect(h.live.sent.some(e => String(e.content).includes("can't reliably continue"))).toBe(false);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("retains a finite failure path for an actually current unanswered backend response", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none"); await h.accept();
    h.live.receive({ type: "response.event", delegation_id: "current-task", event: { type: "response.created", response: { id: "current-task-response" } } });
    await vi.advanceTimersByTimeAsync(30_001); await flush();
    expect(h.requestedSpeech()).toContain("can't reliably continue");
  });
  it("does not cancel an unreleased commitment on brief noise and still requires exact subsequent confirmation", async () => {
    const h = await harness("human", false, true, "en-GB", false, "anna", "none"); await h.accept();
    await h.tool("request_appointment", { proposal }, "That time is available.");
    h.twilio.receive({ event: "media", media: { payload: speech } });
    for (let quiet = 0; quiet < 30; quiet++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await flush(); await flush();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("sending");
    await h.play();
    const confirmed = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" }, "Yes, that exact appointment is booked.");
    expect(h.result(confirmed).ok).toBe(true);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions).toHaveLength(1);
  });
  it("checks only the same uncertain arrangement after collecting missing details", async () => {
    const h = await harness("human", false, true, "en-GB", false, "anna", "none"); await h.accept();
    await h.tool("request_appointment", { proposal }, "That time is available.");
    h.transcript("input", "I need the full name first."); await vi.advanceTimersByTimeAsync(901); await flush();
    const original = (await h.repository.exportCallTextData(h.brief.id)).voiceActions![0];
    expect(original).toMatchObject({ state: "uncertain", delivery: { status: "unacknowledged", attempt: 1 } });
    await h.tool("request_appointment", { proposal });
    expect(h.requestedSpeech()).toContain("check only the status"); await h.play();
    const confirmed = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" }, "Yes, this exact appointment is now booked.");
    expect(h.result(confirmed).ok).toBe(true);
    const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
    expect(actions).toHaveLength(1); expect(actions[0]).toMatchObject({ id: original.id, delivery: { kind: "status_check", attempt: 2 } });
  });
  it("checks the status of the same possibly-heard arrangement without requesting a second booking", async () => {
    const h = await harness("human", false, true, "en-GB", false, "anna", "none"); await h.accept();
    await h.tool("request_appointment", { proposal }, "That time is available.");
    const cleared = await h.play(false);
    h.transcript("input", "I need the full name first."); await vi.advanceTimersByTimeAsync(901); await flush();
    h.twilio.receive({ event: "mark", mark: { name: cleared } }); await flush();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0]).toMatchObject({ state: "uncertain", delivery: { status: "unacknowledged" } });
    const early = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" }, "Yes, booked.");
    expect(h.result(early).ok).toBe(false);
    await h.tool("request_appointment", { proposal });
    expect(h.requestedSpeech()).toContain("check only the status"); expect(h.requestedSpeech()).toContain("Do not create another booking");
    await h.play();
    const refused = await h.tool("confirm_appointment", { proposal, confirmation: "negative" }, "No, it is not booked.");
    expect(h.result(refused).ok).toBe(false);
    const changed = await h.tool("confirm_appointment", { proposal: { ...proposal, startTime: "16:00" }, confirmation: "affirmative" });
    expect(h.result(changed).ok).toBe(false);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("delivered");
    const confirmed = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" }, "Yes, that exact appointment was already booked.");
    expect(h.result(confirmed)).toMatchObject({ ok: true, externallyVerified: false });
    const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
    expect(actions).toHaveLength(1); expect(actions[0]).toMatchObject({ state: "confirmed", delivery: { kind: "status_check", attempt: 2 } });
  });
});

describe("asynchronous answering alongside the disclosure", () => {
  it.each([false, true])("retains late audible text before mute and falls back only for a crossing fragment (crossing=%s)", async crossing => {
    const h = await harness(); await h.accept();
    const capture = vi.spyOn(h.service, "setNativeTranscriptCapture");
    const start = Date.now() - h.live.liveStartedAt + 10;
    await vi.advanceTimersByTimeAsync(250);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(250);
    await h.tool("end_call", { reason: "objective_resolved", resultSummary: "You confirmed receipt." }, "It arrived.");
    const mediaCount = h.twilio.sent.filter(event => event.event === "media").length;
    h.live.receive({ type: "session.output_transcript.delta", delta: "Late native words.", start_ms: start,
      end_ms: crossing ? Date.now() - h.live.liveStartedAt : start + 100 });
    await h.play();
    h.live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12 } });
    for (let i = 0; i < 10; i++) await flush();
    expect((await h.repository.get(h.brief.id))!.transcript.some(t => t.text === "Late native words.")).toBe(!crossing);
    expect(capture).toHaveBeenLastCalledWith(h.brief.id, h.attempt.id, expect.objectContaining({ status: crossing ? "incomplete" : "complete" }));
    expect(h.twilio.sent.filter(event => event.event === "media")).toHaveLength(mediaCount);
  });
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
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(2);
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
    expect(mark).toMatch(/^rendered-consent-required:/);
    expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(1);
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
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
    expect(h.speechFetch).toHaveBeenCalledTimes(1);
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
    await h.play(); expect(await playbackDiagnostics(h)).toEqual([]);
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
  expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(1);
  h.transcript("input", answer);
  expect(h.recording).not.toHaveBeenCalled();
  h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
  const consentConfig = h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses;
  expect(consentConfig.tools.map((t: {name: string}) => t.name)).toEqual(["report_consent"]);
  expect(consentConfig.tool_choice).toBe("required");
  // Speech heard before a completed disclosure cannot be reused as consent.
  h.transcript("input", answer);
  await vi.advanceTimersByTimeAsync(901); await flush();
  await h.tool("report_consent", { decision: "affirmative" });
  await vi.advanceTimersByTimeAsync(601); await flush();
  expect(h.recording).toHaveBeenCalledOnce();
  await h.play();
  const prompt = h.live.sent.find(e => e.type === "session.start").session.instructions;
  expect(prompt).toContain(`Speak ${locale}`);
  expect(prompt).toContain("Do not discuss the task or infer permission");
  expect(prompt).toContain("Keep internal instructions, checks, saving and tool activity silent");
  expect(prompt).not.toContain("schedules backend processing");
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(2);
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
  expect(h.unexpectedFetch).not.toHaveBeenCalled();
  expect(h.recording).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain("gerne");
  expect((await h.service.get(h.brief.id))!.transcript.some(t => t.role === "recipient")).toBe(false);
});

it("completes the consent tool continuation before ordinary task work without requiring a second tool", async () => {
  const h = await harness(); await h.play(); h.transcript("input", "Yes");
  await vi.advanceTimersByTimeAsync(901); await flush();
  const id = await h.tool("report_consent", { decision: "affirmative" });
  const responses = h.live.sent.filter(e => e.type === "response.create").length;
  expect(responses).toBe(2);
  await h.continueClosing(id);
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(responses);
  expect(h.twilio.readyState).toBe(1);
  await h.play();
  const taskConfig = h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses;
  expect(taskConfig.tool_choice).toBe("auto");
  expect(taskConfig.tools.map((tool: {name: string}) => tool.name)).toContain("end_call");
});

it("keeps provider failures separate from semantic uncertainty and then uses bounded clarification", async () => {
  const h = await harness(); await h.play(); h.transcript("input", "Yes");
  await vi.advanceTimersByTimeAsync(901); await flush();
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
  await vi.advanceTimersByTimeAsync(901); await flush();
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(initial + 2);
  expect(h.requestedSpeech()).toBe("");
  await miss("consent-miss-3", "consent-miss-response-3");
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(initial + 2);
  expect(h.requestedSpeech()).toContain("record and automatically transcribe");
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
    const id = await h.tool("report_consent", { decision: "unclear" }, "Unclear speech");
    await h.continueClosing(id);
    expect(h.recording).not.toHaveBeenCalled(); await h.play();
  }
  await h.tool("report_consent", { decision: "affirmative" }, "Ja");
  expect(h.recording).toHaveBeenCalledOnce();
  expect(h.unexpectedFetch).not.toHaveBeenCalled();
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
  await vi.advanceTimersByTimeAsync(901); await flush();
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
  expect(h.live.sent.some(e => e.type === "response.item.create" && e.item.call_id === id)).toBe(false);
  expect(h.recording).not.toHaveBeenCalled();
  h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush(); await flush();
  expect(h.result(id)).toMatchObject({ ok: false, reason: "awaiting_recipient_answer" });
  await h.continueClosing(id);
  h.transcript("input", "No, do not record");
  await h.tool("report_consent", { decision: "negative" });
  expect(h.requestedSpeech()).toContain("cannot continue");
});

it.each([
  ["de-CH", "Ja, gerne."], ["de-DE", "Ja, das erlaube ich."], ["fr-CH", "Oui, je vous autorise."],
  ["it-CH", "Sì, acconsento."], ["en-GB", "Yes, I consent."], ["en-US", "Sure, that's fine."],
  ["ru-RU", "Разрешаю."]
] as const)("accepts a semantic %s answer that starts after mandatory audio but before its mark", async (locale, answer) => {
  const h = await harness("human", false, false, locale, false, "sebastian", "none");
  const mark = await h.play(false);
  await vi.advanceTimersByTimeAsync(101);
  for (let frame = 0; frame < 5; frame++) h.twilio.receive({ event: "media", media: { payload: speech } });
  h.transcript("input", answer);
  h.twilio.receive({ event: "mark", mark: { name: mark } });
  for (let frame = 0; frame < 30; frame++) h.twilio.receive({ event: "media", media: { payload: silence } });
  await vi.advanceTimersByTimeAsync(901); await flush();
  expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  await h.tool("report_consent", { decision: "affirmative" });
  expect(h.recording).toHaveBeenCalledOnce();
});

it("keeps Live input full-duplex and replays a disclosure interrupted by recipient speech", async () => {
  const h = await harness("human", false, false, "en-GB", false, "sebastian", "none");
  const oldMark = await h.play(false);
  const before = h.live.sent.filter(e => e.type === "session.input_audio.append").length;
  for (let voiced = 0; voiced < 5; voiced++) h.twilio.receive({ event: "media", media: { payload: speech } });
  expect(h.live.sent.filter(e => e.type === "session.input_audio.append")).toHaveLength(before + 5);
  expect(h.twilio.sent.at(-1).event).toBe("clear");
  h.twilio.receive({ event: "mark", mark: { name: oldMark } }); await flush();
  expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(2);
  expect(h.live.sent.findLast(e => e.type === "session.update").session.delegation.responses.tool_choice).toBe("none");
  for (let index = 0; index < 30; index++) h.twilio.receive({ event: "media", media: { payload: silence } });
  await flush(); await flush();
  const newMark = h.twilio.sent.filter(e => e.event === "mark").at(-1)?.mark.name;
  expect(newMark).toMatch(/^rendered-consent-required:/); expect(newMark).not.toBe(oldMark);
  h.twilio.receive({ event: "mark", mark: { name: oldMark } });
  expect(h.live.sent.filter(e => e.type === "session.update")).toHaveLength(3);
  h.twilio.receive({ event: "mark", mark: { name: newMark } }); await flush();
  h.transcript("input", "Yes, I agree"); await h.tool("report_consent", { decision: "affirmative" });
  expect(h.recording).toHaveBeenCalledOnce();
});

it("does not treat a delayed transcript from before the completed replay as consent", async () => {
  const h = await harness("human", false, false, "en-GB", false, "sebastian", "none");
  await h.play(false);
  for (let voiced = 0; voiced < 5; voiced++) h.twilio.receive({ event: "media", media: { payload: speech } });
  for (let index = 0; index < 30; index++) h.twilio.receive({ event: "media", media: { payload: silence } });
  await flush(); await flush(); await h.play();
  const decisions = h.live.sent.filter(e => e.type === "response.create").length;
  h.live.receive({ type: "session.input_transcript.delta", delta: "Yes", start_ms: 0, end_ms: 100 });
  await vi.advanceTimersByTimeAsync(901); await flush();
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
    expect(h.speechRequests[0]).toMatchObject({ voice: "cedar", model: "gpt-4o-mini-tts" });
    expect(h.speechRequests[0].input).toContain("Nina Keller");
    expect(h.speechRequests[0].input).toBe(h.snapshot.runtime.initialDisclosure?.text);
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
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
    const unclear = await h.tool("report_consent", { decision: "unclear" });
    await h.continueClosing(unclear);
    h.twilio.receive({ event: "mark", mark: { name: oldMark } });
    expect(h.recording).not.toHaveBeenCalled();
    await h.play();
    expect(h.speechRequests).toHaveLength(2);
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
    expect(h.live.sent.some(e => e.type === "response.item.create" && e.item.call_id === id)).toBe(false);
    expect(h.recording).not.toHaveBeenCalled();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush(); await flush();
    expect(h.result(id)).toMatchObject({ ok: false, reason: "awaiting_recipient_answer" });
    await h.continueClosing(id);
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
    expect(h.speechRequests).toHaveLength(renderings + 1);
    expect(h.requestedSpeech()).toContain("record and automatically transcribe");
    expect(h.recording).not.toHaveBeenCalled();
  });
  it("requests one task decision when native delegation is absent", async () => {
    const h = await harness(); await h.accept(); await h.continueClosing("response-1");
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    h.transcript("input", "I like pizza."); h.transcript("output", "Noted, thank you.");
    await vi.advanceTimersByTimeAsync(601); await flush();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
    await h.tool("end_call", { reason: "objective_resolved" });
    expect(h.hangup).not.toHaveBeenCalled();
    await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it.each(["nested", "top-level"])("does not duplicate a native decision announced with %s response_id", async shape => {
    const h = await harness(); await h.accept(); await h.continueClosing("response-1");
    h.transcript("input", "It arrived.");
    h.live.receive({ type: "session.delegation.created", ...(shape === "top-level" ? { response_id: "native-response" } : {}),
      delegation: { id: "native", ...(shape === "nested" ? { response_id: "native-response" } : {}), target: "responses" } });
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    await vi.advanceTimersByTimeAsync(1_801);
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
    const preparation = h.live.sent.find(e => e.type === "session.instructions.append" && String(e.content).startsWith("Prepare the approved task silently."));
    expect(preparation.content).toContain("check readiness only if the recipient has not already invited continuation or answered the task");
    expect(preparation.content).toContain("Do not repeat the greeting, identity, assistance reason or disclosures, ask permission to record again");
    expect(h.live.sent.findLast(e => e.type === "session.instructions.append").content).toMatch(/^Begin the approved task now\./);
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
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
    await h.continueClosing(id); await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it.each(["backend_failed", "backend_missing"])("recovers %s with one bounded exact farewell", async failure => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    if (failure === "backend_missing") await vi.advanceTimersByTimeAsync(8_001);
    else await h.continueClosing(id, "failed");
    expect(h.requestedSpeech()).toBe("The recipient's answer was recorded. Thank you. Goodbye.");
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
    const checks = h.unexpectedFetch.mock.calls.length;
    h.transcript("output", "The application arrived yesterday. Thank you, goodbye.");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_001); await flush();
    const mark = h.twilio.sent.filter(e => e.event === "mark").at(-1)?.mark.name;
    expect(mark).toMatch(/^live-application-/);
    expect(h.unexpectedFetch).toHaveBeenCalledTimes(checks);
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
    await vi.advanceTimersByTimeAsync(601);
    await h.tool("report_task_state", { state: "resume_conversation", summary: "The recipient has a new question." });
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
    expect(h.twilio.readyState).toBe(1);
    await vi.advanceTimersByTimeAsync(14_000); await flush();
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(3);
  });
  it("retries a failed terminal render with the same recap and saves its source decision", async () => {
    const h = await harness(); await h.accept();
    h.speechFetch.mockRejectedValueOnce(new Error("temporary rendering outage"));
    const summary = "The application arrived yesterday.";
    await h.tool("end_call", { reason: "objective_resolved", resultSummary: summary }, "It arrived yesterday.", false);
    await flush(); await flush();
    expect(h.speechRequests.at(-1)?.input).toBe(summary + " Thank you. Goodbye.");
    expect(h.hangup).not.toHaveBeenCalled();
    const data = await h.repository.exportCallTextData(h.brief.id);
    expect(data.terminalDecisions).toHaveLength(1);
    expect(data.terminalDecisions![0]).toMatchObject({ callAttemptId: h.attempt.id, summary,
      snapshotHash: h.snapshot.compilationSnapshotHash, observations: [{ id: "turn-1", text: "It arrived yesterday." }] });
    await h.play(); expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("does not attribute a recipient-first terminal race to an accepted agent hangup", async () => {
    const h = await harness(); await h.accept();
    h.hangup.mockResolvedValue(false);
    await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    await h.play(); await flush();
    const events = await h.repository.listCallTelemetryEvents(h.brief.id);
    const ended = events.find(event => event.payload.name === "conversation.ended");
    expect(ended?.payload.metadata).toMatchObject({ reason: "socket_closed" });
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("does not let an interrupted closing continuation time out a resumed conversation", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    h.live.receive({ type: "response.event", delegation_id: id, event: { type: "response.created", response: { id: "pending-closing" } } });
    h.transcript("input", "Wait, I have a correction.");
    await vi.advanceTimersByTimeAsync(601);
    await h.tool("report_task_state", { state: "resume_conversation", summary: "The recipient needs to correct the answer." });
    await vi.advanceTimersByTimeAsync(30_001); await flush();
    expect(h.twilio.readyState).toBe(1); expect(h.hangup).not.toHaveBeenCalled();
  });
  it.each([false, true])("ordinary speech needs no classification (appointment=%s)", async appointment => {
    const h = await harness("human", false, appointment); await h.accept();
    const calls = h.unexpectedFetch.mock.calls.length, media = h.twilio.sent.filter(e => e.event === "media").length;
    h.transcript("output", "Which date works for you?"); h.live.receive({ type: "session.output_audio.delta", delta: speech }); await flush();
    expect(h.unexpectedFetch).toHaveBeenCalledTimes(calls);
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(media + 1);
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text.includes("Which date"))).toBe(true);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  });
  it("renders the accepted factual summary and hangs up only after verified playback", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived yesterday.");
    expect(h.result(id)).toMatchObject({ ok: true, state: "closing_authorized", actionCompleted: false });
    expect(h.live.sent.filter(e => e.type === "response.item.create" && e.item.type === "message")).toEqual([]);
    expect(h.requestedSpeech()).toBe("The recipient's answer was recorded. Thank you. Goodbye.");
    const mark = await h.closeNaturally(false);
    expect(h.hangup).not.toHaveBeenCalled();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
    expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text === "The recipient's answer was recorded. Thank you. Goodbye.")).toBe(true);
  });
  it("does not hang up on a cleared mark; resumes naturally after an interruption", async () => {
    const h = await harness(); await h.accept();
    await h.tool("end_call", { reason: "recipient_requested_end" }, "Goodbye.");
    const mark = await h.closeNaturally(false); h.transcript("input", "Wait, a correction.");
    h.twilio.receive({ event: "mark", mark: { name: mark } });
    h.transcript("output", "What would you like to correct?"); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.hangup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(601); await flush();
    await h.tool("report_task_state", { state: "resume_conversation", summary: "A material correction requires another answer." });
    await h.tool("end_call", { reason: "recipient_requested_end" }); await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("recovers cleared closing playback without reopening the task on acoustic noise alone", async () => {
    const h = await harness(); await h.accept();
    await h.tool("end_call", { reason: "recipient_requested_end" }, "Goodbye.");
    const staleMark = await h.closeNaturally(false);
    const renders = h.speechFetch.mock.calls.length;
    const requests = h.live.sent.filter(e => e.type === 'response.create').length;
    const decisions = (await h.repository.exportCallTextData(h.brief.id)).terminalDecisions;
    const marks = h.twilio.sent.filter(e => e.event === 'mark').length;
    h.twilio.receive({ event: "media", media: { payload: speech } });
    for (let i = 0; i < 30; i++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(899);
    expect(h.twilio.sent.filter(e => e.event === 'mark')).toHaveLength(marks);
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(h.twilio.sent.filter(e => e.event === 'mark')).toHaveLength(marks + 1);
    expect(h.speechFetch).toHaveBeenCalledTimes(renders);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(requests);
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toEqual(decisions);
    const events = await h.repository.listCallTelemetryEvents(h.brief.id);
    expect(events.filter(e => e.payload.name === 'conversation.hangup' && e.payload.metadata.phase === 'requested')).toHaveLength(2);
    expect(events.some(e => e.payload.name === 'conversation.hangup' && e.payload.metadata.phase === 'interrupted')).toBe(false);
    expect(h.requestedSpeech()).toBe("The recipient's answer was recorded. Thank you. Goodbye.");
    h.twilio.receive({ event: "mark", mark: { name: staleMark } }); await flush();
    expect(h.hangup).not.toHaveBeenCalled();
    const fallbackMark = await h.play(false);
    h.twilio.receive({ event: "mark", mark: { name: fallbackMark } }); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it('does not restart closing for an 80ms energy burst without transcript', async () => {
    const h = await harness(); await h.accept();
    await h.tool('end_call', { reason: 'recipient_requested_end' }, 'Goodbye.');
    const mark = await h.play(false);
    const clears = h.twilio.sent.filter(e => e.event === 'clear').length;
    const marks = h.twilio.sent.filter(e => e.event === 'mark').length;
    const frame = Buffer.alloc(160, 128).toString('base64');
    for (let i = 0; i < 4; i++) {
      h.twilio.receive({ event: 'media', media: { payload: frame } }); await vi.advanceTimersByTimeAsync(20);
    }
    for (let i = 0; i < 30; i++) {
      h.twilio.receive({ event: 'media', media: { payload: silence } }); await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(901);
    expect(h.twilio.sent.filter(e => e.event === 'clear')).toHaveLength(clears);
    expect(h.twilio.sent.filter(e => e.event === 'mark')).toHaveLength(marks);
    expect(h.hangup).not.toHaveBeenCalled();
    h.twilio.receive({ event: 'mark', mark: { name: mark } }); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
  });
  it('lets delayed correction text cancel acoustic closing recovery before its replay', async () => {
    const h = await harness(); await h.accept();
    await h.tool('end_call', { reason: 'recipient_requested_end' }, 'Goodbye.');
    const staleMark = await h.play(false);
    const marks = h.twilio.sent.filter(e => e.event === 'mark').length;
    h.twilio.receive({ event: 'media', media: { payload: speech } });
    for (let i = 0; i < 30; i++) h.twilio.receive({ event: 'media', media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(850);
    h.transcript('input', 'Wait, I need to correct the answer.');
    await vi.advanceTimersByTimeAsync(601);
    expect(h.twilio.sent.filter(e => e.event === 'mark')).toHaveLength(marks);
    h.twilio.receive({ event: 'mark', mark: { name: staleMark } }); await flush();
    expect(h.hangup).not.toHaveBeenCalled();
    const resumed = await h.tool('report_task_state', { state: 'resume_conversation', summary: 'A material correction requires an answer.' });
    expect(h.result(resumed).ok).toBe(true); await h.continueClosing(resumed);
    h.transcript('output', 'What needs correcting?');
    const media = h.twilio.sent.filter(e => e.event === 'media').length;
    h.live.receive({ type: 'session.output_audio.delta', delta: speech }); await flush();
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(media + 1);
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(1);
  });
  it('keeps the original closing deadline through repeated acoustic-only interruptions', async () => {
    const h = await harness(); await h.accept();
    const end = await h.tool('end_call', { reason: 'recipient_requested_end' }, 'Goodbye.', false);
    const startedAt = Date.now();
    await h.continueClosing(end);
    for (let cycle = 0; cycle < 5; cycle++) {
      await h.play(false);
      h.twilio.receive({ event: 'media', media: { payload: speech } });
      for (let i = 0; i < 30; i++) h.twilio.receive({ event: 'media', media: { payload: silence } });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(h.twilio.readyState).toBe(1);
    }
    await vi.advanceTimersByTimeAsync(startedAt + 29_999 - Date.now());
    expect(h.twilio.readyState).toBe(1);
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(h.twilio.readyState).toBe(3); expect(h.hangup).not.toHaveBeenCalled();
    expect(h.speechRequests).toHaveLength(2);
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
    const h = await harness("human", false, true); await h.accept(); const count = h.unexpectedFetch.mock.calls.length;
    const id = await h.tool("request_appointment", { proposal: { ...proposal, startTime: "20:00" } }, "20:00 is available.");
    expect(h.result(id).reason).toBe("outside_authorized_window"); expect(h.unexpectedFetch).toHaveBeenCalledTimes(count);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions).toEqual([]);
  });
  it("journals before buffered commitment playback, requires later exact confirmation and prevents repeat booking", async () => {
    const h = await harness("human", false, true); await h.accept();
    const before = h.twilio.sent.filter(e => e.event === "media").length;
    await h.tool("request_appointment", { proposal }, "That time is available.");
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("sending");
    const renderedMedia = h.twilio.sent.filter(e => e.event === "media").length;
    expect(renderedMedia).toBeGreaterThan(before);
    h.transcript("output", h.requestedSpeech()); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(renderedMedia);
    await vi.advanceTimersByTimeAsync(501); h.twilio.receive({ event: "mark", mark: h.twilio.sent.findLast(e => e.event === "mark").mark }); await flush();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("delivered");
    const early = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" });
    expect(h.result(early).reason).toBe("another_action_pending");
    const changed = await h.tool("confirm_appointment", { proposal: { ...proposal, startTime: "16:00" }, confirmation: "affirmative" }, "Actually, 16:00.");
    expect(h.result(changed).reason).toBe("exact_delivered_proposal_required");
    const confirmed = await h.tool("confirm_appointment", { proposal, confirmation: "affirmative" }, "Yes, the original 15:00 is booked.");
    expect(h.result(confirmed)).toMatchObject({ ok: true, source: "recipient_report", externallyVerified: false,
      appointmentDetails: { date: proposal.date, weekdayIso: 3, weekdayLabel: "Wednesday",
        startTime: proposal.startTime, timeZone: proposal.timeZone } });
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].observations).toContainEqual({ id: "turn-3", text: "Yes, the original 15:00 is booked." });
    const duplicate = await h.tool("request_appointment", { proposal });
    expect(h.result(duplicate).reason).toBe("appointment_already_requested");
  });
  it("retains disclosure evidence without persisting pre-consent recipient words", async () => {
    const h = await harness(); await h.accept(); const transcript = (await h.service.get(h.brief.id))!.transcript;
    expect(transcript.filter(t => t.role === "assistant")).toHaveLength(1);
    expect(transcript.some(t => t.text === h.snapshot.runtime.initialDisclosure?.text)).toBe(true);
    expect(transcript.some(t => t.role === "recipient")).toBe(false);
  });
  it("does not replay an interrupted commitment or accept its cleared mark", async () => {
    const h = await harness("human", false, true); await h.accept();
    await h.tool("request_appointment", { proposal }, "That time is available.");
    const mark = await h.play(false);
    h.transcript("input", "Wait, that time no longer works."); await flush();
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("uncertain");
    await vi.advanceTimersByTimeAsync(601); await flush();
    const repeat = await h.tool("request_appointment", { proposal: { ...proposal, startTime: "16:00" } });
    expect(h.result(repeat).reason).toBe("appointment_already_requested");
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("suppresses late autonomous speech while playing an application-rendered appointment request", async () => {
    const h = await harness("human", false, true); await h.accept();
    const previous = h.requestedSpeech();
    await h.tool("request_appointment", { proposal }, "That time is available.", false);
    h.transcript("output", "One moment, please.");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.requestedSpeech()).not.toBe(previous);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(501);
    expect(h.requestedSpeech()).toContain("15:00");
    expect(h.requestedSpeech()).not.toContain("Europe/Zurich");
    await h.play();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0]).toMatchObject({
      state: "delivered", proposal: { date: proposal.date, startTime: "15:00", timeZone: "Europe/Zurich" }
    });
    expect(h.twilio.readyState).toBe(1);
  });
  it("continues the appointment tool with the actual subsequent answer, never a premature waiting report", async () => {
    const h = await harness("human", false, true); await h.accept();
    const id = await h.tool("request_appointment", { proposal }, "That time is available.");
    await h.play();
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(2);
    expect(h.live.sent.some(e => e.type === "response.item.create" && e.item.call_id === id)).toBe(false);
    h.transcript("input", "No, that time is no longer available.");
    await vi.advanceTimersByTimeAsync(601); await flush();
    expect(h.result(id)).toMatchObject({ state: "delivered", actionCompleted: false,
      recipientReply: { source: "observed_recipient_speech", text: "No, that time is no longer available." } });
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(3);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("delivered");
  });
});

describe("stable Live transitions", () => {
  it.each(["render", "playback"] as const)("keeps one closing generation across repeated tools during %s", async stage => {
    const h = await harness(); await h.accept();
    let release: ((response: Response) => void) | undefined;
    if (stage === "render") h.speechFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await h.tool("end_call", { reason: "objective_resolved", resultSummary: "The application arrived." }, "It arrived.");
    const clears = h.twilio.sent.filter(e => e.event === "clear").length;
    const renders = h.speechFetch.mock.calls.length;
    const decisions = (await h.repository.exportCallTextData(h.brief.id)).terminalDecisions;
    const repeated = await h.tool("report_task_state", { state: "keep_closing", summary: "Continue the authorized farewell." });
    expect(h.result(repeated).ok).toBe(true);
    await h.continueClosing(repeated);
    const duplicate = await h.tool("end_call", { reason: "objective_resolved", resultSummary: "A rephrased summary must not replace active playback." });
    expect(h.result(duplicate)).toMatchObject({ ok: true, resultSummary: "The application arrived." });
    expect(h.speechFetch.mock.calls).toHaveLength(renders);
    expect(h.twilio.sent.filter(e => e.event === "clear")).toHaveLength(clears);
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toEqual(decisions);
    release?.(new Response(Buffer.alloc(4_800))); await flush(); await flush();
    const mark = await h.play(false);
    h.twilio.receive({ event: "mark", mark: { name: "live-application-stale" } }); await flush();
    expect(h.hangup).not.toHaveBeenCalled();
    h.twilio.receive({ event: "mark", mark: { name: mark } });
    h.twilio.receive({ event: "mark", mark: { name: mark } }); await flush(); await flush();
    expect(h.hangup).toHaveBeenCalledOnce();
    const events = await h.repository.listCallTelemetryEvents(h.brief.id);
    expect(events.filter(e => e.payload.name === "conversation.hangup" && e.payload.metadata.phase === "requested")).toHaveLength(1);
  });

  it("requests backend two seconds after native speech without shortening the first grace window", async () => {
    const h = await harness(); await h.accept();
    h.transcript("output", "What would you like?"); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    h.transcript("input", "Pizza, please."); await vi.advanceTimersByTimeAsync(4_000);
    h.transcript("output", "Noted."); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    const lastNative = Date.now();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ requestedAt: lastNative + 2_000,
      quietDueAt: lastNative + 2_000 }), "Live task decision requested");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
  });

  it("preserves the first native grace window and cancels its timer on disconnect", async () => {
    const h = await harness(); await h.accept();
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    h.transcript("input", "Pizza, please."); await vi.advanceTimersByTimeAsync(5_599);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    h.twilio.close(); await vi.advanceTimersByTimeAsync(5_001);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
  });

  it("extends the two-second quiet window for new voiced output, but not silent audio packets", async () => {
    const h = await harness(); await h.accept();
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    h.transcript("input", "Pizza, please."); await vi.advanceTimersByTimeAsync(4_000);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_900);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_999);
    h.live.receive({ type: "session.output_audio.delta", delta: silence });
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
  });

  it("waits for recipient speech and the new answer's grace when the quiet deadline expires", async () => {
    const h = await harness(); await h.accept();
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    h.transcript("input", "Pizza, please."); await vi.advanceTimersByTimeAsync(4_000);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    await vi.advanceTimersByTimeAsync(1_900);
    for (let n = 0; n < 5; n++) h.twilio.receive({ event: "media", media: { payload: speech } });
    h.transcript("input", "Actually, pasta."); await vi.advanceTimersByTimeAsync(2_001);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    for (let n = 0; n < 30; n++) h.twilio.receive({ event: "media", media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(5_599);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(2);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
  });

  it.each(["semantic", "deterministic", "dtmf"] as const)("opens first audio only after confirmed recording with %s consent", async method => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none",
      method === "semantic" ? "semantic_native" : "hybrid_deterministic_v1");
    const startRecording = h.recording.getMockImplementation()!;
    let release!: () => void;
    const pendingRecording = new Promise<void>(resolve => { release = resolve; });
    h.recording.mockImplementation(async (...args) => { await pendingRecording; return startRecording(...args); });
    await h.play();
    if (method === "dtmf") {
      for (let stage = 0; stage < 2; stage++) {
        h.transcript("input", "What is this about?"); await vi.advanceTimersByTimeAsync(900);
        const id = await h.tool("report_consent", { decision: "unclear" });
        await h.continueClosing(id); await h.play();
      }
      h.twilio.receive({ event: "dtmf", dtmf: { digit: "1" } });
    }
    else {
      h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(method === "semantic" ? 901 : 201);
      if (method === "semantic") await h.tool("report_consent", { decision: "affirmative" });
    }
    await flush();
    const starts = () => h.live.sent.filter(e => e.type === "session.instructions.append" && String(e.content).startsWith("Begin the approved task now."));
    const before = h.twilio.sent.filter(e => e.event === "media").length;
    expect(h.recording).toHaveBeenCalledOnce(); expect(starts()).toHaveLength(0);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(before);
    release(); await flush(); await flush();
    expect(starts()).toHaveLength(1);
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(before + 1);
    expect(h.speechRequests).toHaveLength(method === "dtmf" ? 3 : 1);
  });

  it("preserves a whole opening across delayed context ACKs and transcript delivery", async () => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none", "hybrid_deterministic_v1");
    await h.play(); h.live.autoAcknowledge = false;
    const commandsBefore = h.live.sent.length;
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(201); await flush();
    expect(h.recording).toHaveBeenCalledOnce();
    const commands = h.live.sent.slice(commandsBefore).filter(e => e.type === "session.update" || e.type.endsWith(".append"));
    expect(commands.filter(e => e.type === "session.thinking.append").length).toBeGreaterThan(0);
    const starts = () => h.live.sent.filter(e => e.type === "session.instructions.append" && String(e.content).startsWith("Begin the approved task now."));
    expect(starts()).toHaveLength(0);
    const mediaBefore = h.twilio.sent.filter(e => e.event === "media").length;
    const acknowledge = (event: any) => h.live.receive(event.type === "session.update"
      ? { type: "session.updated", client_event_id: event.event_id, session: h.live.liveSession }
      : { type: `${event.type}ed`, client_event_id: event.event_id, start_ms: 900, end_ms: 1000 });
    await vi.advanceTimersByTimeAsync(100);
    for (const command of commands.slice(1).reverse()) acknowledge(command);
    h.live.receive({ type: "session.output_transcript.delta", delta: "MUTED DISCLOSURE", start_ms: 0, end_ms: 100 });
    const firstFrame = Buffer.alloc(800, 129).toString("base64");
    // Live may start speaking before the last context ACK. Preserve its first
    // packet even when both the ACK and the matching transcript arrive later.
    h.live.receive({ type: "session.output_audio.delta", delta: firstFrame });
    expect(h.twilio.sent.filter(e => e.event === "media").slice(mediaBefore).map(e => e.media.payload)).toEqual([firstFrame]);
    // Recording admission also keeps recipient input live and persistable.
    expect(starts()).toHaveLength(0);
    h.twilio.receive({ event: "media", media: { payload: silence } });
    h.live.receive({ type: "session.input_transcript.delta", delta: "Go ahead with the task.", start_ms: 1100, end_ms: 1200 });
    await vi.advanceTimersByTimeAsync(200);
    acknowledge(commands[0]); acknowledge(commands[0]);
    expect(starts()).toHaveLength(1);
    h.live.receive({ type: "session.output_transcript.delta", delta: "OLD TAIL", start_ms: 100, end_ms: 150 });
    // Neither the context ACK nor the start ACK may trim the same utterance.
    h.live.receive({ type: "session.instructions.appended", client_event_id: starts()[0].event_id, start_ms: 1000, end_ms: 1800 });
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    h.live.receive({ type: "session.output_transcript.delta", delta: "Wh", start_ms: 700, end_ms: 1000 });
    h.live.receive({ type: "session.output_transcript.delta", delta: "at would you like?", start_ms: 1000, end_ms: 1500 });
    expect(h.twilio.sent.filter(e => e.event === "media").slice(mediaBefore).map(e => e.media.payload)).toEqual([firstFrame, speech]);
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ suppressedPreparationAudioMs: 0 }), "Live task opening requested");
    await flush(); await flush();
    const contextDiagnostics = (await h.repository.listCallTelemetryEvents(h.brief.id)).flatMap(event =>
      event.payload.name === 'conversation.task' && event.payload.metadata.diagnostic?.kind === 'task_context'
        ? [event.payload.metadata.diagnostic] : []);
    expect(contextDiagnostics).toHaveLength(1);
    expect(contextDiagnostics[0]).toMatchObject({ commands: commands.length });
    expect(contextDiagnostics[0]!.durationMs - contextDiagnostics[0]!.firstAckMs).toBe(200);
    expect(contextDiagnostics[0]!.utf8Bytes).toBeGreaterThan(0);
    const transcript = (await h.repository.get(h.brief.id))!.transcript;
    expect(transcript.some(t => t.text === "Go ahead with the task.")).toBe(true);
    expect(transcript.filter(t => t.role === "assistant").map(t => t.text).join("")).toContain("What would you like?");
    expect(transcript.some(t => /MUTED DISCLOSURE|OLD TAIL/.test(t.text))).toBe(false);
    h.twilio.close(); h.live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12 } });
    await flush(); await flush();
    const { capture } = await h.repository.getNativeTranscriptAttemptWork(h.brief.id, h.attempt.id);
    expect(capture).toBeTruthy();
    expect(capture?.issues?.some(issue => issue.code === "consent_boundary")).toBe(false);
  });

  it.each(["rejection", "timeout", "disconnect"] as const)("does not reopen task audio after a terminal context %s", async failure => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none", "hybrid_deterministic_v1");
    await h.play(); h.live.autoAcknowledge = false;
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(201); await flush();
    const command = h.live.sent.findLast(e => e.type === "session.instructions.append");
    const before = h.twilio.sent.filter(e => e.event === "media").length;
    if (failure === "rejection") {
      h.live.receive({ type: "error", error: { code: "invalid_request_error", client_event_id: command.event_id } });
      const retry = h.live.sent.findLast(e => e.type === "session.instructions.append");
      expect(retry.event_id).not.toBe(command.event_id);
      // A stale successful ACK for the rejected command cannot release the retry.
      h.live.receive({ type: "session.instructions.appended", client_event_id: command.event_id, end_ms: 1000 });
      expect(h.live.sent.some(e => e.type === "session.instructions.append" && String(e.content).startsWith("Begin the approved task now."))).toBe(false);
      h.live.receive({ type: "error", error: { code: "invalid_request_error", client_event_id: retry.event_id } });
      await vi.advanceTimersByTimeAsync(2_001);
    } else if (failure === "timeout") await vi.advanceTimersByTimeAsync(15_001);
    else h.twilio.close();
    await flush(); await flush();
    const afterRecovery = h.twilio.sent.filter(e => e.event === "media").length;
    if (failure !== "disconnect") expect(h.requestedSpeech()).toContain("can't reliably continue");
    else expect(afterRecovery).toBe(before);
    h.live.receive({ type: "session.instructions.appended", client_event_id: command.event_id, end_ms: 1000 });
    h.live.receive({ type: "session.output_transcript.delta", delta: "UNAUTHORIZED OUTPUT", start_ms: 2000, end_ms: 2100 });
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(afterRecovery);
    expect(h.recording).toHaveBeenCalledOnce();
  });

  it.each(["rejection", "timeout"] as const)("uses bounded recovery when the separate speech instruction fails with %s", async failure => {
    const h = await harness("human", false, false, "en-GB", false, "anna", "none", "hybrid_deterministic_v1");
    await h.play(); h.live.autoAcknowledge = false;
    const before = h.live.sent.length;
    h.transcript("input", "Yes"); await vi.advanceTimersByTimeAsync(201); await flush();
    for (const command of h.live.sent.slice(before).filter(e => e.type === "session.update" || e.type.endsWith(".append"))) {
      h.live.receive(command.type === "session.update"
        ? { type: "session.updated", client_event_id: command.event_id, session: h.live.liveSession }
        : { type: `${command.type}ed`, client_event_id: command.event_id, start_ms: 900, end_ms: 1000 });
    }
    const starts = () => h.live.sent.filter(e => e.type === "session.instructions.append" && String(e.content).startsWith("Begin the approved task now."));
    expect(starts()).toHaveLength(1);
    if (failure === "rejection") {
      h.live.receive({ type: "error", error: { code: "invalid_request_error", client_event_id: starts()[0].event_id } });
      expect(starts()).toHaveLength(2);
      h.live.receive({ type: "error", error: { code: "invalid_request_error", client_event_id: starts()[1].event_id } });
      await vi.advanceTimersByTimeAsync(2_001);
    } else await vi.advanceTimersByTimeAsync(15_001);
    await flush(); await flush();
    expect(starts()).toHaveLength(failure === "rejection" ? 2 : 1);
    expect(h.requestedSpeech()).toContain("can't reliably continue");
    const media = h.twilio.sent.filter(e => e.event === "media").length;
    h.live.receive({ type: "session.instructions.appended", client_event_id: starts().at(-1)!.event_id, end_ms: 1200 });
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(media);
  });

  it("keeps protected-playback resume audio before the fresh transcript visible as incomplete capture", async () => {
    const h = await harness("human", false, true); await h.accept();
    await h.tool("request_appointment", { proposal }, "That time is available.");
    h.transcript("input", "I need the name first."); await vi.advanceTimersByTimeAsync(901);
    const before = h.twilio.sent.filter(e => e.event === "media").length;
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.twilio.sent.filter(e => e.event === "media")).toHaveLength(before);
    h.transcript("output", "A fresh task question.");
    h.live.receive({ type: "session.output_audio.delta", delta: speech });
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ unattributedAudioMs: 100 }), "Live output boundary ready");
    await vi.advanceTimersByTimeAsync(101);
    h.twilio.close(); h.live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 12 } });
    await flush(); await flush();
    expect((await h.repository.getNativeTranscriptAttemptWork(h.brief.id, h.attempt.id)).capture).toMatchObject({
      status: "incomplete", issues: expect.arrayContaining([{ code: "output_boundary" }])
    });
  });
});

describe("bounded orchestration recovery", () => {
  it.each([
    ["de-CH", "Danke, auf Wiederhören."], ["de-DE", "Danke, tschüss."],
    ["fr-CH", "Merci, au revoir."], ["it-CH", "Grazie, arrivederci."],
    ["ru-RU", "Спасибо, до свидания."], ["en-GB", "Thanks, goodbye."], ["en-US", "Thank you, bye."]
  ] as const)("preserves authorized closing for a reciprocal farewell in %s", async (locale, farewell) => {
    const h = await harness("human", false, false, locale); await h.accept();
    await h.tool("end_call", { reason: "objective_resolved" }, "The application arrived.");
    const cleared = await h.closeNaturally(false);
    h.transcript("input", farewell); await vi.advanceTimersByTimeAsync(601);
    h.twilio.receive({ event: "mark", mark: { name: cleared } }); await flush();
    expect(h.hangup).not.toHaveBeenCalled();
    const decision = await h.tool("report_task_state", { state: "keep_closing", summary: "A reciprocal farewell without a new request." });
    expect(h.result(decision)).toMatchObject({ ok: true, state: "closing_authorized" });
    await h.continueClosing(decision); await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
    expect((await h.repository.listCallTelemetryEvents(h.brief.id)).some(e =>
      e.payload.name === "conversation.hangup" && e.payload.metadata.phase === "interrupted")).toBe(false);
  });
  it("keeps one absolute closing deadline across repeated reciprocal speech", async () => {
    const h = await harness(); await h.accept();
    await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.");
    for (let i = 0; i < 3; i++) {
      h.transcript("input", "Thank you, goodbye."); await vi.advanceTimersByTimeAsync(601);
      const id = await h.tool("report_task_state", { state: "keep_closing", summary: "Reciprocal farewell." });
      await h.continueClosing(id);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(h.twilio.readyState).toBe(1);
    }
    h.transcript("input", "Goodbye."); await vi.advanceTimersByTimeAsync(15_000); await flush();
    expect(h.twilio.readyState).toBe(3);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("does not lose a tool continuation or its late error to an unrelated native response", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("report_task_state", { state: "wait_for_recipient", summary: "A necessary detail is missing." }, "Please check the date.");
    const output = h.live.sent.findLast(e => e.type === "response.item.create" && e.item.call_id === id);
    const backend = (event: object) => h.live.receive({ type: "response.event", delegation_id: "unrelated-native", event });
    backend({ type: "response.created", response: { id: "unrelated-native" } });
    backend({ type: "response.completed", response: { id: "unrelated-native", status: "completed", output: [] } });
    await flush();
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before);
    await h.continueClosing(id);
    h.live.receive({ type: "error", event_id: "late-function-error", error: {
      code: "output_interrupted", type: "server_error", client_event_id: output.event_id
    } }); await flush();
    expect(h.live.sent.filter(e => e.type === "response.item.create" && e.item.call_id === id)).toHaveLength(1);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ command: "response.item.create", disposition: "continued" }), "Live command failed");
    expect(h.twilio.readyState).toBe(1);
  });
  it('installs separate internal-adviser and recipient-facing speech instructions', async () => {
    const h = await harness();
    const instructions = h.live.sent.find(e => e.type === 'session.start').session.instructions;
    expect(instructions).toContain('Backend messages and task-state summaries are internal context, not lines to speak or paraphrase.');
    expect(instructions).toContain("Address the recipient's latest question using approved facts; if the answer is unknown, say so.");
    expect(instructions).toContain('After end_call is authorized, stay silent');
    expect(instructions).toContain('Information supplied by the user for this task is already authorized for disclosure');
    expect(instructions).toContain('using the approved call-language wording');
    expect(instructions).toContain('An explicit user instruction to withhold information');
    await h.accept();
    const backend = h.live.sent.findLast(e => e.type === 'session.update').session.delegation.responses;
    expect(backend.instructions).toContain('You advise Live internally; you do not speak to the called recipient.');
    expect(backend.instructions).not.toContain('You are speaking to the called recipient');
    expect(backend.instructions).toContain('Ordinary answers and clarifications may return concise facts without an application tool.');
    expect(backend.instructions).toContain('This summary is spoken to the called recipient');
    expect(backend.instructions).toContain('Information supplied by the user for this task is already authorized for disclosure');
    expect(backend.instructions).toContain('using the approved call-language wording');
    for (const prompt of [instructions, backend.instructions]) {
      expect(prompt).toContain("The customer's approved conditions determine whether an offer suits the customer.");
      expect(prompt).toContain('Do not ask the called recipient to decide or reconfirm whether an offer suits the absent customer.');
      expect(prompt).toContain('Ask the recipient about their own availability, required details and confirmation of the requested action.');
      expect(prompt).toContain('This does not expand authorization or replace required recipient confirmation of completion.');
    }
    expect(backend.tool_choice).toBe('auto');
  });
  it.each(['completed', 'delta', 'item'] as const)('keeps %s backend notes off application speech while allowing native replies and the closing summary', async mode => {
    const h = await harness('human', false, false, 'de-CH', false, 'anna', 'none'); await h.accept();
    h.transcript('output', 'Kann die Abklärung ohne Geburtsdatum weitergehen?');
    h.transcript('input', 'Ist das der erste Besuch?'); await vi.advanceTimersByTimeAsync(901);
    const mediaBefore = h.twilio.sent.filter(e => e.event === 'media').length;
    const speechBefore = h.speechRequests.length;
    const requestsBefore = h.live.sent.filter(e => e.type === 'response.create').length;
    const transcriptBefore = (await h.service.get(h.brief.id))!.transcript;
    // Synthetic provider output tests routing, not what a real model would choose to say.
    const note = 'Die Praxis hat noch nicht geantwortet. Warten wir ihre Rückmeldung ab.';
    const item = { type: 'message', content: [{ type: 'output_text', text: note }] };
    const id = 'internal-note';
    const backend = (event: object) => h.live.receive({ type: 'response.event', delegation_id: id, event });
    backend({ type: 'response.created', response: { id } });
    if (mode === 'delta') backend({ type: 'response.output_text.delta', delta: note });
    if (mode === 'item') backend({ type: 'response.output_item.done', item });
    backend({ type: 'response.completed', response: { id, status: 'completed', output: mode === 'completed' ? [item] : [] } });
    await flush(); await vi.advanceTimersByTimeAsync(6_001);
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(mediaBefore);
    expect(h.speechRequests).toHaveLength(speechBefore);
    expect((await h.service.get(h.brief.id))!.transcript).toEqual(transcriptBefore);
    expect(h.live.sent.some(e => e.type === 'session.commentary.append')).toBe(false);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(requestsBefore);
    h.transcript('output', 'Das ist mir nicht bekannt.');
    h.live.receive({ type: 'session.output_audio.delta', delta: speech }); await flush();
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(mediaBefore + 1);
    expect(h.twilio.sent.findLast(e => e.event === 'media').media.payload).toBe(speech);
    expect(h.speechRequests).toHaveLength(speechBefore);
    expect(h.hangup).not.toHaveBeenCalled();
    const resultSummary = 'Der erste Besuch konnte nicht geklärt werden.';
    const closing = await h.tool('end_call', { reason: 'cannot_proceed', resultSummary }, 'Ohne diese Angabe geht es leider nicht.');
    expect(h.result(closing).ok).toBe(true);
    expect(h.speechRequests.at(-1)?.input).toContain(resultSummary);
    expect(h.speechRequests.some(request => request.input.includes(note))).toBe(false);
    await h.closeNaturally(); expect(h.hangup).toHaveBeenCalledOnce();
    expect(h.unexpectedFetch).not.toHaveBeenCalled();
  });
  it('accepts factual backend answers without forcing a task-state tool', async () => {
    const h = await harness(); await h.accept();
    h.transcript('input', 'The application arrived.'); await vi.advanceTimersByTimeAsync(601);
    const before = h.live.sent.filter(e => e.type === 'response.create').length;
    const id = 'facts';
    h.live.receive({ type: 'response.event', delegation_id: id, event: { type: 'response.created', response: { id } } });
    h.live.receive({ type: 'response.event', delegation_id: id, event: { type: 'response.completed', response: {
      id, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The application was received. Continue to the next approved question.' }] }] } } });
    await flush(); await vi.advanceTimersByTimeAsync(6_001);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before);
    expect(h.hangup).not.toHaveBeenCalled(); expect(h.twilio.readyState).toBe(1);
  });
  it("makes a waiting deadline actionable even when the assistant keeps producing filler", async () => {
    const h = await harness(); await h.accept();
    const id = await h.tool("report_task_state", { state: "wait_for_recipient", summary: "Waiting for the required answer." }, "I need to check.");
    await h.continueClosing(id);
    const before = h.live.sent.filter(e => e.type === "response.create").length;
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      h.transcript("output", "Take your time."); h.live.receive({ type: "session.output_audio.delta", delta: speech });
    }
    await vi.advanceTimersByTimeAsync(5_100);
    expect(h.live.sent.filter(e => e.type === "response.create")).toHaveLength(before + 1);
    const message = h.live.sent.findLast(e => e.type === "response.item.create" && e.item.type === "message");
    expect(JSON.parse(message.item.content[0].text).applicationConversationState.waitingExpired).toBe(true);
    const terminal = await h.tool("end_call", { reason: "cannot_proceed" });
    expect(h.result(terminal).ok).toBe(true); await h.closeNaturally(); expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("settles an abandoned closing response in the ledger without failing the resumed task", async () => {
    const h = await harness(); await h.accept();
    const completed = vi.spyOn(h.service, "completeProviderOperation");
    const id = await h.tool("end_call", { reason: "objective_resolved" }, "It arrived.", false);
    h.live.receive({ type: "response.event", delegation_id: id, event: { type: "response.created", response: { id: "abandoned-closing" } } });
    h.transcript("input", "Wait, I have a correction."); await vi.advanceTimersByTimeAsync(601);
    const resumed = await h.tool("report_task_state", { state: "resume_conversation", summary: "The answer requires a correction." });
    await h.continueClosing(resumed); await vi.advanceTimersByTimeAsync(30_001); await flush();
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ providerResponseId: "abandoned-closing", errorCode: "LIVE_BACKEND_TIMEOUT" }));
    expect(h.twilio.readyState).toBe(1); expect(h.hangup).not.toHaveBeenCalled();
  });
  it("does not accept model-written appointment commitments and preserves authority", async () => {
    const h = await harness("human", false, true); await h.accept();
    const id = await h.tool("request_appointment", { proposal, content: "I also accept any fees." }, "That date is available.");
    expect(h.result(id).reason).toBe("invalid_arguments");
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions).toEqual([]);
    const invalid = await h.tool("request_appointment", { proposal: { ...proposal, requiresPaymentOrNewTerms: true } });
    expect(h.result(invalid).ok).toBe(false);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions).toEqual([]);
  });
  it("bounds the appointment reply wait and keeps a delivered request unconfirmed", async () => {
    const h = await harness("human", false, true); await h.accept();
    const id = await h.tool("request_appointment", { proposal }, "That date is available."); await h.play();
    await vi.advanceTimersByTimeAsync(45_001); await flush();
    expect(h.result(id)).toMatchObject({ ok: false, reason: "recipient_reply_timeout", state: "delivered", recipientReply: null });
    const ending = await h.tool("end_call", { reason: "objective_resolved" });
    expect(h.result(ending).reason).toBe("appointment_confirmation_required");
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe("delivered");
  });
  it("uses required for a fresh consent check and auto for its result continuation", async () => {
    const h = await harness(); await h.play(); h.transcript("input", "Yes.");
    await vi.advanceTimersByTimeAsync(901);
    const fresh = h.live.sent.findLastIndex(e => e.type === "response.create");
    expect(h.live.sent.slice(0, fresh).findLast(e => e.type === "session.update").session.delegation.responses.tool_choice).toBe("required");
    await h.tool("report_consent", { decision: "unclear" });
    const continuation = h.live.sent.findLastIndex(e => e.type === "response.create");
    expect(h.live.sent.slice(0, continuation).findLast(e => e.type === "session.update").session.delegation.responses.tool_choice).toBe("auto");
  });
});
describe('v4 regressions from the nine private incident diagnostics', () => {
  it('keeps the physical backend lease across recipient revisions', async () => {
    const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none'); await h.accept();
    h.live.receive({ type: 'response.event', delegation_id: 'old-physical', event: { type: 'response.created', response: { id: 'old-physical-response' } } });
    const before = h.live.sent.filter(e => e.type === 'response.create').length;
    h.transcript('input', 'Here is another detail.'); await vi.advanceTimersByTimeAsync(7_001);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before);
    h.live.receive({ type: 'response.event', delegation_id: 'old-physical', event: { type: 'response.completed', response: {
      id: 'old-physical-response', status: 'completed', output: [] } } });
    await flush(); await vi.advanceTimersByTimeAsync(1);
    expect(h.live.sent.filter(e => e.type === 'response.create')).toHaveLength(before + 1);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it('drops cancelled native tails after a cleared mark until a fresh output boundary', async () => {
    const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
    const id = await h.tool('request_appointment', { proposal }, 'That time is available.');
    const mark = await h.play(false), oldStart = h.live.timelineMs;
    h.transcript('input', 'I need the full name first.'); await vi.advanceTimersByTimeAsync(901);
    expect(h.result(id)).toMatchObject({ ok: false, state: 'uncertain' });
    h.twilio.receive({ event: 'mark', mark: { name: mark } }); await flush();
    const before = h.twilio.sent.filter(e => e.event === 'media').length;
    h.live.receive({ type: 'session.output_transcript.delta', delta: 'OLD CANCELLED TAIL', start_ms: oldStart, end_ms: oldStart + 10 });
    h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(before);
    h.transcript('output', 'The full approved name is Nina Keller.');
    h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(before + 1);
    expect((await h.repository.get(h.brief.id))!.transcript.some(t => t.text === 'OLD CANCELLED TAIL')).toBe(false);
  });
  it('uses status-only after reported booking even when the original TTS never released', async () => {
    const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
    let finishRender!: (response: Response) => void;
    h.speechFetch.mockImplementationOnce(async () => new Promise<Response>(resolve => { finishRender = resolve; }));
    const old = await h.tool('request_appointment', { proposal }, 'That time is available.');
    h.transcript('input', 'It is already booked for that exact date and time.'); await vi.advanceTimersByTimeAsync(901);
    expect(h.result(old).ok).toBe(false);
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].delivery?.status).toBe('not_sent');
    await h.tool('request_appointment', { proposal, intent: 'status_check' });
    expect(h.requestedSpeech()).toContain('Do not create another booking');
    finishRender(new Response(Buffer.alloc(4_800))); await flush(); await flush();
    const actions = (await h.repository.exportCallTextData(h.brief.id)).voiceActions!;
    expect(actions).toHaveLength(1); expect(actions[0].delivery).toMatchObject({ kind: 'status_check', attempt: 2 });
    expect(h.live.sent.some(e => e.type === 'session.instructions.append' && String(e.content).includes('<speech>'))).toBe(false);
  });
  it('closes an uncertain appointment on an authorized recipient ending after real farewell playback', async () => {
    const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
    await h.tool('request_appointment', { proposal }, 'That time is available.');
    h.transcript('input', 'It is already booked, goodbye.'); await vi.advanceTimersByTimeAsync(901);
    const resolved = await h.tool('end_call', { reason: 'objective_resolved', resultSummary: 'Recipient reported a booking.' });
    expect(h.result(resolved).reason).toBe('appointment_confirmation_required');
    h.transcript('output', 'Goodbye.'); h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    await vi.advanceTimersByTimeAsync(1_001); expect(h.hangup).not.toHaveBeenCalled();
    const ending = await h.tool('end_call', { reason: 'recipient_requested_end', resultSummary: 'Recipient ended; exact booking remains unconfirmed.' });
    expect(h.result(ending).ok).toBe(true); await h.closeNaturally();
    expect(h.hangup).toHaveBeenCalledOnce();
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].state).toBe('uncertain');
  });
  it.each(['speech_impairment', 'language_barrier'] as const)('accepts immediate task speech after inline %s without an opening stall', async reason => {
    const h = await harness('human', false, false, 'ru-RU', false, 'anna', reason); await h.accept();
    h.twilio.receive({ event: 'media', media: { payload: speech } });
    h.transcript('input', 'Да, давайте сразу обсудим запись.');
    for (let quiet = 0; quiet < 30; quiet++) h.twilio.receive({ event: 'media', media: { payload: silence } });
    await vi.advanceTimersByTimeAsync(1_701); await flush();
    expect(h.twilio.readyState).toBe(1); expect(h.speechRequests).toHaveLength(1);
    expect((await h.repository.get(h.brief.id))!.transcript.some(t => t.text === 'Да, давайте сразу обсудим запись.')).toBe(true);
  });
  it.each(['none', 'speech_impairment', 'language_barrier'] as const)('rejects delayed pre-recording speech with %s during conversation and final drain', async reason => {
    const h = await harness('human', false, false, 'en-GB', false, 'anna', reason); await h.accept();
    h.live.receive({ type: 'session.input_transcript.delta', delta: 'PRIVATE_PRECONSENT', start_ms: 0, end_ms: 50 });
    h.twilio.close();
    h.live.receive({ type: 'session.input_transcript.delta', delta: 'PRIVATE_PRECONSENT_DRAIN', start_ms: 0, end_ms: 50 });
    await flush(); await flush();
    expect((await h.repository.get(h.brief.id))!.transcript.some(t => t.text.includes('PRIVATE_PRECONSENT'))).toBe(false);
  });
});
describe('v4 protected output and recording admission failures', () => {
  it('starts with status-only when the recipient already reports an appointment before any request', async () => {
    const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
    await h.tool('request_appointment', { proposal, intent: 'status_check' }, 'I already booked that exact appointment.');
    expect(h.requestedSpeech()).toContain('Is it already booked?');
    expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions![0].delivery).toMatchObject({ kind: 'status_check', attempt: 1 });
  });
  it('retains the output fence across a rejected append and its acknowledged retry', async () => {
    const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
    h.live.autoAcknowledge = false;
    await h.tool('request_appointment', { proposal }, 'That time is available.');
    h.transcript('input', 'I need the name first.'); await vi.advanceTimersByTimeAsync(901);
    const fence = h.live.sent.findLast(e => e.type === 'session.thinking.append' && String(e.content).includes('applicationPlaybackOutcome'));
    expect(fence).toBeTruthy();
    const before = h.twilio.sent.filter(e => e.event === 'media').length;
    h.live.receive({ type: 'error', error: { code: 'invalid_request_error', client_event_id: fence.event_id } });
    const retry = h.live.sent.findLast(e => e.type === 'session.thinking.append' && String(e.content).includes('applicationPlaybackOutcome'));
    expect(retry.event_id).not.toBe(fence.event_id);
    h.transcript('output', 'This is still before the acknowledged boundary.'); h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(before);
    h.live.receive({ type: 'session.thinking.appended', client_event_id: retry.event_id, start_ms: 20_000, end_ms: 20_500 });
    h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(before);
    h.live.receive({ type: 'session.output_transcript.delta', delta: 'The approved full name is Nina Keller.', start_ms: 20_600, end_ms: 20_800 });
    h.live.receive({ type: 'session.output_audio.delta', delta: speech });
    expect(h.twilio.sent.filter(e => e.event === 'media')).toHaveLength(before + 1);
  });
  it.each([undefined, 'invalid-date', '1970-01-01T00:00:00.000Z'])('keeps task admission closed without a valid recording boundary: %s', async startedAt => {
    const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none');
    h.recording.mockImplementation(async () => ({ ...(await h.service.get(h.brief.id))!, recording: { startedAt } }) as any);
    await h.accept();
    expect(h.live.sent.some(e => e.type === 'session.update' && e.session.delegation.responses.tools.some((t: any) => t.name === 'end_call'))).toBe(false);
    h.live.receive({ type: 'session.input_transcript.delta', delta: 'PRIVATE_INVALID_BOUNDARY', start_ms: 0, end_ms: 50 });
    await flush(); expect((await h.service.get(h.brief.id))!.transcript.some(t => t.text === 'PRIVATE_INVALID_BOUNDARY')).toBe(false);
  });
});


// Regression coverage promoted from the October 1 incident audit (synthetic data).
it('ordinary native address acknowledgment cannot complete the authorized final audio', async () => {
  const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none'); await h.accept();
  const id = await h.tool('end_call', {reason:'cannot_proceed',resultSummary:'The appointment could not be confirmed.'}, 'The address is Example Street.', false);
  expect(h.result(id).ok).toBe(true);
  h.transcript('output','Understood, Example Street.');
  h.live.receive({type:'session.output_audio.delta',delta:speech});
  await h.continueClosing(id);
  await vi.advanceTimersByTimeAsync(1001); await flush();
  const mark = h.twilio.sent.filter(e=>e.event==='mark').at(-1)?.mark.name;
  expect(mark).toMatch(/^live-application-/);
  expect(h.hangup).not.toHaveBeenCalled();
  expect(h.speechRequests.at(-1)?.input).toBe('The appointment could not be confirmed. Thank you. Goodbye.');
  h.twilio.receive({event:'mark',mark:{name:mark}}); await flush();
  expect(h.hangup).toHaveBeenCalledOnce();
  expect(h.speechRequests).toHaveLength(2);
});
it('rejects unsupported cannot_proceed without task evidence', async () => {
  const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
  const id = await h.tool('end_call',{reason:'cannot_proceed',resultSummary:'The appointment is confirmed and payment was completed.'}, undefined, false);
  expect(h.result(id)).toMatchObject({ok:false,reason:'recipient_evidence_required'});
  expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions ?? []).toHaveLength(0);
});
it('rejected appointment keeps native commitment output closed until clarification', async () => {
  const h = await harness('human', false, true, 'en-GB', false, 'anna', 'none'); await h.accept();
  const id=await h.tool('request_appointment',{proposal:{...proposal,detailsConfirmed:false}},'Saturday is possible.');
  expect(h.result(id)).toMatchObject({ok:false,reason:'unconfirmed_details'});
  const before=h.twilio.sent.filter(e=>e.event==='media').length;
  h.transcript('output','Good, I am booking that appointment.');
  h.live.receive({type:'session.output_audio.delta',delta:speech});
  expect(h.twilio.sent.filter(e=>e.event==='media')).toHaveLength(before);
  expect((await h.repository.exportCallTextData(h.brief.id)).voiceActions ?? []).toHaveLength(0);
});
it('collects streamed backend messages when response.completed output is empty', async () => {
  const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none'); await h.accept();
  h.transcript('input','I need one clarification.'); await vi.advanceTimersByTimeAsync(901);
  for(let i=0;i<2;i++) {
    const id='tool-free-'+i;
    const backend=(event:object)=>h.live.receive({type:'response.event',delegation_id:id,event});
    backend({type:'response.created',response:{id}});
    backend({type:'response.output_text.delta',response_id:id,delta:'Ask which department is responsible.'});
    backend({type:'response.output_item.done',response_id:id,item:{type:'message',role:'assistant',content:[{type:'output_text',text:'Ask which department is responsible.'}]}});
    backend({type:'response.completed',response:{id,status:'completed',output:[]}});
    await flush(); await flush();
  }
  expect(h.logger.warn).not.toHaveBeenCalledWith(expect.objectContaining({code:'LIVE_TASK_PROGRESS_MISSING'}),'Live owned backend failure pending');
});
it('a fresh recipient answer resets the previous turn waiting deadline', async () => {
  const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none'); await h.accept();
  const old=await h.tool('report_task_state',{state:'wait_for_recipient',summary:'Wait for the requested information.'},'Please hold while I check.');
  await h.continueClosing(old);
  await vi.advanceTimersByTimeAsync(45001); await flush();
  const fresh=await h.tool('report_task_state',{state:'continue',summary:'The new answer allows the next question.'},'I found the answer, please continue.');
  expect(h.result(fresh)).toMatchObject({ok:true,state:'continue'});
});
it('control: task silence before the first recipient answer requests bounded recovery', async () => {
  const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none'); await h.accept();
  h.transcript('output','May I ask about your opening hours?');
  h.live.receive({type:'session.output_audio.delta',delta:speech});
  await vi.advanceTimersByTimeAsync(60001); await flush();
  expect(h.hangup).not.toHaveBeenCalled();
  expect(h.twilio.readyState).toBe(1);
  expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({waitingExpired:true}),'Live task decision requested');
});
it('silent native packets do not postpone missing-delegation recovery', async () => {
  const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none'); await h.accept();
  h.transcript('input','The requested information is ready.'); await vi.advanceTimersByTimeAsync(901);
  for(let i=0;i<400;i++) {
    h.live.receive({type:'session.output_audio.delta',delta:silence});
    await vi.advanceTimersByTimeAsync(20);
  }
  expect(h.logger.info).toHaveBeenCalledWith(expect.anything(),'Live task decision requested');
  expect(h.hangup).not.toHaveBeenCalled();
});
it('local timeout retains backend occupancy until a provider terminal event', async () => {
  const h = await harness('human', false, false, 'en-GB', false, 'anna', 'none'); await h.accept();
  h.live.receive({type:'response.event',delegation_id:'still-physical',event:{type:'response.created',response:{id:'still-physical-response'}}});
  h.transcript('input','Here is the updated information.'); await vi.advanceTimersByTimeAsync(901);
  const before=h.live.sent.filter(e=>e.type==='response.create').length;
  await vi.advanceTimersByTimeAsync(35001); await flush();
  expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({responseId:'still-physical-response'}),'Live backend timeout retains physical occupancy');
  expect(h.live.sent.filter(e=>e.type==='response.create').length).toBe(before);
  expect(h.live.sent.some(e=>e.type==='response.cancel')).toBe(false);
  expect(h.hangup).not.toHaveBeenCalled();
});
