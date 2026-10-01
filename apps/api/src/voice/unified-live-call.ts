// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Ivan Slavinskyi. All rights reserved.
import { executionSpokenIdentities } from "./spoken-execution";
import { liveRuntimeDescriptor } from "./runtime-descriptor";
import { projectSpokenIdentityText } from "@callassist/contracts";
import WebSocket, { type RawData } from "ws";
import { randomUUID } from "node:crypto";
import { LIVE_VOICES, type AnsweringState, type CallLocale, type ConsentEvidence } from "@callassist/contracts";
import { getTwilioCopy } from "../telephony/twilio-copy";
import { ConsentFlow, type ConsentFlowAction } from "../realtime/consent-flow";
import { endCallReasons, type EndCallReason } from "../realtime/agent-hangup";
import { getAppointmentAuthorization } from "@callassist/contracts";
import type { VoiceConversationContext } from "./voice-runtime";
import { buildLiveInstructions, OpenAILiveConversation, type LiveLifecycle, type OpenAILiveBridgeOptions } from "./openai-live-bridge";
import { object } from "./live-usage";
import { pcmuHasSpeech } from "./pcmu-activity";
import { parseAppointmentProposal, validateAppointmentProposal } from "../realtime/appointment-authorization";
import type { VoiceActionRecord } from "../storage/voice-action";
import { liveTaskFailureCopy, liveFarewellCopy } from "./live-failure-copy";
import { renderSpeech, type RenderedSpeech } from "./rendered-speech";
import { appointmentRequestCopy, appointmentStatusCopy } from "./live-appointment-copy";
import { resolveInitialDisclosure, calendarDateDetails } from "@callassist/contracts";

type Phase = "starting" | "disclosure" | "consent" | "recording" | "opening" | "conversation" | "closing" | "ending" | "closed";
/** Owns Twilio admission, privacy/consent and playback. Live owns no application state. */
export class UnifiedLiveCall implements LiveLifecycle {
  #phase: Phase = "starting";
  #started = false;
  #admitted = false;
  #ready = false;
  #preparing: Promise<void> | null = null;
  #warmSilence: ReturnType<typeof setInterval> | null = null;
  #stream = "";
  #provider = "";
  #context: VoiceConversationContext | null = null;
  #live: OpenAILiveConversation | null = null;
  #speechFailure: { code: string; phase: Phase } | null = null;
  #consent = new ConsentFlow();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #consentPlayback: Promise<boolean> = Promise.resolve(false);
  #resolveConsentPlayback: ((played: boolean) => void) | null = null;
  #renderedSpeech = new Map<string, Promise<RenderedSpeech>>();
  #renderedPlayback: { mark: string; text: string; generation: number; timer: ReturnType<typeof setTimeout>;
    interrupted: boolean; segment: "required" | "question"; sentAt: string; durationMs: number } | null = null;
  #requiredDisclosureText: string | null = null;
  #pendingConsentQuestion: string | null = null;
  #requiredPlaybackEndsAt = 0;
  #disclosureInterrupted = false;
  #disclosureAttempts = 0;
  #consentOverallTimer: ReturnType<typeof setTimeout> | null = null;
  #answerObserved = false;
  #consentInfrastructureFailures = 0;
  #consentDeadlineAt = 0;
  #speaking = false;
  #playbackUntil = 0;
  #clippedTaskSpeech = false;
  #transcriptIssues: import("@callassist/contracts").TranscriptQualityIssue[] = [];
  #consented = false;
  #consentFailed = false;
  #answeringPoll: ReturnType<typeof setInterval> | null = null;
  #answeringDeadline: ReturnType<typeof setTimeout> | null = null;
  #unsubscribeAnswering: (() => void) | null = null;
  #checkingAnswering = false;
  #answeringHandoff = false;
  #recipientTurns: Array<{ id: string; text: string }> = [];
  #turnSequence = 0;
  #recipientTurnText = "";
  #recipientFragments: Array<{ text: string; start: number; end: number }> = [];
  #recipientTurnTimer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #terminalDecision: { revision: number; reason: EndCallReason; summary: string; evidence: string[]; actionState: VoiceActionRecord["state"] | null } | null = null;
  #terminalRevision = 0;
  #closingAttempts = 0;
  #appointmentRejectedTurn: number | null = null;
  #conversationStartedAt = 0;
  #firstConversationAudio = false;
  #lastOutputAudioAt = 0;
  #backendFailurePending = false;
  #backendFailureDeadlineAt = 0;
  #backendFailureTimer: ReturnType<typeof setTimeout> | null = null;
  #backendFailureCurrent: (() => boolean) | null = null;
  #backendFailureCode = "LIVE_BACKEND_FAILURE";
  #closingReason: EndCallReason = "recipient_requested_end";
  #action: VoiceActionRecord | null = null;
  #actionDeliveredAfterTurn = 0;
  #criticalResolve: ((played: boolean) => void) | null = null;
  #criticalReleased = false;
  #applicationPlayback: { mark: string; text: string; generation: number; current: () => boolean;
    resolve: (played: boolean) => void; timer: ReturnType<typeof setTimeout>; released: boolean; sentAt: string; durationMs: number } | null = null;
  #appointmentReply: { afterTurn: number; resolve: (turn: { id: string; text: string } | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  #taskWaitTimer: ReturnType<typeof setTimeout> | null = null;
  #taskWaitTurn = -1;
  #waitingExpired = false;
  #closingInputPending = false;
  #closingDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: OpenAILiveBridgeOptions, private twilio?: WebSocket) {}
  get closed() { return this.#isClosed(); }
  dispose() { this.#close("socket_closed"); }
  prepare(binding: { callBriefId: string; callAttemptId: string; providerCallId: string; compilationSnapshotHash: string }) {
    this.#preparing = (async () => {
      const snapshot = await this.options.service.get(binding.callBriefId);
      const attempt = await this.options.service.getLatestAttempt(binding.callBriefId);
      if (this.closed) return;
      if (!snapshot?.compilation || !attempt?.executionSnapshot || attempt.id !== binding.callAttemptId ||
          attempt.providerCallId !== binding.providerCallId || attempt.provider !== "twilio" ||
          attempt.compilationSnapshotHash !== binding.compilationSnapshotHash ||
          snapshot.compilation.snapshotHash !== binding.compilationSnapshotHash ||
          !["dialing", "in_progress"].includes(attempt.status)) { this.dispose(); return; }
      if (snapshot.brief.lifecycle?.answering?.streamAdmitted ||
          (snapshot.brief.lifecycle?.answering?.decision && snapshot.brief.lifecycle.answering.decision !== "consent")) { this.dispose(); return; }
      await this.#initialize(snapshot, attempt);
      if (this.closed) return;
      const disclosure = resolveInitialDisclosure(this.#context!.snapshot, this.#context!.brief.representedPerson).text;
      await Promise.all([this.#live!.start(), this.#render(disclosure)]);
      if (this.closed || this.#admitted) return;
      // No recipient audio or task context is sent while waiting for admission.
      this.#warmSilence = setInterval(() => this.#live?.inputAudio(Buffer.alloc(160, 255).toString("base64")), 20);
      this.#warmSilence.unref?.();
    })().catch(() => this.dispose());
    return this.#preparing;
  }
  attach(socket = this.twilio!, initial?: RawData) {
    this.twilio = socket;
    this.twilio.on("message", data => {
      void this.#message(data).catch(() => this.#close("openai_error"));
    });
    this.twilio.on("close", () => this.#close("socket_closed"));
    this.twilio.on("error", () => this.#close("socket_closed"));
    if (initial) void this.#message(initial).catch(() => this.#close("openai_error"));
  }
  async #message(data: RawData) {
    if (this.#phase === "closed") return;
    let event: Record<string, unknown>;
    try { event = object(JSON.parse(data.toString())); } catch { this.#close("socket_closed"); return; }
    if (event.event === "start") {
      if (this.#started) return;
      this.#started = true;
      await this.#admit(object(event.start), event.streamSid);
    } else if (event.event === "media") {
      const payload = object(event.media).payload;
      // Live listens continuously. Application-owned playback never delays or
      // batches the recipient's side of the full-duplex conversation.
      if (this.#admitted && typeof payload === "string") this.#live?.inputAudio(payload);
    } else if (event.event === "mark") {
      const name = object(event.mark).name;
      if (typeof name === "string") {
        if (!this.#acknowledgeApplicationPlayback(name)) this.#acknowledgeRendered(name);
      }
    } else if (event.event === "dtmf") {
      const digit = object(event.dtmf).digit;
      if (this.#phase === "consent") {
        if (digit === "1" && this.#consent.acceptDtmfOne()) await this.#grant({ method: "dtmf", digit: "1", locale: this.#context!.snapshot.plan.callLocale });
        else if (digit === "2") this.#consentAction("reject", "negative");
      } else if (this.#phase === "conversation" && typeof digit === "string") this.#live?.keypad(digit);
    } else if (event.event === "stop") this.#close("stream_stopped");
  }
  async #admit(start: Record<string, unknown>, streamSid: unknown) {
    await this.#preparing;
    if (this.closed) { this.twilio?.close(); return; }
    const p = object(start.customParameters);
    const binding = { callBriefId: p.callBriefId, callAttemptId: p.callAttemptId, compilationSnapshotHash: p.compilationSnapshotHash };
    if (typeof binding.callBriefId !== "string" || typeof binding.callAttemptId !== "string" || typeof binding.compilationSnapshotHash !== "string" ||
      typeof p.streamToken !== "string" || typeof start.callSid !== "string" || typeof (start.streamSid ?? streamSid) !== "string" ||
      !this.options.validateStreamToken(binding as { callBriefId: string; callAttemptId: string; compilationSnapshotHash: string }, p.streamToken)) {
      this.#close("socket_closed"); return;
    }
    const snapshot = await this.options.service.get(binding.callBriefId);
    const attempt = await this.options.service.getLatestAttempt(binding.callBriefId);
    if (this.#phase === "closed") return;
    const execution = attempt?.executionSnapshot;
    if (!snapshot || !attempt || !execution || !snapshot.compilation || snapshot.compilation.snapshotHash !== execution.compilationSnapshotHash ||
      attempt.provider !== "twilio" || attempt.providerCallId !== start.callSid ||
      !["dialing", "in_progress", "awaiting_approval"].includes(attempt.status) || attempt.id !== binding.callAttemptId ||
      execution.callBriefId !== binding.callBriefId || attempt.compilationRevision !== execution.compilationRevision ||
      attempt.compilationSnapshotHash !== binding.compilationSnapshotHash || execution.compilationSnapshotHash !== binding.compilationSnapshotHash) {
      this.#close("socket_closed"); return;
    }
    if (execution.version === 3) {
      const admitted = await this.options.service.transitionAnswering(binding.callBriefId, { attemptId: attempt.id, providerCallId: start.callSid,
        snapshotHash: binding.compilationSnapshotHash, kind: "admit", now: new Date().toISOString() });
      if (this.#isClosed() || !admitted.applied || admitted.decision !== "consent") { this.#close("socket_closed"); return; }
    }
    if (this.#context && (this.#context.attemptId !== attempt.id || this.#context.snapshot.compilationSnapshotHash !== binding.compilationSnapshotHash)) {
      this.dispose(); return;
    }
    this.#stream = String(start.streamSid ?? streamSid);
    this.#provider = start.callSid;
    this.#admitted = true;
    if (this.#warmSilence) clearInterval(this.#warmSilence);
    this.#warmSilence = null;
    if (!this.#live) await this.#initialize(snapshot, attempt);
    if (this.closed) return;
    if (snapshot.brief.lifecycle?.answering?.execution === "async") {
      this.#unsubscribeAnswering = this.options.service.subscribe(binding.callBriefId, () => { void this.#checkAnswering(); });
      // Poll as a recovery path when gateway and callbacks use different processes,
      // or a database notification is lost. The durable result remains authoritative.
      this.#answeringPoll = setInterval(() => { void this.#checkAnswering(); }, 1_000);
      this.#answeringPoll.unref?.();
      this.#answeringDeadline = setTimeout(() => {
        void this.options.service.transitionAnswering(binding.callBriefId as string, { attemptId: attempt.id,
          providerCallId: this.#provider, snapshotHash: execution.compilationSnapshotHash,
          kind: "timeout", now: new Date().toISOString() }).then(() => this.#checkAnswering(), () => this.#close("openai_error"));
      }, 35_000);
      this.#answeringDeadline.unref?.();
      await this.#checkAnswering();
      if (this.#answeringHandoff || this.closed) return;
    }
    if (!this.#ready) await this.#live!.start();
    else this.#disclosure();
  }

  #stopAnsweringWatch() {
    if (this.#answeringPoll) clearInterval(this.#answeringPoll);
    if (this.#answeringDeadline) clearTimeout(this.#answeringDeadline);
    this.#answeringPoll = null; this.#answeringDeadline = null;
    this.#unsubscribeAnswering?.(); this.#unsubscribeAnswering = null;
  }
  async #checkAnswering() {
    if (this.#checkingAnswering || this.closed || this.#answeringHandoff || !this.#context || this.#recordingAccepted()) return;
    this.#checkingAnswering = true;
    try {
      const snapshot = await this.options.service.get(this.#context.brief.id);
      const attempt = await this.options.service.getLatestAttempt(this.#context.brief.id);
      if (this.closed || this.#recordingAccepted()) return;
      if (!snapshot || attempt?.id !== this.#context.attemptId || !["dialing", "in_progress"].includes(attempt.status) || snapshot.brief.lifecycle?.stopRequestedBy) {
        this.#close("socket_closed"); return;
      }
      const state: AnsweringState | undefined = snapshot.brief.lifecycle?.answering;
      if (!state || state.phase === "pending") return;
      this.#stopAnsweringWatch();
      if (state.decision === "consent") return;
      // Keep the Twilio socket open until the provider replaces Connect/Stream.
      // Closing it first executes the trailing Hangup and loses the voicemail.
      this.#answeringHandoff = true; this.#phase = "ending"; this.#consentFailed = true;
      this.#generation++; this.#clearTimer();

      this.#resolveConsentPlayback?.(false); this.#resolveConsentPlayback = null;
      this.#clear();
      await this.options.service.dispatchAsyncAnswering(this.#context.brief.id, {
        attemptId: this.#context.attemptId, providerCallId: this.#provider,
        snapshotHash: this.#context.snapshot.compilationSnapshotHash, now: new Date().toISOString()
      });
      if (!this.closed) this.#wait(20_000, () => this.#close("socket_closed"));
    } catch { this.#close("openai_error"); }
    finally { this.#checkingAnswering = false; }
  }
  async #initialize(snapshot: NonNullable<Awaited<ReturnType<OpenAILiveBridgeOptions["service"]["get"]>>>,
    attempt: NonNullable<Awaited<ReturnType<OpenAILiveBridgeOptions["service"]["getLatestAttempt"]>>>) {
    const approved = attempt.executionSnapshot!;
    const identities = executionSpokenIdentities(approved, snapshot.compilation!.rawBrief);
    const execution = { ...approved, runtime: { ...approved.runtime, spokenIdentities: identities,
      ...(approved.runtime.initialDisclosure ? { initialDisclosure: { ...approved.runtime.initialDisclosure,
        text: projectSpokenIdentityText(approved.runtime.initialDisclosure.text, identities) } } : {}) } };
    const context: VoiceConversationContext = {
      brief: { ...snapshot.brief, representedPerson: identities.representedPerson.spoken, recipientName: identities.recipient.spoken,
        voiceGender: execution.runtime.voiceGender, locale: execution.plan.callLocale }, snapshot: execution, attemptId: attempt.id,
      sendAudio: payload => this.#sendAudio(payload), clearPlayback: () => this.#clear(),
      requestFarewell: (_id, reason) => this.#requestClosing(reason),
      interruptFarewell: () => this.#interruptClosing(), isClosing: () => this.#phase === "closing" || this.#phase === "ending",
      telemetry: (key, payload) => { void this.options.service.recordTelemetry(snapshot.brief.id, {
        callAttemptId: attempt.id, idempotencyKey: key, payload
      }).catch(() => this.#close("openai_error")); },
      fail: () => this.#close("openai_error")
    };
    this.#context = context;
    await this.options.service.recordRuntimeDescriptor(snapshot.brief.id, attempt.id,
      liveRuntimeDescriptor(context, snapshot.compilation!, buildLiveInstructions(context, false), {
        live: this.options.liveModel ?? "gpt-live-1", delegation: this.options.delegationModel ?? "gpt-6-luna",
        speech: this.options.speechModel ?? "gpt-4o-mini-tts"
      }));
    if (this.closed) return;
    this.#live = new OpenAILiveConversation(this.options, context, this);
  }
  startup() {
    return { instructions: buildLiveInstructions(this.#context!, false),
      input: [] };
  }
  ready() { this.#ready = true; if (this.#admitted && this.#phase === "starting") this.#disclosure(); }
  get #locale() { return this.#context!.snapshot.plan.callLocale; }
  #disclosure() {
    if (!this.#consentOverallTimer) {
      this.#consentOverallTimer = setTimeout(() => {
        this.#speechFailure = { code: "LIVE_CONSENT_OVERALL_DEADLINE", phase: this.#phase };
        this.#close("openai_error");
      }, 60_000);
      this.#consentOverallTimer.unref?.();
    }
    if (++this.#disclosureAttempts > 3) {
      this.#speechFailure = { code: "LIVE_DISCLOSURE_REPLAY_LIMIT", phase: this.#phase };
      this.#close("openai_error"); return;
    }
    this.options.logger?.info({ callAttemptId: this.#context!.attemptId, attempt: this.#disclosureAttempts }, "Live disclosure playback requested");
    this.#resolveConsentPlayback?.(false);
    this.#consentPlayback = new Promise(resolve => { this.#resolveConsentPlayback = resolve; });
    this.#phase = "disclosure";
    this.#live!.suspendConsent();
    const text = resolveInitialDisclosure(this.#context!.snapshot, this.#context!.brief.representedPerson).text;
    this.#requiredDisclosureText = text;
    this.#pendingConsentQuestion = null;
    this.#requiredPlaybackEndsAt = 0;
    this.#disclosureInterrupted = this.#speaking;
    this.#answerObserved = false;
    this.#consentInfrastructureFailures = 0;
    this.#clearTimer();

    if (this.#renderedPlayback) { clearTimeout(this.#renderedPlayback.timer); this.#renderedPlayback = null; }
    this.#clear();
    const generation = ++this.#generation;
    void this.#render(text).then(rendered => {
      if (this.#isClosed() || this.#phase !== "disclosure" || generation !== this.#generation) return;
      // If the recipient is already talking, wait for the acoustic boundary and
      // replay only the mandatory segment instead of speaking over them.
      if (this.#speaking || this.#disclosureInterrupted) return;
      this.#playRenderedConsentSegment(text, rendered, generation, "required");
    }).catch(error => {
      if (this.#isClosed() || generation !== this.#generation) return;
      this.options.logger?.warn({ callBriefId: this.#context!.brief.id,
        code: error instanceof Error ? error.message : "SPEECH_RENDER_FAILED" }, "Disclosure rendering failed");
      this.#speechFailure = { code: "LIVE_DISCLOSURE_RENDER_FAILED", phase: "disclosure" };
      this.#close("openai_error");
    });
  }
  #playRenderedConsentSegment(text: string, rendered: RenderedSpeech, generation: number,
    segment: "required" | "question") {
    const expectedPhase = segment === "required" ? "disclosure" : "consent";
    if (this.#isClosed() || this.#phase !== expectedPhase || generation !== this.#generation) return;
    if (segment === "required") {
      // Enable semantic reasoning early, but fence transcript evidence at the
      // estimated end of the mandatory audio. The real Twilio mark still owns
      // authorization, so recording cannot start from an estimate or a timer.
      this.#live!.configureConsent(rendered.durationMs);
      this.#requiredPlaybackEndsAt = Date.now() + rendered.durationMs;
    } else this.#pendingConsentQuestion = null;
    for (const payload of rendered.frames) this.#sendAudio(payload);
    const mark = `rendered-consent-${segment}:${generation}`;
    const timer = setTimeout(() => {
      if (this.#renderedPlayback?.mark !== mark) return;
      this.#speechFailure = { code: "LIVE_DISCLOSURE_PLAYBACK_TIMEOUT", phase: this.#phase };
      this.#close("openai_error");
    }, Math.max(8_000, rendered.durationMs + 5_000));
    timer.unref?.();
    this.#renderedPlayback = { mark, text, generation, timer, interrupted: false, segment, sentAt:new Date().toISOString(),durationMs:rendered.durationMs };
    if (segment === "required")
      this.#context!.telemetry(`live:disclosure:${generation}`, { name: "disclosure.started", metadata: {} });
    this.#send({ event: "mark", streamSid: this.#stream, mark: { name: mark } });
  }
  #promptConsent(text: string) {
    this.#phase = "consent";
    this.#answerObserved = false;
    this.#consentInfrastructureFailures = 0;
    this.#pendingConsentQuestion = text;
    this.#live!.configureConsent();
    this.#clearTimer();
    if (this.#renderedPlayback) { clearTimeout(this.#renderedPlayback.timer); this.#renderedPlayback = null; }
    this.#clear();
    const generation = ++this.#generation;
    this.#consentDeadlineAt = Date.now() + 20_000;
    this.#wait(this.options.consentTimeoutMs ?? 12_000, () => this.#consentAction(this.#consent.timeout(), "timeout"));
    if (!this.#speaking) this.#playPendingConsentQuestion(generation);
  }
  #playPendingConsentQuestion(generation = this.#generation) {
    const text = this.#pendingConsentQuestion;
    if (!text || this.#speaking || this.#phase !== "consent" || generation !== this.#generation) return;
    void this.#render(text).then(rendered => {
      if (!this.#pendingConsentQuestion || this.#speaking) return;
      this.#playRenderedConsentSegment(text, rendered, generation, "question");
    }).catch(error => {
      if (this.#isClosed() || generation !== this.#generation) return;
      this.options.logger?.warn({ callBriefId: this.#context!.brief.id,
        code: error instanceof Error ? error.message : "SPEECH_RENDER_FAILED" }, "Consent question rendering failed");
      this.#speechFailure = { code: "LIVE_DISCLOSURE_RENDER_FAILED", phase: this.#phase };
      this.#close("openai_error");
    });
  }
  #render(text: string) {
    const existing = this.#renderedSpeech.get(text);
    if (existing) return existing;
    const voice = this.#context!.snapshot.runtime.liveVoice ?? LIVE_VOICES[this.#context!.snapshot.runtime.voiceGender];
    const model = this.options.speechModel?.trim() || "gpt-4o-mini-tts";
    const operationId = randomUUID(), started = Date.now();
    const stage = text === resolveInitialDisclosure(this.#context!.snapshot, this.#context!.brief.representedPerson).text
      ? "live_disclosure_synthesis" : "live_application_synthesis";
    const rendering = (async () => {
      // Journal the paid request before crossing the provider boundary. A crash
      // now leaves an explicit unknown operation instead of invisible spending.
      await this.#recordRenderedSpeech(operationId, model, started, stage, null);
      let rendered: RenderedSpeech;
      try {
        if (this.closed) throw new Error("SPEECH_RENDER_CANCELLED");
        rendered = await renderSpeech({ apiKey: this.options.apiKey, text, locale: this.#locale, voice,
          model, speechFetch: this.options.speechFetch });
      } catch (error) {
        await this.#recordRenderedSpeech(operationId, model, started, stage, {
          outcome: speechRenderOutcome(error), providerRequestId: null, providerResponseId: null,
          providerModel: model, statusCode: speechRenderStatus(error), completedAt: new Date().toISOString(),
          durationMs: Date.now() - started, errorCode: speechRenderCode(error), usage: null
        });
        throw error;
      }
      await this.#recordRenderedSpeech(operationId, model, started, stage, {
        outcome: "succeeded", providerRequestId: rendered.providerRequestId,
        providerResponseId: rendered.providerRequestId, providerModel: rendered.model,
        statusCode: 200, completedAt: new Date().toISOString(), durationMs: Date.now() - started,
        errorCode: null, usage: {
          requestCount: 1, inputTextTokens: null, cachedInputTextTokens: null,
          cacheWriteInputTextTokens: null, outputTextTokens: null, reasoningOutputTokens: null,
          inputAudioTokens: null, cachedInputAudioTokens: null, outputAudioTokens: null,
          totalTokens: null, durationSeconds: rendered.durationMs / 1_000, billableSeconds: null,
          rawUsage: { source: "speech_api", outputFormat: "pcm", durationEstimatedFromPcm: true }
        }
      });
      return rendered;
    })();
    this.#renderedSpeech.set(text, rendering);
    void rendering.catch(() => this.#renderedSpeech.delete(text));
    return rendering;
  }
  async #recordRenderedSpeech(operationId: string, model: string, started: number,
    stage: string,
    result: Parameters<OpenAILiveBridgeOptions["service"]["recordRealtimeProviderOperation"]>[0]["result"]) {
    await this.#live!.whenReserved();
    await this.options.service.recordRealtimeProviderOperation({
      id: operationId, parentOperationId: this.#live!.operationId, callBriefId: this.#context!.brief.id,
      callAttemptId: this.#context!.attemptId, provider: "openai", operationType: "realtime_response",
      stage, requestedModel: model, clientRequestId: operationId,
      startedAt: new Date(started).toISOString(), result
    });
  }
  #acknowledgeRendered(name: string) {
    const playback = this.#renderedPlayback;
    const expectedPhase = playback?.segment === "required" ? "disclosure" : "consent";
    if (!playback || playback.mark !== name || this.#phase !== expectedPhase || playback.generation !== this.#generation) return false;
    if (playback.interrupted || (playback.segment === "required" && this.#disclosureInterrupted)) {
      clearTimeout(playback.timer); this.#renderedPlayback = null; return true;
    }
    clearTimeout(playback.timer); this.#renderedPlayback = null;
    const key = `rendered-consent-${playback.segment}:${this.#context!.attemptId}:${playback.generation}`;
    this.#live!.recordApplicationPlayback(playback.text,key,{markId:name,sentAt:playback.sentAt,durationMs:playback.durationMs,acknowledgedAt:new Date().toISOString()});
    if (playback.segment === "required") {
      this.#requiredDisclosureText = null;
      this.#requiredPlaybackEndsAt = 0;
      this.#phase = "consent";
      this.#live!.confirmConsentDisclosurePlayback();
      this.#resolveConsentPlayback?.(true); this.#resolveConsentPlayback = null;
      this.#consentDeadlineAt = Date.now() + 20_000;
      this.#wait(this.options.consentTimeoutMs ?? 12_000, () => this.#consentAction(this.#consent.timeout(), "timeout"));
      if (!this.#speaking && !this.#answerObserved) this.#playPendingConsentQuestion(playback.generation);
    }
    this.#settleRecipientTurn();
    return true;
  }
  #say(text: string, played: () => void, protectedSpeech?: { current: () => boolean; buffered: boolean }, limits?: { deadlineMs: number; exactOnly: boolean }) {
    void this.#playApplicationText(text, protectedSpeech?.current ?? (() => !this.#isClosed()), limits?.deadlineMs)
      .then(completed => { if (completed) played(); });
  }
  #cancelApplicationPlayback() {
    const playback = this.#applicationPlayback;
    if (!playback) return;
    clearTimeout(playback.timer); this.#applicationPlayback = null;
    // A released clip without its matching mark may have been heard partially.
    if (playback.released && this.#consented) this.#noteTranscriptGap("application_interrupted");
    this.#clear(); playback.resolve(false);
  }
  #playApplicationText(text: string, current: () => boolean, deadlineMs = 30_000, recoverable = false) {
    this.#cancelApplicationPlayback(); this.#clearTimer();
    this.#live!.suspendOutput(); this.#clear();
    const generation = ++this.#generation;
    return new Promise<boolean>(resolve => {
      const mark = 'live-application-' + generation + '-' + randomUUID();
      const timer = setTimeout(() => {
        if (this.#applicationPlayback?.mark !== mark) return;
        this.#cancelApplicationPlayback();
        if (!current() || this.#isClosed()) return;
        this.#speechFailure = { code: 'LIVE_APPLICATION_PLAYBACK_DEADLINE', phase: this.#phase };
        if (!recoverable) this.#close('openai_error');
      }, deadlineMs);
      timer.unref?.();
      const playback = { mark, text, generation, current, resolve, timer, released: false, sentAt: "", durationMs: 0 };
      this.#applicationPlayback = playback;
      void this.#render(text).then(rendered => {
        const release = () => {
          if (this.#applicationPlayback !== playback || this.#isClosed()) return;
          if (!current()) { this.#cancelApplicationPlayback(); return; }
          if (this.#speaking || this.#recipientTurnText.trim()) {
            const wait = setTimeout(release, 100); wait.unref?.(); return;
          }
          playback.released = true;
          playback.sentAt = new Date().toISOString();
          playback.durationMs = rendered.durationMs;
          if (this.#criticalResolve) this.#criticalReleased = true;
          for (const payload of rendered.frames) this.#sendAudio(payload);
          this.#send({ event: 'mark', streamSid: this.#stream, mark: { name: mark } });
        };
        release();
      }).catch(() => {
        if (this.#applicationPlayback !== playback) return;
        this.#cancelApplicationPlayback();
        if (!current() || this.#isClosed()) return;
        this.#speechFailure = { code: 'LIVE_APPLICATION_RENDER_FAILED', phase: this.#phase };
        this.#renderedSpeech.delete(text);
        if (!recoverable) this.#close('openai_error');
      });
    });
  }
  #acknowledgeApplicationPlayback(mark: string) {
    const playback = this.#applicationPlayback;
    if (!playback || playback.mark !== mark || !playback.released) return false;
    if (!playback.current() || playback.generation !== this.#generation) { this.#cancelApplicationPlayback(); return true; }
    clearTimeout(playback.timer); this.#applicationPlayback = null;
    const key = 'rendered-application:' + this.#context!.attemptId + ':' + playback.generation;
    this.options.service.publishTranscriptDelta(this.#context!.brief.id, key, 'assistant', playback.text, this.#locale);
    this.#playbackUntil = 0;
    this.#live!.recordApplicationPlayback(playback.text, key, { markId: mark,
      sentAt: playback.sentAt, acknowledgedAt: new Date().toISOString(), durationMs: playback.durationMs });
    playback.resolve(true); return true;
  }
  audio(payload: string) {
    if (this.#phase === 'conversation' && !this.#applicationPlayback && this.#appointmentRejectedTurn === null) this.#sendAudio(payload);
  }
  transcript(role: 'recipient' | 'assistant', text: string, _startMs: number, _endMs: number, _persist: () => void) {
    if (role === 'assistant') {
      return this.#phase === 'conversation' && !this.#applicationPlayback && this.#appointmentRejectedTurn === null;
    }
    // Only timing evidence is needed here. Live's managed backend interprets
    // the answer in its native context; never assemble or classify recipient text.
    // LiveConversation forwards disclosure-phase fragments only after the
    // mandatory audio boundary. Keep them provisional until the real mark.
    if ((this.#phase === "disclosure" || this.#phase === "consent") && text.trim()) {
      this.#answerObserved = true;
      this.#consentInfrastructureFailures = 0;
    }
    if (this.#phase === "consent") this.#settleRecipientTurn();
    if (this.#phase === "consent" && text.trim() && this.#renderedPlayback?.segment === "question") {
      clearTimeout(this.#renderedPlayback.timer); this.#renderedPlayback = null; this.#clear();
    }
    if (this.#consented) {
      if (text.trim()) {
        if (this.#phase === "closing") this.#pauseClosing();
      }
      if (text.trim() && this.#phase === "conversation") this.#cancelCritical("recipient_transcript");
      this.#recipientFragments.push({ text, start: _startMs, end: _endMs });
      this.#recipientTurnText = this.#recipientFragments.sort((a, b) => a.start - b.start || a.end - b.end).map(f => f.text).join("");
      if (this.#recipientTurnText.length > 8_000) { this.#close("openai_error"); return false; }
      this.#settleRecipientTurn();
    }
    return this.#consented && this.#phase !== "recording" && this.#phase !== "closed";
  }
  activity(event: "started" | "stopped" | null, voicedMs = 0) {
    // Energy is not semantic speech. Brief bursts do not clear mandatory audio;
    // sustained input still yields and requires a complete uncleared replay.
    if (this.#phase === "disclosure" && (this.#speaking || event === "started") && voicedMs >= 500 && !this.#disclosureInterrupted &&
        (!this.#requiredPlaybackEndsAt || Date.now() < this.#requiredPlaybackEndsAt)) {
      this.#disclosureInterrupted = true;
      if (this.#renderedPlayback) this.#renderedPlayback.interrupted = true;
      this.#live?.suspendConsent(); this.#clear();
      this.options.logger?.info({ callAttemptId: this.#context!.attemptId, generation: this.#generation,
        cause: "sustained_input_energy", voicedMs }, "Live disclosure interrupted");
    }
    if (this.#criticalReleased && voicedMs >= 500) this.#cancelCritical("sustained_playback_interruption");
    if (event === "started") {
      this.#speaking = true;
      if (this.#phase === "consent") {
        this.#wait(Math.max(0, this.#consentDeadlineAt - Date.now()), () => this.#consentAction(this.#consent.timeout(), "timeout"));
      }
      if (this.#recipientTurnTimer) clearTimeout(this.#recipientTurnTimer);
      // Acoustic activity yields immediately at the transport layer. It does not
      // change task state or cancel an authorized closing until transcript arrives.
      if (this.#phase === "conversation" || this.#phase === "closing") {
        if (!this.#criticalResolve) this.#clear();
        if (this.#phase === "closing") {
          this.#pauseClosing();
        }
      }
    } else if (event === "stopped") {
      this.#speaking = false;
      if (this.#backendFailurePending) this.#scheduleBackendFailure();
      if (this.#phase === "disclosure" && this.#disclosureInterrupted && this.#requiredDisclosureText) {
        if (this.#renderedPlayback) clearTimeout(this.#renderedPlayback.timer);
        this.#renderedPlayback = null;
        this.#disclosure();
        return;
      }
      if (this.#phase === "consent" && this.#pendingConsentQuestion && !this.#answerObserved)
        this.#playPendingConsentQuestion();
      this.#settleRecipientTurn();
      if (this.#waitingExpired) this.#live?.scheduleTaskDecision();
    }
  }
  #settleRecipientTurn() {
    if (this.#recipientTurnTimer) clearTimeout(this.#recipientTurnTimer);
    this.#recipientTurnTimer = null;
    if (!this.#speaking && this.#phase === "consent" && this.#hasConsentAnswer()) {
      this.#recipientTurnTimer = setTimeout(() => {
        this.#recipientTurnTimer = null;
        this.#live?.requestConsentDecision();
      }, 900);
      this.#recipientTurnTimer.unref?.();
      return;
    }
    if (this.#speaking || !["conversation", "closing"].includes(this.#phase) || !this.#consented) return;
    if (!this.#recipientTurnText.trim()) {
      if (this.#phase === "closing" && this.#closingInputPending) {
        this.#recipientTurnTimer = setTimeout(() => {
          this.#recipientTurnTimer = null; this.#closingInputPending = false; this.#fallbackClosing();
        }, 900);
        this.#recipientTurnTimer.unref?.();
      }
      return;
    }
    this.#recipientTurnTimer = setTimeout(() => {
      this.#recipientTurnTimer = null;
      if (this.#speaking || this.#isClosed()) return;
      const turn = { id: `turn-${++this.#turnSequence}`, text: this.#recipientTurnText.trim() };
      this.#recipientTurns.push(turn);
      this.#waitingExpired = false;
      this.#recipientTurnText = "";
      this.#recipientFragments = [];
      if (this.#appointmentReply && this.#turnSequence > this.#appointmentReply.afterTurn) {
        const pending = this.#appointmentReply; this.#appointmentReply = null;
        clearTimeout(pending.timer);
        pending.resolve(turn);
      }
      this.#armTaskWait();
      this.#live?.scheduleTaskDecision();
      if (this.#recipientTurns.reduce((size, turn) => size + turn.text.length, 0) > 96_000) this.#close("openai_error");
      }, 600);
    this.#recipientTurnTimer.unref?.();
  }
  #hasConsentAnswer() { return this.#answerObserved; }
  #armTaskWait() {
    if (this.#phase !== "conversation" || this.#taskWaitTurn === this.#turnSequence) return;
    this.#taskWaitTurn = this.#turnSequence;
    if (this.#taskWaitTimer) clearTimeout(this.#taskWaitTimer);
    this.#taskWaitTimer = setTimeout(() => {
      this.#taskWaitTimer = null;
      if (this.#phase !== "conversation") return;
      this.#waitingExpired = true;
      if (!this.#speaking) this.#live?.requestTaskDecision();
    }, 45_000);
    this.#taskWaitTimer.unref?.();
  }
  #consentAction(action: ConsentFlowAction, reason: "negative" | "timeout" | "recognition_failed" = "recognition_failed") {
    this.options.logger?.info({ callAttemptId: this.#context!.attemptId, action,
      reason: action === "grant_voice" ? "affirmative" : reason }, "Live consent transition");
    const copy = getTwilioCopy(this.#locale);
    if (action === "grant_voice") { void this.#grant({ method: "voice", decision: "affirmative", locale: this.#locale }); return; }
    if (action === "play_clarification") {
      this.#promptConsent(copy.clarification); return;
    }
    if (action === "play_dtmf_fallback") { this.#promptConsent(`${copy.clarification} ${copy.dtmfFallback}`); return; }
    this.#resolveConsentPlayback?.(false); this.#resolveConsentPlayback = null;
    this.#consentFailed = true;
    this.#context!.telemetry("live:consent:failed", { name: "consent.failed", metadata: { reason } });
    this.#phase = "ending";
    this.#say(copy.noConsent, () => this.#hangup());
  }
  async #grant(evidence: ConsentEvidence) {
    if (this.#phase !== "consent") return;
    this.#phase = "recording";
    if (this.#consentOverallTimer) clearTimeout(this.#consentOverallTimer);
    this.#consentOverallTimer = null;
    this.#pendingConsentQuestion = null;
    if (this.#renderedPlayback) { clearTimeout(this.#renderedPlayback.timer); this.#renderedPlayback = null; this.#clear(); }
    // Consent owns recording admission. AMD may still finish later, but cannot
    // revoke an accepted conversation or redirect it to voicemail.
    this.#stopAnsweringWatch();
    this.#clearTimer();
    this.#wait(15_000, () => this.#close("openai_error"));
    try {
      const recorded = await this.options.service.startRecordingAfterConsent(this.#context!.brief.id, evidence);
      if (this.#isClosed()) return;
      this.#consented = true;
      this.#conversationStartedAt = Date.now();
      this.#clearTimer();
      this.#context!.telemetry("live:conversation:started", { name: "conversation.started", metadata: {} });
      const beginTask = () => {
        this.#phase = "conversation";
        this.#live!.configureBackend(recorded.recording?.startedAt ?? undefined);
        this.#armTaskWait();
        this.#settleRecipientTurn();
      };
      if (!recorded.recording?.startedAt) throw new Error('LIVE_RECORDING_BOUNDARY_REQUIRED');
      this.#live!.admitRecording(recorded.recording.startedAt);
      beginTask();
    } catch {
      if (this.#isClosed()) return;
      this.#consentFailed = true;
      this.#context!.telemetry("live:recording:failed", { name: "consent.failed", metadata: { reason: "recording_start_failed" } });
      this.#phase = "ending";
      this.#say(getTwilioCopy(this.#locale).recordingFailure, () => this.#hangup());
    }
  }
  // A render failure before audio release leaves no missing audible words.
  // Unacknowledged/cleared audio is tracked separately as a coverage gap.
  transcriptCaptureComplete() { return !this.#clippedTaskSpeech; }
  transcriptQualityIssues() { return [...this.#transcriptIssues]; }
  #noteTranscriptGap(code: import("@callassist/contracts").TranscriptQualityIssue["code"]) {
    this.#clippedTaskSpeech=true;
    if(!this.#transcriptIssues.some(issue=>issue.code===code)) this.#transcriptIssues.push({code});
  }
  nativeTranscriptGap() { if (this.#consented) this.#noteTranscriptGap("output_boundary"); }
  decisionReady() {
    if (this.#speaking || this.#recipientTurnTimer) return false;
    return this.#phase === "consent" ? this.#hasConsentAnswer() :
      ["conversation", "closing"].includes(this.#phase) && !this.#recipientTurnText.trim() &&
        (!!this.#recipientTurns.length || this.#waitingExpired);
  }
  taskDecisionContext() { return { closing: this.#phase === "closing", waitingExpired: this.#waitingExpired,
    appointment: this.#action ? { state: this.#action.state, proposal: this.#action.proposal,
      delivery: this.#action.delivery ?? null, source: "application_journal", externallyVerified: false } : null }; }
  backendReady() { return this.#phase === "conversation" && !this.#speaking && !this.#recipientTurnText.trim(); }
  backendProgress() {
    if (!this.#backendFailurePending) return;
    if (this.#backendFailureCurrent?.()) return;
    this.#backendFailurePending = false;
    if (this.#backendFailureTimer) clearTimeout(this.#backendFailureTimer);
    this.#backendFailureTimer = null; this.#backendFailureCurrent = null;
    this.options.logger?.info({ callAttemptId: this.#context!.attemptId }, "Obsolete Live failure recovery cancelled");
  }
  backendFailed(current: () => boolean = () => true, code = "LIVE_BACKEND_FAILURE") {
    if (!current()) return;
    if (this.#phase === "ending") return;
    if (this.#phase === "closing") { this.#fallbackClosing(); return; }
    if (this.#isClosed() || !this.#consented) { this.#close("openai_error"); return; }
    if (this.#backendFailurePending) return;
    this.#backendFailurePending = true;
    this.#backendFailureCurrent = current; this.#backendFailureCode = code;
    this.#context!.telemetry(`live:failure:${randomUUID()}`, { name: "conversation.task", metadata: {
      runtimeVersion: "live-managed-v7", phase: "failed", revision: this.#generation, cause: code } });
    this.options.logger?.warn({ callAttemptId: this.#context!.attemptId, code }, "Live owned backend failure pending");
    this.#backendFailureDeadlineAt = Date.now() + 8_000;
    this.#scheduleBackendFailure();
  }
  #scheduleBackendFailure() {
    if (!this.#backendFailurePending) return;
    if (!this.#backendFailureCurrent?.()) { this.backendProgress(); return; }
    if (this.#backendFailureTimer) clearTimeout(this.#backendFailureTimer);
    this.#backendFailureTimer = null;
    if (this.#phase !== "conversation") { this.#backendFailurePending = false; return; }
    const now = Date.now(), remaining = this.#backendFailureDeadlineAt - now;
    const queuedAudioMs = Math.max(0, this.#playbackUntil - now);
    const outputQuietMs = this.#lastOutputAudioAt ? Math.max(0, 500 - (now - this.#lastOutputAudioAt)) : 0;
    if (remaining > 0 && (this.#speaking || queuedAudioMs > 0 || outputQuietMs > 0)) {
      const waitMs = Math.min(remaining, Math.max(100, this.#speaking ? 250 : 0, queuedAudioMs + 150, outputQuietMs));
      this.#backendFailureTimer = setTimeout(() => this.#scheduleBackendFailure(), waitMs);
      this.#backendFailureTimer.unref?.();
      return;
    }
    // Never talk over the recipient when recovery has exhausted its bound.
    if (this.#speaking) {
      this.#backendFailurePending = false;
      this.#speechFailure = { code: this.#backendFailureCode, phase: this.#phase };
      this.#close("openai_error"); return;
    }
    this.#backendFailurePending = false;
    this.#speechFailure = { code: this.#backendFailureCode, phase: this.#phase };
    this.#cancelCritical(); this.#closingReason = "cannot_proceed"; this.#phase = "ending";
    this.#say(liveTaskFailureCopy[this.#locale], () => this.#hangup());
  }
  consentDecisionUnavailable(reason: "provider_failure" | "contract_violation" = "contract_violation") {
    const recover = () => {
      if (this.#phase !== "consent") return;
      this.#consentInfrastructureFailures++;
      this.options.logger?.warn({ callAttemptId: this.#context!.attemptId, reason,
        attempt: this.#consentInfrastructureFailures }, "Live consent decision unavailable");
      // Infrastructure/contract failure is not a semantic "unclear" answer.
      // Retry the same settled answer once without advancing the user flow.
      if (this.#consentInfrastructureFailures <= 1) { this.#settleRecipientTurn(); return; }
      this.#consentAction(this.#consent.decide("unclear"), "recognition_failed");
    };
    if (this.#phase === "disclosure") {
      void this.#consentPlayback.then(played => {
        if (played) recover();
      });
      return;
    }
    recover();
  }
  #cancelCritical(cause = "stale_action") {
    if (!this.#criticalResolve) return;
    if (this.#criticalReleased) this.#noteTranscriptGap("application_interrupted");
    this.#context!.telemetry(`live:action-interrupted:${randomUUID()}`, { name: "conversation.task", metadata: {
      runtimeVersion: "live-managed-v7", phase: "stale", revision: this.#generation,
      cause, released: this.#criticalReleased } });
    this.options.logger?.info({ callAttemptId: this.#context!.attemptId, cause,
      released: this.#criticalReleased, generation: this.#generation }, "Live appointment playback cancelled");
    this.#clearTimer();

    this.#cancelApplicationPlayback();
    this.#clear(); this.#criticalResolve(false); this.#criticalResolve = null;
  }
  #protectedSay(text: string, current: () => boolean) {
    return new Promise<boolean>(resolve => {
      this.#criticalResolve = resolve; this.#criticalReleased = false;
      void this.#playApplicationText(text, current).then(played => {
        if (this.#criticalResolve !== resolve) return;
        this.#criticalResolve = null; resolve(played);
      });
    });
  }
  #waitForAppointmentReply(afterTurn: number) {
    // A function that asks the recipient a question is not ready for backend
    // continuation until its answer arrives. This is a tool result, not a turn
    // scheduler: ordinary conversation never starts a Responses request here.
    const observed = this.#recipientTurns.find(turn => Number(turn.id.slice(5)) > afterTurn);
    if (observed) return Promise.resolve(observed);
    return new Promise<{ id: string; text: string } | null>(resolve => {
      const timer = setTimeout(() => {
        if (this.#appointmentReply?.resolve !== resolve) return;
        this.#appointmentReply = null; resolve(null);
      }, 45_000);
      timer.unref?.(); this.#appointmentReply = { afterTurn, resolve, timer };
    });
  }
  async tool(call: { name: string; arguments: string }, current: () => boolean): Promise<Record<string, unknown>> {
    const reject = (reason: string) => ({ ok: false, reason });
    if (!current()) return reject("stale_or_unauthorized_request");
    let value: Record<string, unknown>;
    try { value = object(JSON.parse(call.arguments)); } catch { return reject("invalid_arguments"); }
    if (call.name === "report_consent") {
      if (Object.keys(value).join() !== "decision" || !["affirmative", "negative", "unclear"].includes(String(value.decision))) return reject("invalid_arguments");
      if (this.#phase !== "disclosure" && this.#phase !== "consent") return reject("stale_or_unauthorized_request");
      // A native decision can arrive before Twilio acknowledges queued playback.
      // Keep it pending, and recheck freshness after the real mark (never a timer).
      const played = await this.#consentPlayback;
      if (!played || !current() || this.#phase !== "consent" || this.#speaking) return reject("stale_or_unauthorized_request");
      if (!this.#hasConsentAnswer()) return reject("awaiting_recipient_answer");
      const decision = value.decision as "affirmative" | "negative" | "unclear";
      this.options.logger?.info({ callAttemptId: this.#context!.attemptId, decision,
        stage: this.#consent.stage }, "Live delegated consent decision");
      this.#consentAction(this.#consent.decide(decision), decision === "negative" ? "negative" : "recognition_failed");
      return { ok: true, decision, state: decision === "affirmative" ? "recording_start_pending" : this.#phase,
        instruction: "Consent decision accepted; this delegation is complete. No spoken reply is needed. The application confirms recording startup and enables the task separately." };
    }
    if (this.#speaking || this.#recipientTurnTimer || this.#recipientTurnText.trim() ||
        !["conversation", "closing"].includes(this.#phase)) return reject("stale_or_unauthorized_request");
    if (call.name === "report_task_state") {
      if (Object.keys(value).sort().join() !== "state,summary" ||
          !["continue", "wait_for_recipient", "keep_closing", "resume_conversation"].includes(String(value.state)) ||
          typeof value.summary !== "string" || value.summary.trim().length < 2 || value.summary.length > 400)
        return reject("invalid_arguments");
      if (this.#phase === "closing") {
        if (value.state === "keep_closing") {
          this.#closingInputPending = false; this.#startClosingSpeech();
          return { ok: true, state: "closing_authorized", reason: "keep_closing",
            instruction: "The recipient only acknowledged closing. The application will finish the authorized closing audio. Stay silent and finish this delegation." };
        }
        if (value.state !== "resume_conversation") return reject("closing_decision_required");
        this.#interruptClosing(); this.#armTaskWait();
        return { ok: true, state: "conversation", reason: "resume_conversation", summary: value.summary };
      }
      if (value.state === "keep_closing" || value.state === "resume_conversation") return reject("not_closing");
      if (this.#waitingExpired) {
        const turn = this.#turnSequence;
        this.backendFailed(() => this.#waitingExpired && turn === this.#turnSequence, "LIVE_TASK_WAIT_EXHAUSTED");
        return reject("waiting_deadline_exhausted");
      }
      this.#appointmentRejectedTurn = null;
      this.#live?.resumeOutput("task_clarification_authorized");
      this.#armTaskWait();
      return { ok: true, state: value.state, reason: value.state, summary: value.summary,
        instruction: "Continue only the approved task. Ask the necessary next question if it has not already been asked, then listen. This is not appointment confirmation." };
    }
    // Provenance is application-owned. Requiring a model to echo IDs created after
    // transcript settlement races the native backend's own conversation context.
    // Keep the freshness fence and attach actual observed turns here instead.
    const observations = this.#recipientTurns.slice(-8);
    const evidence = observations.map(turn => turn.id);
    const context = this.#context!;
    if (call.name === "request_appointment") {
      if (this.#phase !== "conversation" || Object.keys(value).sort().join() !== "intent,proposal" || !["request", "status_check"].includes(String(value.intent)) || !evidence.length) return reject("invalid_arguments");
      const validation = validateAppointmentProposal({ authorization: getAppointmentAuthorization(context.snapshot.plan), proposal: value.proposal, now: new Date() });
      if (!validation.ok) {
        this.#appointmentRejectedTurn = this.#turnSequence;
        this.#live?.suspendOutput(); this.#clear();
        return { ...validation, instruction: "The proposal is not authorized. Do not claim booking. Use report_task_state to resolve the missing details with a focused clarification, or status_check for an already reported arrangement. A recoverable rejection is not a terminal outcome." };
      }
      this.#appointmentRejectedTurn = null;
      const pending = this.#action;
      if (pending && (pending.state !== "uncertain" || JSON.stringify(pending.proposal) !== JSON.stringify(validation.proposal)))
        return reject("appointment_already_requested");
      const attempt = (pending?.delivery?.attempt ?? (pending ? 1 : 0)) + 1;
      if (attempt > 3) return reject("appointment_recovery_exhausted");
      // Uncertain delivery is not evidence that no appointment exists. Recovery
      // always reconciles the same proposal; an existing booking uses status even
      // when no application-owned request has ever been delivered.
      const kind: 'request' | 'status_check' = pending ? 'status_check' : value.intent as 'request' | 'status_check';
      const content = (kind === "request" ? appointmentRequestCopy : appointmentStatusCopy)(this.#locale, context.brief.representedPerson,
        getAppointmentAuthorization(context.snapshot.plan)!, validation.proposal);
      if (!current() || !this.backendReady()) return reject("stale_request");
      const delivery = { kind, status: "not_sent" as const, attempt };
      this.#action = pending
        ? await this.options.service.repository.transitionVoiceAction({ id: pending.id, version: pending.version,
          state: "sending", delivery, evidence, observations })
        : await this.options.service.repository.beginVoiceAction({ callBriefId: context.brief.id, callAttemptId: context.attemptId,
          snapshotHash: context.snapshot.compilationSnapshotHash, proposal: validation.proposal, content, evidence, observations, delivery });
      if (!this.#action) return reject("appointment_already_requested");
      this.#publishActionState();
      const played = current() && await this.#protectedSay(content, current);
      if (played) this.#actionDeliveredAfterTurn = this.#turnSequence;
      this.#action = await this.options.service.repository.transitionVoiceAction({ id: this.#action.id, version: this.#action.version,
        state: played ? "delivered" : "uncertain", delivery: { ...delivery,
          status: played ? "played" : this.#criticalReleased ? "unacknowledged" : "not_sent" }, evidence: [] });
      this.#criticalReleased = false;
      this.#publishActionState();
      if (!this.#isClosed()) this.#live?.resumeOutput(played ? "appointment_question_played" : "appointment_question_cancelled");
      if (!played || this.#isClosed()) return { ok: false, reason: "appointment_delivery_interrupted",
        state: this.#action?.state ?? "uncertain", actionCompleted: false, appointment: this.taskDecisionContext().appointment,
        instruction: "Do not claim completion. Resolve the recipient's latest answer and missing details. Call request_appointment with the SAME exact proposal when ready: use intent status_check to reconcile the existing arrangement without creating another booking." };
      this.#live?.instruct("The application appointment request has been delivered. Listen for the recipient's answer without repeating the request. The pending backend tool will receive that answer. Do not assume or announce success before the backend result.");
      const reply = await this.#waitForAppointmentReply(this.#actionDeliveredAfterTurn);
      return { ok: !!reply, reason: reply ? "recipient_reply_received" : "recipient_reply_timeout",
        state: this.#action?.state ?? "uncertain", actionCompleted: false,
        appointmentDetails: { ...calendarDateDetails(validation.proposal.date, this.#locale),
          startTime: validation.proposal.startTime, timeZone: validation.proposal.timeZone },
        recipientReply: reply ? { source: "observed_recipient_speech", text: reply.text } : null };
    }
    if (call.name === "confirm_appointment") {
      if (this.#phase !== "conversation") return reject("closing_decision_required");
      if (Object.keys(value).sort().join() !== "confirmation,proposal") return reject("invalid_arguments");
      const pending = this.#action;
      const parsed = parseAppointmentProposal(value.proposal);
      if (!pending || pending.state !== "delivered" || !parsed.ok || JSON.stringify(parsed.proposal) !== JSON.stringify(pending.proposal)) return reject("exact_delivered_proposal_required");
      if (value.confirmation !== "affirmative" || !observations.some(turn => Number(turn.id.slice(5)) > this.#actionDeliveredAfterTurn)) return reject("subsequent_confirmation_required");
      this.#action = await this.options.service.repository.transitionVoiceAction({ id: pending.id, version: pending.version,
        state: "confirmed", evidence, observations });
      this.#publishActionState();
      return { ok: !!this.#action, state: this.#action?.state, source: "recipient_report", externallyVerified: false,
        appointmentDetails: { ...calendarDateDetails(pending.proposal.date, this.#locale),
          startTime: pending.proposal.startTime, timeZone: pending.proposal.timeZone } };
    }
    if (call.name !== "end_call" || !this.options.agentHangupEnabled) return reject("unsupported_tool");
    if (Object.keys(value).sort().join() !== "reason,resultSummary" || !endCallReasons.includes(value.reason as EndCallReason) ||
        typeof value.resultSummary !== "string" || value.resultSummary.trim().length < 2 || value.resultSummary.length > 400)
      return reject("invalid_closing_request");
    if (value.reason === "objective_resolved") {
      if (!evidence.length) return reject("recipient_evidence_required");
      if (getAppointmentAuthorization(context.snapshot.plan) && this.#action?.state !== "confirmed") return reject("appointment_confirmation_required");
    }
    if (!evidence.length && !this.#waitingExpired) return reject("recipient_evidence_required");
    if (value.reason === "cannot_proceed" && this.#appointmentRejectedTurn === this.#turnSequence && !this.#waitingExpired)
      return reject("clarification_required");
    const summary = evidence.length ? value.resultSummary.trim() : liveTaskFailureCopy[this.#locale];
    this.#terminalDecision = { revision: ++this.#terminalRevision, reason: value.reason as EndCallReason, summary,
      evidence, actionState: this.#action?.state ?? null };
    await this.options.service.repository.recordTerminalDecision({ ...this.#terminalDecision, callBriefId: context.brief.id,
      callAttemptId: context.attemptId, snapshotHash: context.snapshot.compilationSnapshotHash, observations, locale: this.#locale });
    if (!current() || this.#isClosed()) return reject("stale_request");
    return { ok: this.#requestClosing(value.reason as EndCallReason), actionCompleted: false,
      state: "closing_authorized", reason: value.reason, resultSummary: value.resultSummary.trim() };
  }
  #closingDeadlineAt = 0;
  #publishActionState() {
    if (!this.#action || this.#isClosed()) return;
    this.#live?.appointmentState(this.taskDecisionContext().appointment);
    this.#context!.telemetry(`live:action:${this.#action.id}:${this.#action.version}`, { name: "conversation.task", metadata: {
      runtimeVersion: "live-managed-v7", phase: this.#action.state === "confirmed" ? "confirm_appointment" : "request_appointment",
      revision: this.#action.version, actionState: this.#action.state,
      ...(this.#action.delivery ? { deliveryKind: this.#action.delivery.kind, deliveryStatus: this.#action.delivery.status } : {}) } });
    this.options.logger?.info({ callAttemptId: this.#context!.attemptId, actionId: this.#action.id,
      state: this.#action.state, delivery: this.#action.delivery }, "Live appointment state updated");
  }
  // Backend continuation is independent of audible terminal delivery.
  closingBackendCompleted() {}
  #requestClosing(reason: EndCallReason) {
    if (this.#phase === "closing") {
      this.#closingInputPending = false; this.#closingReason = reason; this.#startClosingSpeech(); return true;
    }
    if (this.#phase !== "conversation") return false;
    this.#cancelCritical("terminal_authorized");
    this.#cancelApplicationPlayback();
    if (this.#appointmentReply) {
      clearTimeout(this.#appointmentReply.timer); this.#appointmentReply.resolve(null); this.#appointmentReply = null;
    }
    this.#phase = "closing";
    this.#closingReason = reason;
    if (this.#taskWaitTimer) clearTimeout(this.#taskWaitTimer);
    this.#taskWaitTimer = null;
    this.#closingAttempts = 0;
    this.#closingDeadlineAt = Date.now() + 30_000;
    this.#closingDeadlineTimer = setTimeout(() => {
      if (this.#phase !== "closing") return;
      this.#speechFailure = { code: "LIVE_CLOSING_DEADLINE", phase: "closing" };
      this.#clear(); this.#close("openai_error");
    }, 30_000);
    this.#closingDeadlineTimer.unref?.();
    this.#startClosingSpeech();
    return true;
  }
  #startClosingSpeech() {
    if (this.#phase !== "closing" || this.#closingInputPending || this.#speaking) return;
    this.#live?.suspendOutput();
    this.#cancelApplicationPlayback();
    const decision = this.#terminalDecision;
    const remaining = this.#closingDeadlineAt - Date.now();
    if (remaining <= 0 || this.#closingAttempts >= 2) { this.#clear(); this.#close("openai_error"); return; }
    this.#closingAttempts++;
    // One finite audio unit owns the output. A native tail or a backend completion
    // cannot issue its mark; only the final rendered frame does.
    const text = [decision?.summary, liveFarewellCopy[this.#locale]].filter(Boolean).join(" ");
    const current = () => this.#phase === "closing" && !this.#closingInputPending && this.#terminalDecision === decision;
    const playback = this.#playApplicationText(text, current, remaining, true);
    const generation = this.#generation;
    this.#context!.telemetry(`live:closing:${generation}:requested`, { name: "conversation.hangup", metadata: {
      phase: "requested", reason: this.#closingReason, generation
    } });
    void playback.then(played => {
      if (!current() || generation !== this.#generation) return;
      if (played) { this.#speechFailure = null; this.#hangup(); }
      else this.#fallbackClosing();
    });
  }
  #pauseClosing() {
    if (this.#closingInputPending) return;
    this.#closingInputPending = true;
    if (this.#applicationPlayback) this.#closingAttempts = Math.max(0, this.#closingAttempts - 1);
    this.#cancelApplicationPlayback();
    this.#clearTimer(); this.#clear();
    this.#live?.instruct("The recipient interrupted closing audio. Listen silently while the backend interprets the complete answer. Closing remains authorized unless the backend identifies a material new request or correction. Do not repeat the task or announce this check.");
    this.options.logger?.info({ callAttemptId: this.#context!.attemptId }, "Live closing awaiting recipient interpretation");
  }
  #fallbackClosing() {
    if (this.#phase !== "closing" || this.#closingInputPending || this.#speaking) return;
    this.#startClosingSpeech();
  }
  #interruptClosing() {
    if (this.#phase !== "closing") return false;
    this.#generation++;
    this.#context!.telemetry(`live:closing:${this.#generation}:interrupted`, { name: "conversation.hangup", metadata: {
      phase: "interrupted", reason: this.#closingReason, generation: this.#generation
    } });
    this.#clearTimer(); this.#clear();
    if (this.#closingDeadlineTimer) clearTimeout(this.#closingDeadlineTimer);
    this.#closingDeadlineTimer = null; this.#closingInputPending = false;
    this.#cancelApplicationPlayback();
    this.#terminalDecision = null;
    this.#phase = "conversation";
    this.#live?.resumeOutput("closing_cancelled");
    return true;
  }
  #sendAudio(payload: string) {
    if (this.#consented && !this.#firstConversationAudio && pcmuHasSpeech(Buffer.from(payload, "base64"))) {
      this.#firstConversationAudio = true;
      this.#context!.telemetry("live:conversation:first-audio", { name: "conversation.first_audio", metadata: { latencyMs: Math.max(0, Date.now() - this.#conversationStartedAt) } });
    }
    this.#lastOutputAudioAt = Date.now();
    this.#playbackUntil = Math.max(Date.now(), this.#playbackUntil) + Buffer.from(payload,"base64").length / 8;
    this.#send({ event: "media", streamSid: this.#stream, media: { payload } });
    if (this.#backendFailurePending) this.#scheduleBackendFailure();
  }
  #send(event: object) { if (this.twilio?.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify(event)); }
  #clear() {
    if ((this.#phase === "conversation" || this.#phase === "closing") && this.#playbackUntil > Date.now()+150) this.#noteTranscriptGap("output_cleared");
    this.#playbackUntil = 0;
    if (this.#stream) this.#send({ event: "clear", streamSid: this.#stream });
  }
  #clearTimer() { if (this.#timer) clearTimeout(this.#timer); this.#timer = null; }
  #wait(ms: number, task: () => void) { this.#clearTimer(); this.#timer = setTimeout(task, ms); this.#timer.unref?.(); }
  #isClosed() { return this.#phase === "closed"; }
  #recordingAccepted() { return this.#consented || this.#phase === "recording"; }
  #hangupRequested = false;
  #hangup() {
    if (this.#isClosed() || !this.#context || this.#hangupRequested) return;
    this.#hangupRequested = true;
    this.#phase = "ending";
    if (this.#closingDeadlineTimer) clearTimeout(this.#closingDeadlineTimer);
    this.#closingDeadlineTimer = null;
    if (this.#consented) this.#context.telemetry(`live:closing:${this.#generation}:played`, { name: "conversation.hangup", metadata: {
      phase: "playback_complete", reason: this.#closingReason, generation: this.#generation, trigger: "playback_complete"
    } });
    this.#wait(2_000, () => this.#close("agent_hangup_fallback"));
    void this.options.service.prepareAgentHangup(this.#context.brief.id, this.#context.attemptId, this.#provider)
      .then(prepared => this.#close(prepared ? "agent_hangup" : "socket_closed"), () => this.#close("agent_hangup_fallback"));
  }
  #close(reason: "socket_closed" | "stream_stopped" | "openai_error" | "agent_hangup" | "agent_hangup_fallback") {
    if (this.#isClosed()) return;
    this.#phase = "closed";
    this.#stopAnsweringWatch();
    if (this.#appointmentReply) clearTimeout(this.#appointmentReply.timer);
    this.#appointmentReply?.resolve(null); this.#appointmentReply = null;
    if (this.#taskWaitTimer) clearTimeout(this.#taskWaitTimer);
    if (this.#closingDeadlineTimer) clearTimeout(this.#closingDeadlineTimer);
    this.#taskWaitTimer = null; this.#closingDeadlineTimer = null;
    this.#cancelCritical();
    this.#cancelApplicationPlayback();
    this.#clearTimer();
    this.#resolveConsentPlayback?.(false); this.#resolveConsentPlayback = null;
    if (this.#recipientTurnTimer) clearTimeout(this.#recipientTurnTimer);
    if (this.#backendFailureTimer) clearTimeout(this.#backendFailureTimer);
    if (this.#consentOverallTimer) clearTimeout(this.#consentOverallTimer);
    this.#consentOverallTimer = null;
    this.#backendFailureTimer = null; this.#backendFailurePending = false;
    this.#recipientTurnText = ""; this.#recipientTurns = []; this.#recipientFragments = [];
    if (this.#warmSilence) clearInterval(this.#warmSilence);
    if (this.#renderedPlayback) clearTimeout(this.#renderedPlayback.timer);
    this.#renderedPlayback = null; this.#renderedSpeech.clear(); this.#requiredDisclosureText = null;
    this.#pendingConsentQuestion = null; this.#requiredPlaybackEndsAt = 0;
    if (this.#context && this.#admitted) {
      if (!this.#consented && !this.#consentFailed) this.#context.telemetry("live:consent:ended", { name: "consent.failed", metadata: { reason: "stream_ended_before_consent" } });
      this.#context.telemetry("live:conversation:ended", { name: "conversation.ended", metadata: { reason, ...(this.#speechFailure ? { failureCode: this.#speechFailure.code, failurePhase: this.#speechFailure.phase } : {}) } });
    }
    this.#live?.close();
    if (this.twilio?.readyState === WebSocket.OPEN) this.twilio.close();
  }
}

function speechRenderCode(error: unknown) {
  return error instanceof Error && /^SPEECH_RENDER_[A-Z0-9_]+$/.test(error.message)
    ? error.message : "SPEECH_RENDER_FAILED";
}

function speechRenderOutcome(error: unknown): "provider_error" | "network_error" | "invalid_response" {
  const code = speechRenderCode(error);
  if (code === "SPEECH_RENDER_TIMEOUT" || code === "SPEECH_RENDER_NETWORK_ERROR") return "network_error";
  if (code === "SPEECH_RENDER_INVALID_AUDIO") return "invalid_response";
  return "provider_error";
}

function speechRenderStatus(error: unknown) {
  const match = speechRenderCode(error).match(/^SPEECH_RENDER_PROVIDER_ERROR_(\d{3})$/);
  return match ? Number(match[1]) : null;
}
