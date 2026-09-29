/** Real Live audio + Responses through the production bridge; synthetic recipient and simulated Twilio playback. */
import "../src/config/load-env.ts";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { InMemoryCallRepository } from "../src/storage/in-memory-call-repository.ts";
import { CallService } from "../src/call-service.ts";
import { DeterministicBriefCompiler, evaluateCompiledBrief } from "../src/brief-compiler/brief-compiler.ts";
import { originalPlanReview } from "../src/test-helpers/original-plan-review.ts";
import { OpenAILiveBridge } from "../src/voice/openai-live-bridge.ts";
import { createCompilationSnapshotHash } from "../src/brief-compiler/compilation-integrity.ts";
import { pcmuHasSpeech } from "../src/voice/pcmu-activity.ts";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");
const probeStartedAt = Date.now();
const appointment = process.argv.includes("--appointment");
const clips = await Promise.all((appointment ? [0, 1, 3, 4, 5] : [0, 1, 2]).map(i => readFile(`.tools/synthetic-live-client/answer-${i}.ulaw`)));
const repository = new InMemoryCallRepository();
const compiler = new DeterministicBriefCompiler();
if (appointment) {
  const compile = compiler.compile.bind(compiler);
  compiler.compile = async (input, revision) => {
    const result = await compile(input, revision);
    if (!result.compiledBrief) throw new Error("FIXTURE_PLAN_MISSING");
    result.compiledBrief = { ...result.compiledBrief, schemaVersion: "4", taskType: "appointment_coordination", blockingIssues: [],
      appointmentAuthorization: { operation: "book", serviceDescription: "Routine appointment", providerScope: "called_recipient",
        timeZone: "Europe/Zurich", windows: [{ date: "2099-09-16", startTime: "14:00", endTime: "17:00" }],
        selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms" } };
    result.policyDecision = evaluateCompiledBrief(result.rawBrief, result.compiledBrief, {
      intent: "book", calendarDates: ["2099-09-16"], missingSchedulingConstraints: false, authorizationMismatch: false
    });
    result.snapshotHash = createCompilationSnapshotHash(result); return result;
  };
}
const service = new CallService(repository, undefined, undefined, undefined, compiler);
const brief = await service.create({ recipientName: "Example AG", phoneNumber: "+41710000001", objective: appointment
  ? "Arrange one routine appointment on 16 September 2099 between 14:00 and 17:00, without payment or new financial conditions."
  : "Ask whether the application sent on 12 July was received",
  assistantProfileId: "anna", representedPersonFirstName: "Nina", representedPersonLastName: "Keller", assistanceReason: "speech_impairment",
  locale: "en-GB", audioRetentionDays: 0, allowLanguageSwitch: false, allowedFacts: ["Application sent: 12 July"] });
await service.approveCompilation(brief.id, await originalPlanReview(service, brief.id));
const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
await repository.attachProviderCall(attempt.id, "CA-SYNTHETIC", "in-progress");
await repository.transitionAnswering(brief.id, { attemptId: attempt.id, providerCallId: "CA-SYNTHETIC", snapshotHash: attempt.compilationSnapshotHash!, kind: "resolve", answeredBy: "human", now: new Date().toISOString() });
// Only telephony recording/hangup are simulated. Voice, transcripts and delegation and tools are real.
service.startRecordingAfterConsent = async () => (await service.get(brief.id))!;
let hungUp = false, backendRequests = 0, marks = 0, queueEnd = 0, nextClip = -1, offset = 0;
let generatedSpeech = "";
let spoken = "";
let lastVoicedPlaybackEnd = 0, pendingAnswer: number | null = null;
service.prepareAgentHangup = async () => { hungUp = true; return true; };
class Telephone extends EventEmitter {
  readyState = WebSocket.OPEN;
  send(raw: string) {
    const event = JSON.parse(raw);
    if (event.event === "media") {
      const bytes = Buffer.from(event.media.payload, "base64");
      queueEnd = Math.max(Date.now(), queueEnd) + bytes.length / 8;
      if (pcmuHasSpeech(bytes)) lastVoicedPlaybackEnd = queueEnd;
    }
    if (event.event === "clear") queueEnd = Date.now();
    if (event.event === "mark") setTimeout(() => {
      this.emit("message", Buffer.from(JSON.stringify({ event: "mark", mark: event.mark })));
      if (++marks <= 2) setTimeout(() => { nextClip = marks - 1; offset = 0; }, 400);
      else if (appointment && marks === 3) { pendingAnswer = null; setTimeout(() => { nextClip = 3; offset = 0; }, 800); }
    }, Math.max(0, queueEnd - Date.now()));
  }
  close() { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSED; this.emit("close"); }
}
const phone = new Telephone();
const bridge = new OpenAILiveBridge({ apiKey: process.env.OPENAI_API_KEY, service, agentHangupEnabled: true,
  validateStreamToken: () => true,
  semanticFetch: async (url, init) => {
    const input = JSON.parse(String(init?.body)).input;
    const started = Date.now();
    const response = await fetch(url, init);
    const body = await response.clone().json();
    // This probe uses synthetic fixtures only. Never enable raw diagnostics for customer calls.
    console.log(JSON.stringify({ semanticMs: Date.now() - started, input, status: body.status,
      output: body.output?.filter((item: any) => item.type === "message").flatMap((item: any) => item.content ?? [])
        .filter((item: any) => item.type === "output_text").map((item: any) => item.text), incomplete: body.incomplete_details }));
    return response;
  },
  createLiveSocket: (url, key) => {
    const socket = new WebSocket(url, { headers: { Authorization: 'Bearer ' + key } });
    const send = socket.send.bind(socket);
    socket.send = ((raw: string) => {
      const event = JSON.parse(raw);
      if (event.type === 'response.item.create' && event.item?.type === 'function_call_output') console.log(JSON.stringify({ toolResult: event.item }));
      return send(raw);
    }) as typeof socket.send;
    let scheduled = false, confirmedDetails = false, observedMarks = 0;
    socket.on('message', raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === 'session.updated' || e.type === 'session.started') console.log(JSON.stringify({ event: e.type,
        delegation: e.session?.delegation?.type, tools: e.session?.delegation?.responses?.tools?.map((t: any) => t.name) }));
      if (e.type === 'session.delegation.created') console.log(JSON.stringify({ event: e.type }));
      if (e.type === 'response.event' && e.event.type === 'response.created') {
        backendRequests++;
        console.log(JSON.stringify({ backendStartedMs: Date.now() - probeStartedAt, marks }));
      }
      if (e.type === 'response.event' && e.event.type === 'response.output_item.done' && e.event.item?.type === 'function_call') console.log(JSON.stringify({ toolCall: e.event.item }));
      if (e.type === 'response.event' && e.event.type === 'response.output_item.done' && e.event.item?.type === 'message') console.log(JSON.stringify({ backendText: e.event.item.content?.filter((c: any) => c.type === 'output_text').map((c: any) => c.text) }));
      if (e.type === 'error') console.error(JSON.stringify({ providerError: e.error?.code, message: e.error?.message }));
      if (e.type === 'session.output_transcript.delta') {
        generatedSpeech += e.delta;
        if (observedMarks !== marks) { spoken = ''; observedMarks = marks; }
        spoken += e.delta;
        if (!scheduled && marks >= 2 && (appointment ? /\?|arrange|availability|available/i.test(spoken) : /application[\s\S]{0,120}\?/i.test(spoken))) {
          // A spoken request need not have a question mark. This synthetic recipient
          // answers after playback, rather than interrupting a partially generated question.
          scheduled = true; spoken = ''; pendingAnswer = 2;
        } else if (appointment && marks === 2 && !confirmedDetails && nextClip === 2 && offset >= clips[2].length && /\?/.test(spoken)) {
          confirmedDetails = true; spoken = ''; pendingAnswer = 4;
        }
      }
    });
    return socket;
  }, logger: { info: console.log, warn: console.warn, error: console.error }
});
bridge.handleTwilioSocket(phone as unknown as WebSocket);
phone.emit("message", Buffer.from(JSON.stringify({ event: "start", start: { callSid: "CA-SYNTHETIC", streamSid: "MZ-SYNTHETIC",
  customParameters: { callBriefId: brief.id, callAttemptId: attempt.id, compilationSnapshotHash: attempt.compilationSnapshotHash, streamToken: "synthetic" } } })));
const feed = setInterval(() => {
  if (pendingAnswer !== null && nextClip >= 1 && offset >= clips[nextClip].length && Date.now() >= lastVoicedPlaybackEnd + 800) {
    nextClip = pendingAnswer; pendingAnswer = null; offset = 0; spoken = '';
  }
  const clip = nextClip >= 0 ? clips[nextClip] : null;
  let packet = Buffer.alloc(160, 255);
  if (clip && offset < clip.length) { packet = clip.subarray(offset, offset + 160); offset += 160; }
  phone.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: packet.toString("base64") } })));
}, 20);
await new Promise<void>(resolve => {
  const deadline = setTimeout(() => { console.error("PROBE_TIMEOUT"); phone.close(); }, appointment ? 240_000 : 100_000);
  phone.on("close", () => { clearTimeout(deadline); resolve(); });
});
clearInterval(feed); bridge.close();
// Provider final usage may arrive after the simulated telephone closes.
await new Promise(resolve => setTimeout(resolve, 2_000));
const transcript = (await service.get(brief.id))!.transcript.map(t => ({ role: t.role, text: t.text }));
const spokenTranscript = transcript.filter(t => t.role === "assistant").map(t => t.text).join("");
const askedQuestion = /(?:whether|did you)[\s\S]{0,120}application[\s\S]{0,120}\?/i.test(spokenTranscript);
const internalNarration = /application will now|backend|as directed|delegat/i.test(spokenTranscript);
const actions = (await repository.exportCallTextData(brief.id)).voiceActions ?? [];
const confirmedExpectedSlot = actions.length === 1 && actions[0].state === "confirmed" &&
  actions[0].proposal.date === "2099-09-16" && actions[0].proposal.startTime === "15:00";
console.log(JSON.stringify({ appointment, hungUp, backendRequests, marks, askedQuestion, internalNarration, confirmedExpectedSlot, actions, transcript, generatedSpeech }));
await service.close();
if (!hungUp || backendRequests < 1 || (!appointment && !askedQuestion) ||
  (appointment && !confirmedExpectedSlot) || internalNarration) process.exitCode = 1;
