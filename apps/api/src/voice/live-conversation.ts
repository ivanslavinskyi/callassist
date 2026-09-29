import WebSocket, { type RawData } from "ws";
import { createHash, randomUUID } from "node:crypto";
import { getAppointmentAuthorization, LIVE_VOICES } from "@callassist/contracts";
import type { VoiceConversation, VoiceConversationContext } from "./voice-runtime";
import type { LiveLifecycle, OpenAILiveBridgeOptions } from "./openai-live-bridge";
import { liveManagedTools, managedBackendInstructions, liveExecutionContext, liveConsentTools, consentBackendInstructions } from "./live-managed-tools";
import { createProviderEventOperationId } from "../realtime/openai-realtime-usage";

import { decodePcmu, PcmuActivity } from "./pcmu-activity";
import { liveDurationUsage, liveResponsesUsage, object } from "./live-usage";

type FunctionCall = { call_id: string; name: string; arguments: string };
type BackendRun = { closingEpoch?: number; settled?: boolean; rejected?: boolean; id: string; operationId: string; epoch: number; answerRevision: number; backendRevision: number; consent: boolean; startedAt: number; calls: FunctionCall[]; completed: boolean; timer: ReturnType<typeof setTimeout> };

/** Native Live transport with bounded recovery for an unprocessed recipient answer. */
export class OpenAILiveConversation implements VoiceConversation {
  readonly operationId = randomUUID();
  readonly #startedAt = Date.now();
  readonly #model: string;
  readonly #voice: "cedar" | "marin";
  #voiceChecks = 0;
  readonly #activity = new PcmuActivity();
  readonly #seen = new Set<string>();
  readonly #commands = new Map<string, { type: string; timer: ReturnType<typeof setTimeout> }>();
  readonly #runs = new Map<string, BackendRun>();
  readonly #delegations = new Map<string, string>();
  readonly #toolResults = new Map<string, { signature: string; result: Promise<Record<string, unknown>> }>();
  #epoch = 0;
  #answerRevision = 0;
  #toolBusy = false;
  #backendEnabled = false;
  #consentBackend = false;
  #backendRevision = 0;
  #requestedDecision = "";
  #coveredDecision = "";
  #socket: WebSocket | null = null;
  #ready = false;
  #closing = false;
  #finalized = false;
  #reserved = false;
  #sessionId: string | null = null;
  #sessionStartedAt = new Date().toISOString();
  #seconds: number | null = null;
  #queue: string[] = [];
  #queuedBytes = 0;
  #writes = Promise.resolve();
  #persistenceFailed = false;
  #transcriptBoundaryMs = Number.POSITIVE_INFINITY;
  #startTimer: ReturnType<typeof setTimeout> | null = null;
  #closeTimer: ReturnType<typeof setTimeout> | null = null;
  #resolveStart: (() => void) | null = null;
  #rejectStart: ((error: Error) => void) | null = null;
  #failureCode: string | null = null;

  constructor(private readonly options: OpenAILiveBridgeOptions, private readonly context: VoiceConversationContext,
    private readonly lifecycle?: LiveLifecycle) {
    this.#model = options.liveModel ?? "gpt-live-1";
    this.#voice = context.snapshot.runtime.liveVoice ?? LIVE_VOICES[context.snapshot.runtime.voiceGender];
  }
  async start() {
    // The opt-in legacy hybrid adapter has no buffered action playback gate.
    // Leave such calls with its already prepared Realtime runtime, before Live starts.
    if (!this.lifecycle && getAppointmentAuthorization(this.context.snapshot.plan)) throw new Error("LIVE_ACTION_PLAYBACK_GATE_REQUIRED");
    await this.options.service.startRealtimeProviderSessions([{ id: this.operationId, callBriefId: this.context.brief.id,
      callAttemptId: this.context.attemptId, provider: "openai", operationType: "realtime_session", stage: "live_conversation",
      requestedModel: this.#model, clientRequestId: this.operationId, startedAt: new Date(this.#startedAt).toISOString() }]);
    this.#reserved = true;
    if (this.#closing) { this.#finalize(false); throw new Error("LIVE_START_CANCELLED"); }
    return new Promise<void>((resolve, reject) => {
      this.#resolveStart = resolve; this.#rejectStart = reject;
      this.#startTimer = setTimeout(() => this.#fail("LIVE_STARTUP_TIMEOUT"), this.options.liveStartupTimeoutMs ?? 8_000);
      this.#startTimer.unref?.();
      try {
        this.#socket = (this.options.createLiveSocket ?? ((url, key) => new WebSocket(url, {
          headers: { Authorization: `Bearer ${key}` }, maxPayload: 1_048_576
        })))("wss://api.openai.com/v1/live/sessions", this.options.apiKey);
      } catch { this.#fail(); return; }
      this.#socket.on("open", () => {
        if (this.#closing) return;
        const startup = this.lifecycle?.startup();
        this.#voiceTelemetry(null, null, "requested");
        this.#send({ type: "session.start", session: { model: this.#model, store: false,
          instructions: startup?.instructions ?? buildLiveInstructions(this.context), input: startup?.input ?? [],
          audio: { format: { type: "audio/pcmu", rate: 8000 }, output: {
            voice: this.#voice
          } }, delegation: { type: "responses", responses: this.#backendConfiguration(!this.lifecycle) } } });
      });
      this.#socket.on("message", data => this.#message(data));
      this.#socket.on("error", () => this.#fail("LIVE_SOCKET_ERROR"));
      this.#socket.on("close", () => { if (!this.#finalized) this.#fail("LIVE_SOCKET_CLOSED"); });
    });
  }
  inputAudio(payload: string) {
    if (this.#closing) return;
    const bytes = decodePcmu(payload);
    if (!bytes) { this.#fail("LIVE_INVALID_INPUT_AUDIO"); return; }
    const activity = this.#activity.push(bytes);
    if (activity === "started") this.#epoch++;
    this.lifecycle?.activity(activity);
    if (activity === "started") {
      if (!this.lifecycle) this.context.clearPlayback();
      if (this.context.interruptFarewell()) this.instruct("Closing authorization cancelled. Interpret the latest recipient input in context, respond if useful, and request a fresh end_call when ready. Do not restart completed work.");
    }
    if (!this.#ready) {
      this.#queuedBytes += bytes.length;
      if (this.#queuedBytes > 128_000) { this.#fail("LIVE_INPUT_QUEUE_LIMIT"); return; }
      this.#queue.push(payload);
    } else this.#send({ type: "session.input_audio.append", audio: payload });
  }
  keypad(digit: string) {
    if (!this.#ready || this.#closing || !["1", "2"].includes(digit)) return;
    const text = `[Key ${digit}: ${digit === "1" ? "Yes" : "No"} to the preceding yes/no question only]`;
    const id = `key-${randomUUID()}`;
    this.#epoch++;
    this.#answerRevision++;
    this.#send({ type: "response.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.#append("session.thinking.append", text);
    this.#write(() => this.options.service.addRealtimeTranscript(this.context.brief.id, "recipient", text, id));
  }
  #backendConfiguration(enabled: boolean) {
    return { model: this.options.delegationModel ?? "gpt-6-luna", parallel_tool_calls: false,
      tool_choice: enabled ? "auto" : "none", tools: enabled ? liveManagedTools(this.context.snapshot, !!this.options.agentHangupEnabled) : [],
      max_output_tokens: 2048, instructions: enabled ? managedBackendInstructions(this.context.snapshot) :
        "Consent has not been granted. No task is authorized. Do not perform work, ask task questions, infer consent or use tools." };
  }
  configureBackend(recordingStartedAt?: string) {
    this.#transcriptBoundaryMs = recordingStartedAt ? Math.max(0, Date.parse(recordingStartedAt) - Date.parse(this.#sessionStartedAt)) : 0;
    if (this.#backendEnabled) return;
    this.#backendEnabled = true;
    this.#consentBackend = false;
    this.#backendRevision++;
    this.#send({ type: "session.update", session: { delegation: { type: "responses", responses: this.#backendConfiguration(true) } } });
    for (const data of liveExecutionContext(this.context.snapshot)) this.#append("session.thinking.append", data);
    this.instruct("Task stage enabled. Recording has started after consent; consent-only silence and delegation restrictions have ended. Use the approved task fields; consecutive fragments with the same path form one value. Introduce the topic and naturally check whether now is convenient before asking substantive questions. Opening fields are guidance, not a script. Recording consent alone is not readiness to discuss the task. If already invited to continue or given a task answer, continue from it. Do not repeat the greeting, initiator or disclosures. Follow the task delegation policy.");
  }
  configureConsent() {
    if (this.#backendEnabled) return;
    this.#consentBackend = true;
    this.#backendRevision++;
    this.#send({ type: "session.update", session: { delegation: { type: "responses", responses: {
      model: this.options.delegationModel ?? "gpt-6-luna", parallel_tool_calls: false,
      tool_choice: "auto", tools: liveConsentTools(), max_output_tokens: 2048,
      instructions: consentBackendInstructions(this.context.snapshot.plan.callLocale)
    } } } });
  }
  /** One request for an observed, settled answer not covered by native work. */
  requestDecision() {
    if (!this.#ready || this.#closing || this.context.isClosing() || this.#activity.speaking || this.#toolBusy ||
        (!this.#backendEnabled && !this.#consentBackend) || !this.lifecycle?.decisionReady?.()) return;
    const key = `${this.#backendRevision}:${this.#answerRevision}`;
    if (key === this.#requestedDecision || key === this.#coveredDecision ||
        [...this.#commands.values()].some(command => command.type === "response.create") ||
        [...this.#delegations.values()].some(id => !this.#runs.get(id)?.settled)) return;
    this.#requestedDecision = key;
    this.options.logger?.info({ callAttemptId: this.context.attemptId, generation: this.#epoch,
      answerRevision: this.#answerRevision, backendRevision: this.#backendRevision }, "Live answer decision requested");
    this.#send({ type: "response.create" });
  }
  suspendConsent() {
    if (this.#backendEnabled || !this.#consentBackend) return;
    this.#consentBackend = false;
    this.#backendRevision++;
    this.#send({ type: "session.update", session: { delegation: { type: "responses", responses: this.#backendConfiguration(false) } } });
  }
  instruct(content: string) { this.#append("session.instructions.append", content); }
  commentary(content: string) { this.#append("session.commentary.append", content); }
  #append(type: string, content: string) {
    if (this.#ready && !this.#closing) this.#send({ type, delegation_id: null, content });
  }
  #send(payload: object) {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    const event_id = randomUUID(), type = String(object(payload).type);
    if ((type.endsWith(".append") && type !== "session.input_audio.append") || type === "session.update" || type === "response.create") {
      const timer = setTimeout(() => this.#fail("LIVE_CONTEXT_ACK_TIMEOUT"), 15_000); timer.unref?.();
      this.#commands.set(event_id, { type, timer });
    }
    this.#socket.send(JSON.stringify({ event_id, ...payload }));
  }
  #message(data: RawData) {
    let event: Record<string, unknown>;
    try { event = object(JSON.parse(data.toString())); } catch { this.#fail("LIVE_INVALID_EVENT"); return; }
    if (typeof event.event_id === "string") {
      if (this.#seen.has(event.event_id)) return;
      this.#seen.add(event.event_id);
      if (this.#seen.size > 50_000) { this.#fail("LIVE_EVENT_LIMIT"); return; }
    }
    const ack = typeof event.client_event_id === "string" ? this.#commands.get(event.client_event_id) : undefined;
    if (ack && event.type === `${ack.type}ed`) { clearTimeout(ack.timer); this.#commands.delete(String(event.client_event_id)); return; }
    if (event.type === "session.usage.updated" || event.type === "session.closed") {
      const seconds = object(event.usage).seconds;
      if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) this.#seconds = seconds;
      else if (event.type === "session.closed") { this.#fail("LIVE_INVALID_USAGE"); return; }
      if (event.type === "session.closed") {
        const expected = this.#closing;
        if (!this.#ready) this.#rejectStart?.(new Error("LIVE_START_FAILED"));
        this.#closing = true;
        this.#finalize(true, expected && event.reason === "close_requested"); this.#socket?.close();
        if (!expected && this.#ready) this.context.fail();
      }
      return;
    }
    // Closing stops conversation effects, but final backend usage can still arrive
    // between session.close and session.closed.
    if (event.type === "response.event" && !this.#finalized) { this.#backendEvent(event); return; }
    if (this.#closing) {
      if (!this.#finalized && this.lifecycle && this.#backendEnabled &&
          (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta")) this.#transcript(event,true);
      return;
    }
    if (event.type === "session.started") {
      if (this.#ready) return;
      const session = object(event.session);
      if (typeof session.id !== "string" || !session.id || session.id.length > 200) { this.#fail(); return; }
      if (!this.#checkVoice(session)) return;
      this.#sessionId = session.id; this.#sessionStartedAt = new Date().toISOString(); this.#ready = true;
      if(this.lifecycle) this.#write(() => this.#capture("collecting"));
      if (this.#startTimer) clearTimeout(this.#startTimer);
      this.#resolveStart?.(); this.#resolveStart = null; this.#rejectStart = null;
      for (const audio of this.#queue) this.#send({ type: "session.input_audio.append", audio });
      this.#queue = []; this.#queuedBytes = 0;
      this.context.telemetry(`live:${this.operationId}:ready`, { name: "realtime.ready", metadata: { model: this.#model, transcriptionModel: this.#model, runtimeVersion: "live-managed-v1" } });
      if (this.lifecycle) this.lifecycle.ready(); else this.#backendEnabled = true;
    } else if (event.type === "session.updated") {
      if (!this.#ready || !this.#checkVoice(object(event.session))) return;
      if (ack?.type === "session.update") { clearTimeout(ack.timer); this.#commands.delete(String(event.client_event_id)); }
    } else if (event.type === "session.delegation.created") {
      const delegation = object(event.delegation);
      if (typeof delegation.id === "string" && typeof delegation.response_id === "string")
        this.#delegations.set(delegation.id, delegation.response_id);
    } else if (event.type === "session.output_audio.delta" && this.#ready) {
      if (!decodePcmu(event.delta)) { this.#fail("LIVE_INVALID_OUTPUT_AUDIO"); return; }
      if (this.lifecycle) this.lifecycle.audio(event.delta as string);
      else if (!this.context.isClosing()) this.context.sendAudio(event.delta as string);
    } else if ((event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") && this.#ready) this.#transcript(event);
    else if (event.type === "error") {
      const error = object(event.error);
      const code = typeof error.code === "string" && /^[a-z0-9_.-]{1,120}$/i.test(error.code) ? error.code : "unknown";
      this.options.logger?.warn({ callBriefId: this.context.brief.id, code }, "Live command failed");
      this.#fail("LIVE_COMMAND_REJECTED");
    }
  }
  #voiceTelemetry(sessionId: string | null, confirmedVoice: string | null,
    result: "requested" | "confirmed" | "mismatch" | "unconfirmed") {
    const metadata = { requestedVoice: this.#voice, confirmedVoice, sessionId, model: this.#model,
      phase: this.#backendEnabled ? "conversation" as const : this.#consentBackend ? "consent" as const : "startup" as const, result };
    this.context.telemetry(`live:${this.operationId}:voice:${++this.#voiceChecks}`, { name: "realtime.voice", metadata });
    this.options.logger?.info({ callAttemptId: this.context.attemptId, ...metadata }, "Live voice configuration");
  }
  #checkVoice(session: Record<string, unknown>) {
    const token = (value: unknown) => typeof value === "string" && /^[a-z0-9_.:/-]{1,160}$/i.test(value) ? value : null;
    const voice = token(object(object(session.audio).output).voice), id = token(session.id);
    const result = !voice || !id ? "unconfirmed" : voice !== this.#voice || (this.#sessionId && id !== this.#sessionId) ? "mismatch" : "confirmed";
    this.#voiceTelemetry(id, voice, result);
    if (result !== "confirmed") {
      this.context.clearPlayback();
      this.#fail(result === "mismatch" ? "LIVE_VOICE_MISMATCH" : "LIVE_VOICE_UNCONFIRMED");
      return false;
    }
    return true;
  }
  #transcript(event: Record<string, unknown>, drainOnly = false) {
    if (typeof event.delta !== "string" || event.delta.length > 32_000 || typeof event.start_ms !== "number" ||
      typeof event.end_ms !== "number" || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) ||
      event.start_ms < 0 || event.end_ms < event.start_ms) { this.#fail("LIVE_INVALID_TRANSCRIPT"); return; }
    const role = event.type === "session.input_transcript.delta" ? "recipient" : "assistant";
    // A late pre-consent answer must not become persistable after the phase changes.
    if (this.lifecycle && this.#backendEnabled && event.start_ms < this.#transcriptBoundaryMs) return;
    if (!drainOnly && role === "recipient" && event.delta.trim()) {
      this.#epoch++;
      this.#answerRevision++;
      if (this.context.interruptFarewell()) this.instruct("Closing cancelled by recipient speech. Continue naturally; a fresh end_call is required.");
    }
    const eventId = typeof event.event_id === "string" ? event.event_id : randomUUID();
    const key = `live:${this.operationId}:${role}:${event.start_ms}:${event.end_ms}:${eventId}`;
    const text = event.delta;
    const nativeTiming = { sessionId: this.#sessionId!, eventId, sessionStartedAt: this.#sessionStartedAt, startMs: event.start_ms, endMs: event.end_ms };
    const persist = () => {
      this.options.service.publishTranscriptDelta(this.context.brief.id, key, role, text, this.context.brief.locale, nativeTiming);
      this.#write(() => this.options.service.addNativeLiveTranscript(this.context.brief.id, role, text, key, nativeTiming));
    };
    if (!drainOnly && this.lifecycle && !this.lifecycle.transcript(role, text, event.start_ms, event.end_ms, persist)) return;
    persist();
  }

  close() {
    if (this.#closing) return;
    this.#closing = true;  this.#queue = []; this.#clearCommands();
    if (this.#startTimer) clearTimeout(this.#startTimer);
    this.#rejectStart?.(new Error("LIVE_START_CANCELLED")); this.#rejectStart = null;
    if (this.#ready && this.#socket?.readyState === WebSocket.OPEN) {
      this.#send({ type: "session.close" });
      this.#closeTimer = setTimeout(() => { this.#finalize(false); this.#socket?.terminate(); }, 15_000); this.#closeTimer.unref?.();
    } else { this.#finalize(false); this.#socket?.terminate(); }
  }
  #backendEvent(envelope: Record<string, unknown>) {
    const event = object(envelope.event);
    const delegation = envelope.delegation_id;
    if (typeof delegation !== "string") { this.#fail(); return; }
    const response = object(event.response);
    if (event.type === "response.created") {
      for (const [id, command] of this.#commands) if (command.type === "response.create") {
        clearTimeout(command.timer); this.#commands.delete(id);
      }
      if (typeof response.id !== "string" || this.#runs.size >= 128) { this.#fail(); return; }
      if (this.#runs.has(response.id)) return;
      const previous = this.#runs.get(this.#delegations.get(delegation) ?? "");
      const consent = previous?.consent ?? this.#consentBackend;
      // Continuing a consent tool does not refresh its native conversation
      // snapshot. Only a NEW Live delegation may interpret a corrected answer.
      const run: BackendRun = { id: response.id, operationId: createProviderEventOperationId("realtime_response", `live:${this.operationId}:${response.id}`),
        startedAt: Date.now(), epoch: consent && previous ? previous.epoch : this.#epoch,
        answerRevision: consent && previous ? previous.answerRevision : this.#answerRevision,
        backendRevision: previous ? previous.backendRevision : this.#backendRevision,
        closingEpoch: previous?.closingEpoch, rejected: previous?.rejected, consent, calls: [], completed: false, timer: setTimeout(() => {
          if (run.epoch !== this.#epoch || run.backendRevision !== this.#backendRevision ||
            (run.closingEpoch !== undefined && !this.context.isClosing())) return;
          if (this.lifecycle?.backendFailed) this.lifecycle.backendFailed();
          else this.#fail("LIVE_BACKEND_TIMEOUT");
        }, 30_000) };
      run.timer.unref?.();
      this.#runs.set(run.id, run); this.#delegations.set(delegation, run.id);
      this.#write(() => this.options.service.recordRealtimeProviderOperation({
        id: run.operationId, parentOperationId: this.operationId, callBriefId: this.context.brief.id,
        callAttemptId: this.context.attemptId, provider: "openai", operationType: "realtime_response",
        stage: "live_delegation", requestedModel: (this.options.delegationModel ?? "gpt-6-luna"), clientRequestId: run.operationId,
        startedAt: new Date(run.startedAt).toISOString(), result: null
      }));
      return;
    }
    const id = typeof response.id === "string" ? response.id : typeof event.response_id === "string" ? event.response_id : this.#delegations.get(delegation);
    const run = id ? this.#runs.get(id) : undefined;
    if (!run || run.completed) return;
    if (event.type === "response.output_item.done") {
      const item = object(event.item);
      if (item.type !== "function_call") return;
      if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string" || item.arguments.length > 16_000 || run.calls.length >= 16) {
        this.#fail(); return;
      }
      if (!run.calls.some(call => call.call_id === item.call_id)) run.calls.push(item as FunctionCall);
    } else if (["response.completed", "response.failed", "response.incomplete", "response.cancelled"].includes(String(event.type))) {
      for (const value of Array.isArray(response.output) ? response.output : []) {
        const item = object(value);
        if (item.type !== "function_call" || run.calls.some(call => call.call_id === item.call_id)) continue;
        if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string" || item.arguments.length > 16_000 || run.calls.length >= 16) { this.#fail(); return; }
        run.calls.push(item as FunctionCall);
      }
      run.completed = true; clearTimeout(run.timer);
      const succeeded = event.type === "response.completed" && response.status === "completed";
      const usage = liveResponsesUsage(response.usage);
      this.#write(() => this.options.service.completeProviderOperation({
        operationId: run.operationId, outcome: succeeded ? "succeeded" : "provider_error",
        providerRequestId: null, providerResponseId: run.id,
        providerModel: typeof response.model === "string" ? response.model : (this.options.delegationModel ?? "gpt-6-luna"),
        statusCode: null, completedAt: new Date().toISOString(), durationMs: Date.now() - run.startedAt,
        errorCode: succeeded ? null : "LIVE_DELEGATION_FAILED", usage
      }));
      // Persist provider evidence before any effect. Recheck speech/shutdown after
      // the asynchronous ledger writes; a recipient may interrupt while they run.
      const persisted = this.#writes;
      void persisted.then(async () => {
        if (this.#closing) return;
        if (run.closingEpoch !== undefined && (run.closingEpoch !== this.#epoch || !this.context.isClosing())) return;
        if (!succeeded) {
          if (run.epoch !== this.#epoch || run.backendRevision !== this.#backendRevision) return;
          if (this.lifecycle?.backendFailed) this.lifecycle.backendFailed();
          else this.#fail("LIVE_DELEGATION_FAILED");
          return;
        }
        if (run.closingEpoch !== undefined && !run.calls.length) this.lifecycle?.closingBackendCompleted?.();
        if (!run.calls.length && !run.rejected && run.backendRevision === this.#backendRevision && run.epoch === this.#epoch)
          this.#coveredDecision = `${run.backendRevision}:${run.answerRevision}`;
        for (const call of run.calls) {
          const signature = createHash("sha256").update(call.name + "\n" + call.arguments).digest("hex");
          let cached = this.#toolResults.get(call.call_id);
          if (!cached) {
            cached = { signature, result: this.#executeTool(call, run.epoch, run.backendRevision, run.calls.length === 1) };
            this.#toolResults.set(call.call_id, cached);
          }
          const result = cached.signature === signature ? await cached.result : { ok: false, reason: "tool_call_id_collision" };
          if (!result.ok) run.rejected = true;
          if (this.#closing) return;
          if (call.name === "end_call" && result.ok) run.closingEpoch = run.epoch;
          this.#send({ type: "response.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } });
          if (call.name === "report_consent") {
            if (result.ok && result.decision === "affirmative") this.#consentBackend = false;
            this.options.logger?.info({ callAttemptId: this.context.attemptId, outcome: result.ok ? "accepted" : "rejected",
              reason: String(result.reason ?? "decision_applied"), generation: run.epoch,
              currentGeneration: this.#epoch, backendRevision: run.backendRevision, currentBackendRevision: this.#backendRevision,
              speaking: this.#activity.speaking }, "Live consent tool result");
            if (!result.ok && this.#consentBackend && run.backendRevision === this.#backendRevision && !this.context.isClosing()) {
              if (result.reason !== "stale_or_unauthorized_request") this.instruct("The consent decision was not accepted. Do not reuse the previous decision. After the recipient finishes, delegate the latest complete answer and disclosure context anew. If there is no new answer, keep listening. Do not announce this internal check.");
            }
          }
        }
        // Deliver tool results through the normal managed backend continuation, including end_call.
        if (run.calls.length) this.#send({ type: "response.create" });
      }).catch(() => this.#fail("LIVE_TOOL_FAILURE")).finally(() => {
        run.settled = true;
        this.requestDecision();
      });
    }
  }

  async #executeTool(call: FunctionCall, epoch: number, backendRevision: number, single: boolean): Promise<Record<string, unknown>> {
    const current = () => single && !this.#closing && epoch === this.#epoch && backendRevision === this.#backendRevision && !this.#activity.speaking;
    const authorized = this.#backendEnabled ? call.name !== "report_consent" : this.#consentBackend && call.name === "report_consent";
    if (!authorized || !current()) return { ok: false, reason: "stale_or_unauthorized_request" };
    if (this.#toolBusy) return { ok: false, reason: "another_action_pending" };
    if (this.lifecycle) {
      this.#toolBusy = true;
      try {
        const result = await this.lifecycle.tool(call, current);
        if (["end_call", "request_appointment", "confirm_appointment"].includes(call.name)) {
          const fingerprint = createHash("sha256").update(this.context.attemptId + ":" + call.call_id).digest("hex");
          this.context.telemetry("live:tool:" + fingerprint, { name: "conversation.tool_result", metadata: {
            tool: call.name as "end_call", outcome: result.ok ? "accepted" : "rejected",
            reason: String(result.reason ?? "application_result"), requestFingerprint: fingerprint,
            generation: epoch, snapshotHash: this.context.snapshot.compilationSnapshotHash
          } });
        }
        return result;
      } finally { this.#toolBusy = false; }
    }
    if (call.name === "end_call" && this.options.agentHangupEnabled) {
      let args: Record<string, unknown>;
      try { args = object(JSON.parse(call.arguments)); } catch { return { ok: false, reason: "invalid_arguments" }; }
      if (["objective_resolved", "recipient_requested_end", "cannot_proceed"].includes(String(args.reason))) {
        return { ok: this.context.requestFarewell(call.call_id, args.reason as "objective_resolved"), actionCompleted: false };
      }
    }
    return { ok: false, reason: "unsupported_tool" };
  }

  #clearCommands() { for (const command of this.#commands.values()) clearTimeout(command.timer); this.#commands.clear(); }
  async #capture(status: "collecting" | "complete" | "incomplete") {
    if(!this.#sessionId) return;
    await this.options.service.setNativeTranscriptCapture(this.context.brief.id,this.context.attemptId,{
      version:1,sessionId:this.#sessionId,model:this.#model,
      status:status === "complete" && this.#persistenceFailed ? "incomplete" : status,updatedAt:new Date().toISOString()
    });
  }
  #write(write: () => Promise<unknown>) {
    this.#writes = this.#writes.then(write).then(() => undefined).catch(() => {
      this.#persistenceFailed = true;
      this.options.logger?.error({ callBriefId: this.context.brief.id }, "Live persistence failed"); this.#fail("LIVE_PERSISTENCE_FAILED");
    });
  }
  #fail(code = "LIVE_PROTOCOL_FAILURE") {
    if (this.#finalized) return;
    this.#failureCode = code;
    this.options.logger?.warn({ callBriefId: this.context.brief.id, code }, "Live session failed");
    this.#rejectStart?.(new Error("LIVE_START_FAILED")); this.#rejectStart = null;
    this.#closing = true;  this.#queue = [];
    this.#finalize(false); this.#socket?.terminate();
    if (this.#ready) this.context.fail();
  }
  #finalize(finalized: boolean, successful = finalized) {
    if (this.#finalized || !this.#reserved) return;
    this.#finalized = true; this.#clearCommands();
    if (this.#startTimer) clearTimeout(this.#startTimer);
    if (this.#closeTimer) clearTimeout(this.#closeTimer);
    for (const run of this.#runs.values()) if (!run.completed) {
      run.completed = true; clearTimeout(run.timer);
      this.#write(() => this.options.service.completeProviderOperation({ operationId: run.operationId,
        outcome: "network_error", providerRequestId: null, providerResponseId: run.id, providerModel: this.options.delegationModel ?? "gpt-6-luna",
        statusCode: null, completedAt: new Date().toISOString(), durationMs: Date.now() - run.startedAt,
        errorCode: "LIVE_DELEGATION_INTERRUPTED", usage: null }));
    }
    this.#write(() => this.options.service.completeProviderOperation({ operationId: this.operationId,
      outcome: successful ? "succeeded" : !finalized && (!this.#failureCode || ["LIVE_SOCKET_ERROR", "LIVE_SOCKET_CLOSED", "LIVE_STARTUP_TIMEOUT"].includes(this.#failureCode)) ? "network_error" : "provider_error",
      providerRequestId: null, providerResponseId: this.#sessionId, providerModel: this.#model, statusCode: null,
      completedAt: new Date().toISOString(), durationMs: Date.now() - this.#startedAt,
      errorCode: successful ? null : this.#failureCode ?? "LIVE_FINAL_USAGE_UNCONFIRMED", usage: liveDurationUsage(this.#seconds, finalized) }));
    if(this.lifecycle) this.#write(() => this.#capture(successful && this.lifecycle?.transcriptCaptureComplete?.() !== false ? "complete" : "incomplete"));
  }
}

export function buildLiveInstructions(context: VoiceConversationContext, consentComplete = true) {
  const { plan, runtime } = context.snapshot;
  const identity = `You are ${runtime.agentName}, an AI telephone assistant. Speak ${plan.callLocale} with ${plan.addressingStyle} address and ${plan.tone} tone. ${plan.addressingStyle === "formal" ? "Keep formal address even with first names." : "Use the approved addressing style."} ${runtime.allowLanguageSwitch ? `Switch only to ${runtime.fallbackLocale} on explicit request.` : "Do not change language."}`;
  return identity + `
Speaking pace: Speak calmly, slightly slower than ordinary conversation, with natural pauses and clear names, dates and numbers.
Voice continuity: Keep the same ${runtime.voiceGender === "male" ? "masculine" : "feminine"} voice, identity and accent through every stage, including application text and backend results. Do not imitate the recipient.
${consentComplete ? "Consent and opening are complete. Listen for the opening answer, or act on it if received. Do not greet again." : "Stay silent until application disclosure/opening instructions. Do not ask task questions, infer permission or perform task work until the application enables the task stage. During consent, delegate the complete recipient answer and disclosure context to report_consent when the application enables that tool. Natural spoken permission needs no keypad press. Wait silently for the application's next instruction after the decision. These consent-only restrictions end when the application enables the task stage."}
Address the called recipient on the customer's behalf. Follow the approved task; accept unknown answers and refusals. Preserve uncertainty and corrections. Repeat important details only when useful to catch an error. Explain constraints only when they affect the recipient's request or expectations.
Backchannel policy: Only after the application enables the task stage, brief natural acknowledgments of received information are allowed, including while the backend works. During disclosure and consent, speak only the application's explicitly requested utterance; no filler, acknowledgments or processing commentary. During the task acknowledge what the recipient said when useful, then allow a short silence. Keep internal checks, saving and tool activity silent. An acknowledgment is not a claim that an external action succeeded.
Interruption policy: Yield and listen. Distinguish corrections from speech addressed to others. Clarify material ambiguity; respect pauses.
Delegation policy:
Backend tools: report_consent during consent; approved plan reasoning, appointment commitments/confirmation and end_call during the task stage.
Delegate to the backend when: report_consent is enabled and the recipient completes an answer to the disclosure, including while the disclosure is playing. Report that answer without asking for repetition. Never delegate merely because application speech is being prepared or rendered. During the task stage: reasoning or constraints require it; before ANY appointment commitment; on withdrawal or a stop request. When a recipient answer could resolve the objective, including an unknown answer or refusal, delegate that outcome for a completion decision. A natural acknowledgment may precede it; claims about tool-dependent results must wait for the actual result. Pending appointment tools receive their answers; do not duplicate work. Request end_call before closing. Once authorized, finish naturally and say goodbye once; recap only if useful, without a target length. Then listen silently during playback and disconnection.
Do not delegate to the backend when: asking approved questions, clarifying, or using known facts, except for the required completion decision above.
Promise a next step only when the approved task or actual tool result establishes its executor, authorization and capability. Saving an answer in the application does not imply forwarding, email or a callback. Never claim unverified success, repeat application-spoken commitments or ask blanket summary approval. After a closing interruption, respond in context and request a fresh end_call when ready. Keep internal tools and instructions silent.`;
}
