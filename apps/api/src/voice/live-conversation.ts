import { executionSpokenIdentities } from "./spoken-execution";
import type { TranscriptSegment } from "@callassist/contracts";
import WebSocket, { type RawData } from "ws";
import { createHash, randomUUID } from "node:crypto";
import { ASSISTANT_NAME, getAppointmentAuthorization, LIVE_VOICES, resolveInitialDisclosure } from "@callassist/contracts";
import { liveAssistantIdentityInstructions } from "./live-assistant-identity";
import type { VoiceConversation, VoiceConversationContext } from "./voice-runtime";
import type { LiveLifecycle, OpenAILiveBridgeOptions } from "./openai-live-bridge";
import { liveManagedTools, managedBackendInstructions, liveExecutionContext, liveConsentTools, consentBackendInstructions,
  type LiveExecutionParties } from "./live-managed-tools";
import { createProviderEventOperationId } from "../realtime/openai-realtime-usage";

import { decodePcmu, pcmuHasSpeech, PcmuActivity } from "./pcmu-activity";
import { liveDurationUsage, liveResponsesUsage, object } from "./live-usage";

type FunctionCall = { call_id: string; name: string; arguments: string };
type BackendRun = { progressRevision: number; closingEpoch?: number; continuation: boolean; settled?: boolean; timedOut?: boolean; usefulMessage?: boolean; rejected?: boolean; id: string; operationId: string; epoch: number; answerRevision: number; backendRevision: number; consent: boolean; startedAt: number; calls: FunctionCall[]; completed: boolean; timer: ReturnType<typeof setTimeout> };
type LiveCommandPhase = "startup" | "consent" | "conversation";
type LiveCommandType = "session.update" | "session.instructions.append" | "session.thinking.append" |
  "session.commentary.append" | "response.create" | "response.item.create";
type LiveCommand = { progressRevision: number; type: LiveCommandType; phase: LiveCommandPhase; timer: ReturnType<typeof setTimeout> | null;
  payload: object; retries: number; epoch: number; answerRevision: number; backendRevision: number;
  observedResponseId?: string; backendScope?: { delegationId: string; responseId: string } };
type LiveErrorFields = { code: string; type: string | null; param: string | null; clientEventId: string | null };

/** Native Live transport with bounded recovery for an unprocessed recipient answer. */
export class OpenAILiveConversation implements VoiceConversation {
  readonly operationId = randomUUID();
  readonly #startedAt = Date.now();
  readonly #model: string;
  readonly #voice: "cedar" | "marin";
  #voiceChecks = 0;
  readonly #activity = new PcmuActivity();
  readonly #seen = new Set<string>();
  readonly #commands = new Map<string, LiveCommand>();
  readonly #recentCommands = new Map<string, LiveCommand>();
  readonly #announced = new Map<string, { timer: ReturnType<typeof setTimeout>; timedOut: boolean; epoch: number; answerRevision: number; backendRevision: number; progressRevision: number }>();
  readonly #runs = new Map<string, BackendRun>();
  readonly #delegations = new Map<string, string>();
  readonly #toolResults = new Map<string, { signature: string; result: Promise<Record<string, unknown>> }>();
  readonly #activityWaiters = new Set<() => void>();
  #epoch = 0;
  #answerRevision = 0;
  #toolBusy = false;
  #backendEnabled = false;
  #consentBackend = false;
  #backendRevision = 0;
  #progressRevision = 0;
  #requestedConsentDecision = "";
  #consentNoToolKey = "";
  #consentNoToolCount = 0;
  #taskRequested = "";
  #taskCovered = "";
  #taskNoDecision = 0;
  #taskNoDecisionKey = "";
  #taskDecisionTimer: ReturnType<typeof setTimeout> | null = null;
  #socket: WebSocket | null = null;
  #ready = false;
  #closing = false;
  #finalized = false;
  #reserved = false;
  #reservation: Promise<void> | null = null;
  #sessionId: string | null = null;
  #sessionStartedAt = new Date().toISOString();
  #seconds: number | null = null;
  #inputAudioMs = 0;
  #consentTranscriptBoundaryMs = Number.POSITIVE_INFINITY;
  #queue: string[] = [];
  #queuedBytes = 0;
  #writes = Promise.resolve();
  #persistenceFailed = false;
  #transcriptBoundaryMs = Number.POSITIVE_INFINITY;
  #recordingAdmitted = false;
  #outputSuspended = false;
  #outputSuppression: Array<{ start: number; end: number }> = [];
  #outputFenceMs = -1;
  #outputEpochReady = true;
  #outputResumeId: string | undefined;
  #nativeActivityAt = 0;
  #continuations = new Map<string, { responseId: string; consent: boolean }>();
  #startTimer: ReturnType<typeof setTimeout> | null = null;
  #closeTimer: ReturnType<typeof setTimeout> | null = null;
  #resolveStart: (() => void) | null = null;
  #rejectStart: ((error: Error) => void) | null = null;
  #failureCode: string | null = null;

  get #parties(): LiveExecutionParties {
    return { representedPerson: this.context.brief.representedPerson,
      recipientName: this.context.brief.recipientName };
  }

  constructor(private readonly options: OpenAILiveBridgeOptions, private readonly context: VoiceConversationContext,
    private readonly lifecycle?: LiveLifecycle) {
    this.#model = options.liveModel ?? "gpt-live-1";
    this.#voice = context.snapshot.runtime.liveVoice ?? LIVE_VOICES[context.snapshot.runtime.voiceGender];
  }
  async start() {
    // The opt-in legacy hybrid adapter has no buffered action playback gate.
    // Leave such calls with its already prepared Realtime runtime, before Live starts.
    if (!this.lifecycle && getAppointmentAuthorization(this.context.snapshot.plan)) throw new Error("LIVE_ACTION_PLAYBACK_GATE_REQUIRED");
    this.#reservation ??= this.options.service.startRealtimeProviderSessions([{ id: this.operationId, callBriefId: this.context.brief.id,
      callAttemptId: this.context.attemptId, provider: "openai", operationType: "realtime_session", stage: "live_conversation",
      requestedModel: this.#model, clientRequestId: this.operationId, startedAt: new Date(this.#startedAt).toISOString() }])
      .then(() => { this.#reserved = true; });
    await this.#reservation;
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
  whenReserved() {
    return this.#reservation ?? Promise.reject(new Error("LIVE_SESSION_NOT_STARTED"));
  }
  inputAudio(payload: string) {
    if (this.#closing) return;
    const bytes = decodePcmu(payload);
    if (!bytes) { this.#fail("LIVE_INVALID_INPUT_AUDIO"); return; }
    this.#inputAudioMs += bytes.length / 8;
    const activity = this.#activity.push(bytes);
    this.lifecycle?.activity(activity, this.#activity.voicedMs);
    if (activity === "started") {
      if (!this.lifecycle) this.context.clearPlayback();
    }
    if (activity === "stopped") this.#releaseActivityWaiters();
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
    this.lifecycle?.backendProgress?.();
    this.#send({ type: "response.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.#append("session.thinking.append", text);
    this.#write(() => this.options.service.addRealtimeTranscript(this.context.brief.id, "recipient", text, id));
  }
  #backendConfiguration(enabled: boolean) {
    return { model: this.options.delegationModel ?? "gpt-6-luna", parallel_tool_calls: false,
      tool_choice: enabled ? "auto" : "none", tools: enabled ? liveManagedTools(this.context.snapshot, !!this.options.agentHangupEnabled, !!this.lifecycle) : [],
      reasoning: { effort: "low" }, max_output_tokens: 512,
      instructions: enabled ? managedBackendInstructions(this.context.snapshot, this.#parties, !!this.lifecycle) :
        "Consent has not been granted. No task is authorized. Do not perform work, ask task questions, infer consent or use tools." };
  }
  admitRecording(recordingStartedAt: string) {
    const boundary = Date.parse(recordingStartedAt) - Date.parse(this.#sessionStartedAt);
    if (!Number.isFinite(boundary) || boundary < 0) throw new Error("LIVE_RECORDING_BOUNDARY_INVALID");
    this.#transcriptBoundaryMs = boundary;
    this.#recordingAdmitted = true;
  }
  suspendOutput() {
    if (!this.#outputSuspended) this.#outputSuppression.push({
      start: Math.max(0, Date.now() - Date.parse(this.#sessionStartedAt)), end: Number.POSITIVE_INFINITY
    });
    this.#outputSuspended = true; this.#outputEpochReady = false; this.#outputResumeId = undefined;
  }
  resumeOutput(outcome: string) {
    if (!this.#outputSuspended || this.#closing) return;
    if (this.#outputResumeId) return;
    // ACK establishes a context timeline fence. Native audio has no timestamps;
    // it stays muted until a fresh assistant transcript crosses that fence.
    this.#outputResumeId = this.#send({ type: "session.thinking.append", delegation_id: null,
      content: JSON.stringify({ applicationPlaybackOutcome: outcome, instruction: "Continue the current dialogue. Do not repeat application-played text." }) });
  }
  configureBackend(recordingStartedAt?: string) {
    if (this.lifecycle && !this.#recordingAdmitted) {
      if (!recordingStartedAt) throw new Error("LIVE_RECORDING_BOUNDARY_REQUIRED");
      this.admitRecording(recordingStartedAt);
    }
    if (this.#backendEnabled) return;
    this.#backendEnabled = true;
    this.#consentBackend = false;
    this.#backendRevision++;
    this.#send({ type: "session.update", session: { delegation: { type: "responses", responses: this.#backendConfiguration(true) } } });
    for (const data of liveExecutionContext(this.context.snapshot, this.#parties)) this.#append("session.thinking.append", data);
    this.instruct("Task stage enabled. Recording has started. Use the approved task context and continue naturally on behalf of the represented person. Introduce the purpose and check readiness only if the recipient has not already invited continuation or answered the task. Do not repeat the greeting, identity or disclosures. Do not read internal task fields aloud.");
  }
  configureConsent(afterInputAudioMs = 0) {
    if (this.#backendEnabled) return;
    this.#consentTranscriptBoundaryMs = this.#inputAudioMs + Math.max(0, afterInputAudioMs);
    this.#consentBackend = true;
    this.#backendRevision++;
    this.#send({ type: "session.update", session: { delegation: { type: "responses", responses: {
      model: this.options.delegationModel ?? "gpt-6-luna", parallel_tool_calls: false,
      tool_choice: "required", tools: liveConsentTools(), reasoning: { effort: "low" }, max_output_tokens: 128,
      instructions: consentBackendInstructions(this.context.snapshot.plan.callLocale,
        resolveInitialDisclosure(this.context.snapshot, this.#parties.representedPerson).text)
    } } } });
  }
  confirmConsentDisclosurePlayback() {
    if (this.#consentBackend)
      this.#consentTranscriptBoundaryMs = Math.min(this.#consentTranscriptBoundaryMs, this.#inputAudioMs);
  }
  /** One consent decision for an observed, settled answer not covered by native work. */
  requestConsentDecision() {
    if (!this.#ready || this.#closing || this.context.isClosing() || this.#activity.speaking || this.#toolBusy ||
        this.#backendEnabled || !this.#consentBackend || !this.lifecycle?.decisionReady?.()) return;
    const key = `${this.#backendRevision}:${this.#answerRevision}`;
    this.#flushContinuations();
    if (key === this.#requestedConsentDecision || this.#backendOccupied()) return;
    this.#requestedConsentDecision = key;
    this.options.logger?.info({ callAttemptId: this.context.attemptId, generation: this.#epoch,
      answerRevision: this.#answerRevision, backendRevision: this.#backendRevision }, "Live consent decision requested");
    this.#send({ type: "session.update", session: { delegation: { type: "responses", responses: { tool_choice: "required", tools: liveConsentTools() } } } });
    this.#send({ type: "response.create" });
  }
  scheduleTaskDecision() {
    if (this.#taskDecisionTimer) clearTimeout(this.#taskDecisionTimer);
    this.#taskDecisionTimer = setTimeout(() => {
      this.#taskDecisionTimer = null;
      this.requestTaskDecision();
    }, 5_000);
    this.#taskDecisionTimer.unref?.();
  }
  appointmentState(appointment: unknown) {
    this.#append("session.thinking.append", JSON.stringify({ applicationAppointmentState: appointment }));
  }
  requestTaskDecision() {
    this.#flushContinuations();
    const state = this.lifecycle?.taskDecisionContext?.();
    if (!state || !this.#ready || this.#closing || !this.#backendEnabled || this.#activity.speaking ||
        this.#toolBusy || !this.lifecycle?.decisionReady?.()) return;
    const key = `${this.#backendRevision}:${this.#answerRevision}:${state.waitingExpired ? "deadline" : "answer"}`;
    this.#flushContinuations();
    if (key === this.#taskRequested || key === this.#taskCovered || this.#backendOccupied()) return;
    if (!state.waitingExpired && !state.closing && Date.now() - this.#nativeActivityAt < 5_000) {
      this.scheduleTaskDecision(); return;
    }
    this.#taskRequested = key;
    // This is trusted application state, separate from the recipient's untrusted words.
    this.#send({ type: "response.item.create", item: { type: "message", role: "developer", content: [{ type: "input_text",
      text: JSON.stringify({ applicationConversationState: state,
        instruction: "Interpret the latest complete recipient answer. Choose the next application tool; do not repeat completed actions. A waiting deadline requires a bounded resolution." }) }] } });
    this.options.logger?.info({ callAttemptId: this.context.attemptId, answerRevision: this.#answerRevision,
      backendRevision: this.#backendRevision, closing: state.closing, waitingExpired: state.waitingExpired }, "Live task decision requested");
    this.#send({ type: "response.create" });
  }
  suspendConsent() {
    if (this.#backendEnabled || !this.#consentBackend) return;
    this.#consentTranscriptBoundaryMs = Number.POSITIVE_INFINITY;
    this.#consentBackend = false;
    this.#backendRevision++;
    this.#send({ type: "session.update", session: { delegation: { type: "responses", responses: this.#backendConfiguration(false) } } });
  }
  instruct(content: string) { this.#append("session.instructions.append", content); }
  commentary(content: string) { this.#append("session.commentary.append", content); }
  #append(type: string, content: string) {
    if (this.#ready && !this.#closing) this.#send({ type, delegation_id: null, content });
  }
  #send(payload: object, retries = 0, phaseOverride?: LiveCommandPhase, backendScope?: LiveCommand["backendScope"]) {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    const event_id = randomUUID(), type = String(object(payload).type);
    if (isTrackedCommand(type)) {
      const command: LiveCommand = { progressRevision: this.#progressRevision, type, phase: phaseOverride ?? this.#commandPhase(), timer: null, payload, retries,
        epoch: this.#epoch, answerRevision: this.#answerRevision, backendRevision: this.#backendRevision, backendScope };
      // Function outputs have no separate success acknowledgement. Their error
      // correlation stays live until the following backend response starts.
      if (type !== "response.item.create") {
        command.timer = setTimeout(() => {
          if (this.#commands.get(event_id) !== command) return;
          this.#forgetCommand(event_id, command);
          this.#handleCommandFailure(command, {
            code: "ack_timeout", type: "client_timeout", param: null, clientEventId: event_id
          }, randomUUID());
        }, 15_000);
        command.timer.unref?.();
      }
      this.#commands.set(event_id, command);
    }
    this.#socket.send(JSON.stringify({ event_id, ...payload }));
    return event_id;
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
    if (ack && event.type === `${ack.type}ed`) {
      if (event.client_event_id === this.#outputResumeId) {
        if (typeof event.end_ms !== "number" || !Number.isFinite(event.end_ms) || event.end_ms < 0) {
          this.#fail("LIVE_OUTPUT_BOUNDARY_INVALID"); return;
        }
        this.#outputFenceMs = Math.max(this.#outputFenceMs, event.end_ms);
        const interval = this.#outputSuppression.at(-1);
        if (interval) interval.end = Math.max(interval.start, this.#outputFenceMs);
        this.#outputSuspended = false; this.#outputResumeId = undefined;
      }
      this.#forgetCommand(String(event.client_event_id), ack); return;
    }
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
      if (!this.#finalized && this.lifecycle &&
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
      this.context.telemetry(`live:${this.operationId}:ready`, { name: "realtime.ready", metadata: { model: this.#model, transcriptionModel: this.#model, runtimeVersion: "live-managed-v6" } });
      if (this.lifecycle) this.lifecycle.ready(); else this.#backendEnabled = true;
    } else if (event.type === "session.updated") {
      if (!this.#ready || !this.#checkVoice(object(event.session))) return;
      if (ack?.type === "session.update") this.#forgetCommand(String(event.client_event_id), ack);
    } else if (event.type === "session.delegation.created") {
      const delegation = object(event.delegation);
      const responseId = delegation.response_id ?? event.response_id;
      if (typeof delegation.id === "string" && typeof responseId === "string") {
        if (!this.#announced.has(delegation.id) && !this.#runs.has(responseId)) {
          if (this.#announced.size >= 128) { this.#fail("LIVE_DELEGATION_LIMIT"); return; }
          const revision = this.#backendRevision, epoch = this.#epoch, progress = this.#progressRevision;
          const current = () => revision === this.#backendRevision && epoch === this.#epoch && progress === this.#progressRevision;
          const timer = setTimeout(() => {
            // Keep ownership for a late response.created; expiration must not
            // turn an old delegation into work on the latest recipient answer.
            this.#announced.get(delegation.id as string)!.timedOut = true;
            this.options.logger?.info({ callAttemptId: this.context.attemptId, delegationId: delegation.id,
              epoch, backendRevision: revision, progressRevision: progress, current: current() }, "Live announced backend deadline settled");
            if (!current()) this.lifecycle?.backendFailed?.(() => this.#announced.has(delegation.id as string) ||
              !!this.#runs.get(this.#delegations.get(delegation.id as string) ?? "")?.timedOut, "LIVE_BACKEND_START_TIMEOUT");
            else if (this.#consentBackend) this.lifecycle?.consentDecisionUnavailable?.("provider_failure");
            else this.lifecycle?.backendFailed?.(current, "LIVE_BACKEND_START_TIMEOUT");
          }, 15_000);
          timer.unref?.(); this.#announced.set(delegation.id, { timer, timedOut: false, epoch, answerRevision: this.#answerRevision, backendRevision: revision, progressRevision: progress });
        }
      }
    } else if (event.type === "session.output_audio.delta" && this.#ready) {
      if (!decodePcmu(event.delta)) { this.#fail("LIVE_INVALID_OUTPUT_AUDIO"); return; }
      // Native WebSocket audio has no timing or utterance identifier. Reopen it
      // only after a fresh assistant transcript beyond the acknowledged fence.
      if (this.lifecycle && (this.#outputSuspended || !this.#outputEpochReady)) {
        return;
      }
      if (pcmuHasSpeech(decodePcmu(event.delta)!)) this.#nativeActivityAt = Date.now();
      if (this.lifecycle) this.lifecycle.audio(event.delta as string);
      else if (!this.context.isClosing()) this.context.sendAudio(event.delta as string);
    } else if ((event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") && this.#ready) this.#transcript(event);
    else if (event.type === "error") {
      const error = object(event.error);
      const token = (value: unknown) => typeof value === "string" && /^[a-z0-9_.:/-]{1,160}$/i.test(value) ? value : null;
      const clientEventId = token(error.client_event_id) ?? token(error.event_id), command = clientEventId ? this.#commands.get(clientEventId) : undefined;
      if (clientEventId && command) this.#forgetCommand(clientEventId, command);
      const fields: LiveErrorFields = { code: token(error.code) ?? "unknown", type: token(error.type),
        param: token(error.param), clientEventId };
      const providerEventId = typeof event.event_id === "string" ? event.event_id : randomUUID();
      if (command) { this.#handleCommandFailure(command, fields, providerEventId); return; }
      const recent = clientEventId ? this.#recentCommands.get(clientEventId) : undefined;
      if (recent) {
        this.#recordLiveError(fields, recent.phase, recent.type, "continued", recent.retries, providerEventId);
        return; // Already acknowledged work is never blindly replayed.
      }
      const phase = this.#commandPhase(), disposition = this.#ready ? "continued" : "fatal";
      this.#recordLiveError(fields, phase, null, disposition, 0, providerEventId);
      // An active Live error is not itself proof that the session or transport
      // failed. The provider reports those terminal conditions separately via
      // session.closed or the WebSocket. This also covers moderation events that
      // interrupt only the current output and late errors for settled commands.
      if (!this.#ready) this.#fail("LIVE_COMMAND_REJECTED");
    }
  }
  #commandPhase(): LiveCommandPhase {
    return this.#backendEnabled ? "conversation" : this.#consentBackend ? "consent" : "startup";
  }
  #forgetCommand(id: string, command: LiveCommand) {
    if (command.timer) clearTimeout(command.timer);
    command.timer = null;
    if (this.#commands.get(id) === command) this.#commands.delete(id);
    this.#recentCommands.set(id, command);
    if (this.#recentCommands.size > 256) this.#recentCommands.delete(this.#recentCommands.keys().next().value!);
  }
  #acknowledgeBackendStart(delegationId: string, responseId: string, allowFresh: boolean, epoch = this.#epoch) {
    let trigger: LiveCommand | null = null;
    for (const [id, command] of this.#commands) {
      if (command.type === "response.create" &&
          command.epoch === epoch && command.backendRevision === this.#backendRevision &&
          command.progressRevision === this.#progressRevision &&
          (command.backendScope ? command.backendScope.delegationId === delegationId : allowFresh)) {
        if (!command.backendScope) {
          this.context.telemetry(`live:${id}:association`, { name: "conversation.task", metadata: {
            runtimeVersion: "live-managed-v6", phase: "running", revision: command.answerRevision,
            cause: "ambiguous_backend_start" } });
          command.observedResponseId = responseId;
          // An unscoped start is not causal acknowledgement of this command.
          continue;
        }
        trigger = command; this.#forgetCommand(id, command);
        break;
      }
    }
    if (trigger) for (const [id, command] of this.#commands) {
      if (command.type === "response.item.create" &&
          command.backendScope?.delegationId === trigger.backendScope?.delegationId &&
          command.epoch === trigger.epoch && command.backendRevision === trigger.backendRevision)
        this.#forgetCommand(id, command);
    }
    return trigger;
  }
  #handleCommandFailure(command: LiveCommand, fields: LiveErrorFields, providerEventId: string) {
    if (fields.clientEventId === this.#outputResumeId && this.#outputSuspended) {
      if (fields.code !== "ack_timeout" && command.retries < 1 && !this.#closing) {
        this.#recordLiveError(fields, command.phase, command.type, "retrying", command.retries + 1, providerEventId);
        this.#outputResumeId = this.#send(command.payload, command.retries + 1, command.phase);
      } else {
        this.#recordLiveError(fields, command.phase, command.type, "fatal", command.retries + 1, providerEventId);
        const fenceId = this.#outputResumeId;
        this.lifecycle?.backendFailed?.(() => this.#outputSuspended && this.#outputResumeId === fenceId, "LIVE_OUTPUT_RESUME_FAILED");
      }
      return;
    }
    if (fields.code === "ack_timeout" && command.type === "response.create" &&
        [...this.#runs.values()].some(run => !run.settled)) {
      this.#recordLiveError(fields, command.phase, command.type, "continued", command.retries, providerEventId);
      this.#flushContinuations();
      return; // Observed physical work still owns the session lease.
    }
    this.#flushContinuations();
    if (command.backendRevision !== this.#backendRevision ||
        (["response.create", "response.item.create"].includes(command.type) &&
          (command.epoch !== this.#epoch || command.progressRevision !== this.#progressRevision))) {
      this.#recordLiveError(fields, command.phase, command.type, "continued", command.retries, providerEventId);
      if (this.#consentBackend) { this.#requestedConsentDecision = ""; this.requestConsentDecision(); }
      else { this.#taskRequested = ""; this.scheduleTaskDecision(); }
      return;
    }
    // An explicit provider rejection proves the command was not applied, so one
    // retry is safe. An acknowledgement timeout is ambiguous: retrying an append
    // or response.create could duplicate work the provider already accepted.
    if (!this.#closing && this.#socket?.readyState === WebSocket.OPEN && fields.code !== "ack_timeout" && command.retries < 1) {
      this.#recordLiveError(fields, command.phase, command.type, "retrying", command.retries + 1, providerEventId);
      this.#send(command.payload, command.retries + 1, command.phase, command.backendScope);
      return;
    }
    if (command.phase === "consent" && ["response.create", "response.item.create"].includes(command.type) && this.lifecycle?.consentDecisionUnavailable) {
      this.#requestedConsentDecision = "";
      this.#recordLiveError(fields, command.phase, command.type, "consent_recovery", command.retries + 1, providerEventId);
      this.lifecycle.consentDecisionUnavailable("provider_failure");
      return;
    }
    this.#recordLiveError(fields, command.phase, command.type, "fatal", command.retries + 1, providerEventId);
    this.options.logger?.warn({ callAttemptId: this.context.attemptId, command: command.type,
      backendScope: command.backendScope, epoch: command.epoch, backendRevision: command.backendRevision,
      progressRevision: command.progressRevision, code: fields.code }, "Live owned command failure");
    if (this.#backendEnabled && this.lifecycle?.backendFailed) {
      this.lifecycle.backendFailed(() => command.epoch === this.#epoch && command.backendRevision === this.#backendRevision && command.progressRevision === this.#progressRevision,
        "LIVE_COMMAND_REJECTED");
      return;
    }
    this.#fail("LIVE_COMMAND_REJECTED");
  }
  #recordLiveError(fields: LiveErrorFields, phase: LiveCommandPhase, command: LiveCommandType | null,
    disposition: "retrying" | "continued" | "consent_recovery" | "fatal", attempt: number, providerEventId: string) {
    const fingerprint = createHash("sha256").update(`${providerEventId}:${fields.clientEventId ?? ""}:${fields.code}:${attempt}`).digest("hex");
    const metadata = { phase, disposition, code: fields.code, type: fields.type, param: fields.param,
      command, clientEventId: fields.clientEventId, attempt: Math.min(2, attempt) };
    this.context.telemetry(`live:${this.operationId}:error:${fingerprint}`, { name: "realtime.error", metadata });
    this.options.logger?.warn({ callBriefId: this.context.brief.id, ...metadata }, "Live command failed");
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
    // Transcription can arrive after application-rendered playback. Never let
    // an utterance that started before the latest complete disclosure mark
    // become consent merely because its transcript was delayed.
    if (this.lifecycle && this.#consentBackend && role === "recipient" &&
        event.start_ms < this.#consentTranscriptBoundaryMs) return;
    // A late pre-consent answer must not become persistable after the phase changes.
    if (this.lifecycle && this.#recordingAdmitted && event.start_ms < this.#transcriptBoundaryMs) return;
    let historicalOutput = false;
    if (role === "assistant" && this.lifecycle && (this.#outputSuspended || event.start_ms < this.#outputFenceMs)) {
      const start = event.start_ms, end = event.end_ms;
      const intervals = this.#outputSuppression.filter(interval => start < interval.end && end > interval.start);
      if (intervals.length) {
        // A fragment crossing a playback boundary cannot be clipped into words.
        // Fully muted output was not heard and does not invalidate the transcript.
        if (!intervals.some(interval => start >= interval.start && end <= interval.end)) this.lifecycle.nativeTranscriptGap?.();
        return;
      }
      historicalOutput = true;
    }
    if (role === "assistant" && this.lifecycle && !drainOnly && !historicalOutput) this.#outputEpochReady = true;
    if (!drainOnly && role === "recipient" && event.delta.trim()) {
      this.#epoch++;
      this.#answerRevision++;
      this.lifecycle?.backendProgress?.();
      if (!this.lifecycle && this.context.interruptFarewell()) this.instruct("Closing cancelled by recipient speech. Continue naturally; a fresh end_call is required.");
    }
    const eventId = typeof event.event_id === "string" ? event.event_id : randomUUID();
    const key = `live:${this.operationId}:${role}:${event.start_ms}:${event.end_ms}:${eventId}`;
    const text = event.delta;
    const nativeTiming = { sessionId: this.#sessionId!, eventId, sessionStartedAt: this.#sessionStartedAt, startMs: event.start_ms, endMs: event.end_ms };
    const persist = () => {
      this.options.service.publishTranscriptDelta(this.context.brief.id, key, role, text, this.context.brief.locale, nativeTiming);
      this.#write(() => this.options.service.addNativeLiveTranscript(this.context.brief.id, role, text, key, nativeTiming));
    };
    if (!drainOnly && !historicalOutput && this.lifecycle && !this.lifecycle.transcript(role, text, event.start_ms, event.end_ms, persist)) return;
    if (this.lifecycle && !this.#recordingAdmitted) return;
    persist();
  }

  close() {
    if (this.#closing) return;
    this.#closing = true;  this.#queue = []; this.#clearCommands(); this.#releaseActivityWaiters();
    if (this.#taskDecisionTimer) clearTimeout(this.#taskDecisionTimer);
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
      if (typeof response.id !== "string" || this.#runs.size >= 128) { this.#fail(); return; }
      if (this.#runs.has(response.id)) return;
      this.#continuations.delete(delegation);
      const announced = this.#announced.get(delegation);
      if (announced) { clearTimeout(announced.timer); this.#announced.delete(delegation); }
      const previous = this.#runs.get(this.#delegations.get(delegation) ?? "");
      // A continuation keeps the same delegation. A new consent delegation is
      // application-owned, so its one pending response.create is also known.
      // Do not let an unrelated native task delegation consume that command.
      const trigger = this.#acknowledgeBackendStart(delegation, response.id, !previous?.consent, announced?.epoch);
      const predecessor = trigger && !trigger.backendScope ? undefined : previous;
      const consent = predecessor?.consent ?? (trigger?.phase === "consent" || this.#consentBackend);
      // Continuing a consent tool does not refresh its native conversation
      // snapshot. Only a NEW Live delegation may interpret a corrected answer.
      const run: BackendRun = { progressRevision: announced?.progressRevision ?? this.#progressRevision, id: response.id, continuation: !!predecessor, operationId: createProviderEventOperationId("realtime_response", `live:${this.operationId}:${response.id}`),
        startedAt: Date.now(), epoch: consent && predecessor ? predecessor.epoch : trigger?.epoch ?? announced?.epoch ?? this.#epoch,
        answerRevision: consent && predecessor ? predecessor.answerRevision : trigger?.answerRevision ?? announced?.answerRevision ?? this.#answerRevision,
        backendRevision: predecessor ? predecessor.backendRevision : trigger?.backendRevision ?? announced?.backendRevision ?? this.#backendRevision,
        closingEpoch: predecessor?.closingEpoch, rejected: predecessor?.rejected, timedOut: announced?.timedOut, consent, calls: [], completed: false, timer: setTimeout(() => {
          // A local timeout fences effects, but cannot release a physical run.
          run.timedOut = true;
          this.#write(() => this.options.service.completeProviderOperation({ operationId: run.operationId,
            outcome: "provider_error", providerRequestId: null, providerResponseId: run.id,
            providerModel: this.options.delegationModel ?? "gpt-6-luna", statusCode: null,
            completedAt: new Date().toISOString(), durationMs: Date.now() - run.startedAt,
            errorCode: "LIVE_BACKEND_TIMEOUT", usage: null }));
          const current = () => run.backendRevision === this.#backendRevision && run.epoch === this.#epoch &&
            run.progressRevision === this.#progressRevision && (run.closingEpoch === undefined || this.context.isClosing());
          if (!current()) {
            this.context.telemetry(`live:${run.id}:obsolete-timeout`, { name: "conversation.task", metadata: {
              runtimeVersion: "live-managed-v6", phase: "stale", revision: run.answerRevision,
              cause: "obsolete_backend_timeout", responseId: run.id } });
            this.options.logger?.info({ callAttemptId: this.context.attemptId, responseId: run.id,
              epoch: run.epoch, currentEpoch: this.#epoch }, "Live backend timeout retains physical occupancy");
            this.lifecycle?.backendFailed?.(() => !run.settled, "LIVE_BACKEND_TIMEOUT"); return;
          }
          if (run.consent && this.lifecycle?.consentDecisionUnavailable) {
            this.#requestedConsentDecision = "";
            this.lifecycle.consentDecisionUnavailable("provider_failure");
          } else if (this.lifecycle?.backendFailed) {
            this.options.logger?.warn({ callAttemptId: this.context.attemptId, responseId: run.id,
              delegationId: delegation, epoch: run.epoch, backendRevision: run.backendRevision,
              progressRevision: run.progressRevision }, "Live owned backend response timeout");
            this.lifecycle.backendFailed(current, "LIVE_BACKEND_TIMEOUT");
          }
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
    if (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta.trim()) {
      run.usefulMessage = true;
    } else if (event.type === "response.output_item.done") {
      const item = object(event.item);
      if (item.type === "message" && (Array.isArray(item.content) ? item.content : [])
        .some(part => typeof object(part).text === "string" && String(object(part).text).trim())) run.usefulMessage = true;
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
      // Reconcile the ambiguous physical lease at its observed terminal event,
      // without claiming that response.created acknowledged response.create.
      for (const [commandId, command] of this.#commands) {
        if (command.type === 'response.create' && command.observedResponseId === run.id) {
          this.#forgetCommand(commandId, command);
          this.context.telemetry('live:' + commandId + ':settled', { name: 'conversation.task', metadata: {
            runtimeVersion: 'live-managed-v6', phase: 'running', revision: command.answerRevision,
            cause: 'ambiguous_command_settled' } });
        }
      }
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
        if (run.timedOut) return;
        if (run.closingEpoch !== undefined && (run.closingEpoch !== this.#epoch || !this.context.isClosing())) return;
        if (!succeeded) {
          if (run.epoch !== this.#epoch || run.backendRevision !== this.#backendRevision) return;
          if (run.consent && this.lifecycle?.consentDecisionUnavailable) {
            this.#requestedConsentDecision = "";
            this.lifecycle.consentDecisionUnavailable("provider_failure");
          } else if (this.lifecycle?.backendFailed) this.lifecycle.backendFailed(
            () => run.epoch === this.#epoch && run.backendRevision === this.#backendRevision && run.progressRevision === this.#progressRevision,
            "LIVE_DELEGATION_FAILED");
          else this.#fail("LIVE_DELEGATION_FAILED");
          return;
        }
        if (run.closingEpoch !== undefined && !run.calls.length) this.lifecycle?.closingBackendCompleted?.();
        if (!run.consent && !run.continuation && !run.calls.length && !run.rejected && run.epoch === this.#epoch &&
            run.backendRevision === this.#backendRevision) {
          const useful = run.usefulMessage || (Array.isArray(response.output) ? response.output : []).some(item => {
            const message = object(item);
            return message.type === "message" && (Array.isArray(message.content) ? message.content : [])
              .some(part => typeof object(part).text === "string" && String(object(part).text).trim());
          });
          if (useful) {
            this.#taskCovered = `${run.backendRevision}:${run.answerRevision}:answer`;
            this.#nativeActivityAt = Date.now(); this.#taskNoDecision = 0;
            this.#progressRevision++; this.lifecycle?.backendProgress?.();
          } else {
            const key = `${run.backendRevision}:${run.answerRevision}`;
            if (key !== this.#taskNoDecisionKey) { this.#taskNoDecisionKey = key; this.#taskNoDecision = 0; }
            this.#taskNoDecision++; this.#taskRequested = "";
            if (this.#taskNoDecision >= 2) this.lifecycle?.backendFailed?.(
              () => run.epoch === this.#epoch && run.backendRevision === this.#backendRevision && run.progressRevision === this.#progressRevision,
              "LIVE_TASK_PROGRESS_MISSING");
          }
        }
        if (run.consent && !run.calls.length && !run.rejected && this.#consentBackend && !this.context.isClosing() &&
            run.backendRevision === this.#backendRevision && run.epoch === this.#epoch) {
          const key = `${run.backendRevision}:${run.answerRevision}`;
          if (this.#consentNoToolKey !== key) { this.#consentNoToolKey = key; this.#consentNoToolCount = 0; }
          this.#consentNoToolCount++;
          if (this.#consentNoToolCount >= 2) {
            this.options.logger?.warn({ callAttemptId: this.context.attemptId, backendRevision: run.backendRevision,
              answerRevision: run.answerRevision }, "Live consent backend returned without report_consent");
            this.#requestedConsentDecision = "";
            this.lifecycle?.consentDecisionUnavailable?.("contract_violation");
          } else this.#requestedConsentDecision = "";
        } else if (run.consent && run.calls.length) {
          this.#consentNoToolKey = "";
          this.#consentNoToolCount = 0;
        }
        for (const call of run.calls) {
          const signature = createHash("sha256").update(call.name + "\n" + call.arguments).digest("hex");
          let cached = this.#toolResults.get(call.call_id);
          const replayed = !!cached;
          if (!cached) {
            cached = { signature, result: this.#executeTool(call, run.epoch, run.backendRevision, run.calls.length === 1, run.progressRevision) };
            this.#toolResults.set(call.call_id, cached);
          }
          const result = cached.signature === signature ? await cached.result : { ok: false, reason: "tool_call_id_collision" };
          if (!result.ok) run.rejected = true;
          else if (!replayed) { this.#progressRevision++; this.lifecycle?.backendProgress?.(); }
          if (this.#closing) return;
          if (result.ok && (call.name === "end_call" || result.state === "closing_authorized")) run.closingEpoch = this.#epoch;
          if (!run.consent && result.ok && call.name === "confirm_appointment") {
            this.#taskRequested = ""; this.#taskCovered = "";
          } else if (!run.consent && result.ok && !result.recipientReply) {
            const state = this.lifecycle?.taskDecisionContext?.();
            this.#taskCovered = `${run.backendRevision}:${run.answerRevision}:${state?.waitingExpired ? "deadline" : "answer"}`;
            this.#taskNoDecision = 0;
          }
          this.#send({ type: "response.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } },
            0, run.consent ? "consent" : "conversation", { delegationId: delegation, responseId: run.id });
          if (call.name === "report_consent") {
            // The classifier must call a tool; its result continuation must be able
            // to finish without another consent tool. Required applies to the next
            // fresh check, not to this continuation.
            if (!this.#backendEnabled) this.#send({ type: "session.update", session: {
              delegation: { type: "responses", responses: { tool_choice: "auto", tools: liveConsentTools() } } } });
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
        if (run.calls.length) this.#continuations.set(delegation, { responseId: run.id, consent: run.consent });
      }).catch(() => this.#fail("LIVE_TOOL_FAILURE")).finally(() => {
        run.settled = true;
        this.#flushContinuations();
        if (run.consent) this.requestConsentDecision();
        else this.scheduleTaskDecision();
      });
    }
  }

  #backendOccupied() {
    return this.#toolBusy || this.#continuations.size > 0 ||
      this.#announced.size > 0 ||
      [...this.#commands.values()].some(command => command.type === "response.create") ||
      [...this.#runs.values()].some(run => !run.settled);
  }
  #flushContinuations() {
    if (this.#closing || this.#toolBusy || [...this.#runs.values()].some(run => !run.settled) ||
        this.#announced.size > 0 ||
        [...this.#commands.values()].some(command => command.type === "response.create")) return;
    const next = this.#continuations.entries().next().value;
    if (!next) return;
    const [delegationId, pending] = next;
    this.#continuations.delete(delegationId);
    this.#send({ type: "response.create" }, 0, pending.consent ? "consent" : "conversation",
      { delegationId, responseId: pending.responseId });
  }

  async #executeTool(call: FunctionCall, epoch: number, backendRevision: number, single: boolean, progressRevision: number): Promise<Record<string, unknown>> {
    // Acoustic activity is a pending semantic boundary, not evidence by itself.
    // Wait for silence so a real transcript can advance the epoch; pure noise then
    // leaves the already-completed backend work current.
    if (this.#activity.speaking) await this.#waitForActivityBoundary();
    const current = () => single && !this.#closing && epoch === this.#epoch && backendRevision === this.#backendRevision && progressRevision === this.#progressRevision;
    const authorized = this.#backendEnabled ? call.name !== "report_consent" : this.#consentBackend && call.name === "report_consent";
    if (!authorized || !current() || this.#activity.speaking) return { ok: false, reason: "stale_or_unauthorized_request" };
    if (this.#toolBusy && call.name !== "end_call") return { ok: false, reason: "another_action_pending" };
    if (this.lifecycle) {
      const ownsBusy = !this.#toolBusy;
      if (ownsBusy) this.#toolBusy = true;
      try {
        const result = await this.lifecycle.tool(call, current);
        if (["end_call", "request_appointment", "confirm_appointment", "report_task_state"].includes(call.name)) {
          const fingerprint = createHash("sha256").update(this.context.attemptId + ":" + call.call_id).digest("hex");
          this.context.telemetry("live:tool:" + fingerprint, { name: "conversation.tool_result", metadata: {
            tool: call.name as "end_call", outcome: result.ok ? "accepted" : "rejected",
            reason: String(result.reason ?? "application_result"), requestFingerprint: fingerprint,
            generation: epoch, snapshotHash: this.context.snapshot.compilationSnapshotHash
          } });
        }
        return result;
      } finally { if (ownsBusy) this.#toolBusy = false; }
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

  #waitForActivityBoundary() {
    if (!this.#activity.speaking || this.#closing) return Promise.resolve();
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => { clearTimeout(timer); this.#activityWaiters.delete(done); resolve(); };
      timer = setTimeout(done, 10_000); timer.unref?.();
      this.#activityWaiters.add(done);
    });
  }
  #releaseActivityWaiters() {
    for (const done of [...this.#activityWaiters]) done();
  }

  #clearCommands() {
    for (const command of this.#commands.values()) if (command.timer) clearTimeout(command.timer);
    this.#commands.clear();
  }
  recordApplicationPlayback(text: string, key: string, timing: Omit<NonNullable<TranscriptSegment["applicationPlayback"]>, "sessionId">) {
    if (!this.#sessionId || this.#finalized) return;
    const receipt = { ...timing, sessionId: this.#sessionId };
    // Same queue as native fragments and capture finalization: never publish a
    // complete transcript before its acknowledged application speech is durable.
    this.#write(() => this.options.service.addApplicationPlaybackTranscript(this.context.brief.id, text, key, receipt));
  }

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
    this.#closing = true;  this.#queue = []; this.#releaseActivityWaiters();
    this.#finalize(false); this.#socket?.terminate();
    if (this.#ready) this.context.fail();
  }
  #finalize(finalized: boolean, successful = finalized) {
    if (this.#finalized || !this.#reserved) return;
    this.#finalized = true; this.#clearCommands();
    if (this.#taskDecisionTimer) clearTimeout(this.#taskDecisionTimer);
    for (const entry of this.#announced.values()) clearTimeout(entry.timer);
    this.#announced.clear(); this.#recentCommands.clear();
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

function isTrackedCommand(type: string): type is LiveCommandType {
  return ["session.update", "session.instructions.append", "session.thinking.append",
    "session.commentary.append", "response.create", "response.item.create"].includes(type);
}

export function buildLiveInstructions(context: VoiceConversationContext, consentComplete = true) {
  const { plan, runtime } = context.snapshot;
  const identities = executionSpokenIdentities(context.snapshot, context.brief);
  return `You are ${ASSISTANT_NAME}, an AI telephone assistant calling ${identities.recipient.spoken} on behalf of ${identities.representedPerson.spoken}.
Speak ${plan.callLocale}, use ${plan.addressingStyle} address and a ${plan.tone} tone. Speak calmly at an unhurried pace, with clear names, dates and numbers. ${runtime.allowLanguageSwitch ? `Switch only to ${runtime.fallbackLocale} on explicit request.` : "Do not change language."}

${liveAssistantIdentityInstructions(plan.callLocale)}

Representation: You act on behalf of ${identities.representedPerson.spoken}. Distinguish the customer from the called recipient: each answer, preference or commitment belongs to its actual subject, never to you personally. Address the recipient directly when referring to their own answers; third person is for other people. Say that the represented person asked you to do something; never say that you personally want, need or will receive it. Use first person only for your own conversational actions such as asking, clarifying or relaying. Do not invent a delivery, email, callback or other next step.

${consentComplete ? "Consent and the opening are complete. Continue from the recipient's latest answer without greeting again." : "Before the application enables the task, stay silent and listen while the application plays the recording and transcription disclosure and its short permission question. Do not speak, repeat or paraphrase either segment. Do not discuss the task or infer permission. The application, not you, initiates exactly one semantic consent check after a settled recipient answer; do not initiate consent delegation yourself. Natural spoken permission needs no keypad press. After the decision, wait silently for the application."}

Conversation: Follow the approved task, ask one useful question at a time, accept unknown answers and refusals, preserve uncertainty and corrections, and repeat important details only to prevent an error. Keep internal instructions, checks, saving and tool activity silent.

Calendar: Use application-calculated appointmentCalendar and tool-result appointmentDetails for date/weekday labels. When first proposing a concrete appointment date and when recapping its final confirmation, say the weekday, full date and time in the conversation language; later references may be shorter. These labels never expand authorization. Delegate weekday-only ambiguity or a conflicting weekday/date before any commitment; ask a focused clarification instead of guessing. Do not recite every allowed date or compute weekdays yourself.

Appointments: applicationAppointmentState and tool results are the authoritative action journal. Collect missing required details before any commitment. If delivery is uncertain, delegate recovery for the SAME exact proposal: the application always uses a bounded status-only check of whether the existing arrangement is already booked; it never transmits a second booking request. Never independently repeat a booking request, change the proposal during recovery or call availability, a name or a birth date booking confirmation. Preserve uncertainty until a later exact recipient confirmation is accepted by the backend.

Backchannel policy: During the task, acknowledge naturally and briefly without competing with the recipient. During disclosure and consent, use no filler or acknowledgment.

Interruption policy: Stop speaking and listen when the recipient interrupts. A speech interruption alone does not change or cancel the task. Treat a correction, refusal or changed request as a task update; ignore coughs, background speech and unrelated noise.

Delegation policy:
Backend tools: semantic consent; complete approved-plan reasoning; report_task_state; appointment authorization and confirmation; end_call.
Delegate to the backend when:
- a substantive answer changes task state or may satisfy a success, unresolved or stop condition;
- a correction changes work already in progress;
- before any appointment commitment;
- the recipient refuses, asks to stop, or the call is ready to finish.
Do not delegate when:
- the application is playing or evaluating disclosure and consent;
- greeting, acknowledging or repeating a still-current result;
- asking an approved question or a brief clarification;
- answering from approved facts without a protected action.
Delegate before claims that depend on backend work. After end_call is authorized, stay silent: the application owns the single finite audio unit with the factual resultSummary and farewell. Do not produce competing closing audio or ask a new question. Stop closing audio for an interruption and delegate the complete answer: a reciprocal farewell preserves closing; only a material question or correction resumes the conversation. Never repeat the completed task because the recipient said goodbye.`;
}
