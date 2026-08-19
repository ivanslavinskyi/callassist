import {
  normalizeCreateCallBriefInput,
  type ApprovalDecision,
  type CallBrief,
  type CallEvent,
  type CallSnapshot,
  type CreateCallBriefInput,
  type TranscriptSegment
} from "@callassist/contracts";
import {
  BriefCompilerError,
  DeterministicBriefCompiler,
  type BriefCompiler
} from "./brief-compiler/brief-compiler";
import { getMockCopy } from "./mock-copy";
import {
  CallRepositoryError,
  isUuid,
  type CallRepository
} from "./storage/call-repository";
import { MockTelephonyProvider } from "./telephony/mock-telephony-provider";
import {
  mapTwilioStatusToCallStatus,
  type RecordingMedia,
  type TelephonyProvider,
  type TwilioCallStatus
} from "./telephony/telephony-provider";
import {
  PostCallTranscriptionError,
  type PostCallTranscriber
} from "./transcription/openai-post-call-transcriber";

type Subscriber = (event: CallEvent) => void;

export class CallServiceError extends Error {
  readonly diagnostic: {
    compilerCode: BriefCompilerError["code"];
    responseId: string | null;
    clientRequestId: string | null;
    validationPaths: string[];
    statusCode: number | null;
    stage: BriefCompilerError["stage"];
  } | null;

  constructor(
    readonly code:
      | "TELEPHONY_START_FAILED"
      | "TELEPHONY_STOP_FAILED"
      | "RECORDING_START_FAILED"
      | "RECORDING_NOT_AVAILABLE"
      | "BRIEF_COMPILER_UNAVAILABLE"
      | "BRIEF_COMPILER_RESPONSE_INVALID",
    options?: {
      cause?: unknown;
      diagnostic?: CallServiceError["diagnostic"];
    }
  ) {
    super(code, options);
    this.name = "CallServiceError";
    this.diagnostic = options?.diagnostic ?? null;
  }
}

export class CallService {
  readonly #subscribers = new Map<string, Set<Subscriber>>();
  readonly #timers = new Map<string, Set<NodeJS.Timeout>>();
  readonly #backgroundJobs = new Set<Promise<unknown>>();
  readonly #processingRecordings = new Set<string>();
  readonly #onBackgroundError: (error: unknown) => void;
  readonly #postCallTranscriber?: PostCallTranscriber;
  readonly #briefCompiler: BriefCompiler;
  #retentionTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly repository: CallRepository,
    readonly telephonyProvider: TelephonyProvider = new MockTelephonyProvider(),
    onBackgroundError: (error: unknown) => void = console.error,
    postCallTranscriber?: PostCallTranscriber,
    briefCompiler: BriefCompiler = new DeterministicBriefCompiler()
  ) {
    this.#onBackgroundError = onBackgroundError;
    this.#postCallTranscriber = postCallTranscriber;
    this.#briefCompiler = briefCompiler;
  }

  async initialize() {
    await this.repository.ping();
    const [recoveredCalls] = await Promise.all([
      this.repository.recoverInterruptedCalls(),
      this.repository.recoverInterruptedTranscriptions()
    ]);
    if (this.#postCallTranscriber) {
      const candidates = await this.repository.listTranscriptionCandidates();
      for (const recordingId of candidates) {
        this.#runBackground(() => this.#processRecording(recordingId));
      }
      this.#runBackground(() => this.#purgeExpiredRecordings());
      this.#retentionTimer = setInterval(
        () => this.#runBackground(() => this.#purgeExpiredRecordings()),
        60 * 60 * 1_000
      );
      this.#retentionTimer.unref();
    }
    return recoveredCalls;
  }

  list(input: import("./storage/call-repository").ListCallBriefsInput) {
    return this.repository.list(input);
  }

  async create(input: CreateCallBriefInput, userId: string | null = null) {
    try {
      const compilation = await this.#briefCompiler.compile(
        normalizeCreateCallBriefInput(input)
      );
      return this.repository.create(input, compilation, userId);
    } catch (error) {
      if (error instanceof BriefCompilerError) {
        throw mapBriefCompilerError(error);
      }
      throw error;
    }
  }

  async assertOwned(id: string, userId: string | null) {
    if (!isUuid(id) || !(await this.repository.isOwnedBy(id, userId))) {
      throw new CallRepositoryError("CALL_NOT_FOUND");
    }
  }

  async recompile(id: string, input: CreateCallBriefInput) {
    const current = await this.#require(id);
    const revision = current.compilation
      ? (current.compilation.revision ?? 1) + 1
      : 1;
    try {
      const compilation = await this.#briefCompiler.compile(
        normalizeCreateCallBriefInput(input),
        revision
      );
      const snapshot = await this.repository.recompile(
        id,
        input,
        compilation
      );
      this.#publish(id, { type: "call.updated", brief: snapshot.brief });
      return snapshot;
    } catch (error) {
      if (error instanceof BriefCompilerError) {
        throw mapBriefCompilerError(error);
      }
      throw error;
    }
  }

  get(id: string) {
    return this.repository.get(id);
  }

  async approveCompilation(id: string) {
    const snapshot = await this.repository.approveCompilation(id);
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
    return snapshot;
  }

  async approveAndStart(id: string) {
    await this.approveCompilation(id);
    return this.start(id);
  }

  subscribe(id: string, subscriber: Subscriber) {
    const subscribers = this.#subscribers.get(id) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(id, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.#subscribers.delete(id);
    };
  }

  async start(id: string) {
    const current = await this.#require(id);
    if (
      ["review_required", "needs_clarification", "blocked"].includes(
        current.brief.status
      ) ||
      (current.brief.status === "ready" && !current.compilation?.approvedAt)
    ) {
      throw new CallRepositoryError("CALL_NOT_READY");
    }
    if (current.brief.status !== "ready") return current;

    const reserved = await this.repository.startAttempt(id, {
      provider: this.telephonyProvider.mode
    });
    this.#publish(id, {
      type: "call.updated",
      brief: reserved.snapshot.brief
    });

    let started;
    try {
      started = await this.telephonyProvider.startCall(current.brief);
    } catch (error) {
      await this.#markFailedIfActive(id).catch(this.#onBackgroundError);
      this.#onBackgroundError(error);
      throw new CallServiceError("TELEPHONY_START_FAILED", { cause: error });
    }

    let snapshot: CallSnapshot;
    try {
      if (!started.providerCallId) {
        throw new CallServiceError("TELEPHONY_START_FAILED");
      }
      snapshot = await this.repository.attachProviderCall(
        reserved.attempt.id,
        started.providerCallId,
        started.providerStatus
      );
    } catch (error) {
      if (started.providerCallId) {
        await this.telephonyProvider
          .stopCall(started.providerCallId)
          .catch(this.#onBackgroundError);
      }
      await this.#markFailedIfActive(id).catch(this.#onBackgroundError);
      throw error;
    }

    if (["completed", "failed", "stopped"].includes(snapshot.brief.status)) {
      await this.telephonyProvider
        .stopCall(started.providerCallId)
        .catch(this.#onBackgroundError);
      return snapshot;
    }

    if (this.telephonyProvider.mode === "mock") {
      this.#schedule(id, 900, () => this.#updateStatus(id, "in_progress"));
      this.#schedule(id, 1_900, async () => {
        const call = await this.#require(id);
        await this.#addTranscript(
          id,
          "assistant",
          getMockCopy(call.brief.locale, call.brief.representedPerson).greeting
        );
      });
      this.#schedule(id, 3_800, async () => {
        const call = await this.#require(id);
        await this.#addTranscript(
          id,
          "recipient",
          getMockCopy(call.brief.locale, call.brief.representedPerson).recipientReply
        );
      });
      this.#schedule(id, 5_200, () => this.#requestApproval(id));
    }
    return snapshot;
  }

  async stop(id: string) {
    this.#clearTimers(id);
    const attempt = await this.repository.getLatestAttempt(id);
    if (attempt?.providerCallId) {
      try {
        await this.telephonyProvider.stopCall(attempt.providerCallId);
      } catch (error) {
        this.#onBackgroundError(error);
        throw new CallServiceError("TELEPHONY_STOP_FAILED", { cause: error });
      }
    }
    const snapshot = await this.repository.stop(id);
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
    if (snapshot.recording) {
      this.#publish(id, {
        type: "recording.updated",
        recording: snapshot.recording
      });
    }
    return snapshot;
  }

  async handleTwilioStatus(
    providerCallId: string,
    status: TwilioCallStatus,
    callBriefId?: string
  ) {
    const result = await this.repository.applyProviderStatus(
      providerCallId,
      status,
      mapTwilioStatusToCallStatus(status),
      callBriefId
    );
    if (result) {
      this.#publish(result.callId, {
        type: "call.updated",
        brief: result.snapshot.brief
      });
      if (result.snapshot.recording) {
        this.#publish(result.callId, {
          type: "recording.updated",
          recording: result.snapshot.recording
        });
      }
    }
    return result?.snapshot ?? null;
  }

  async addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string
  ) {
    const normalized = text.trim();
    if (!normalized) return this.#require(id);
    return this.#addTranscript(id, role, normalized);
  }

  async startRecordingAfterConsent(id: string) {
    if (this.telephonyProvider.mode !== "twilio") {
      throw new CallServiceError("RECORDING_START_FAILED");
    }
    const begun = await this.repository.beginRecording(id);
    this.#publish(id, {
      type: "recording.updated",
      recording: begun.recording
    });

    try {
      const providerRecording = await this.telephonyProvider.startRecording(
        begun.providerCallId,
        { callBriefId: id, recordingId: begun.recording.id }
      );
      const attached = await this.repository.attachProviderRecording(
        begun.recording.id,
        providerRecording.providerRecordingId,
        providerRecording.providerStatus
      );
      this.#publish(id, {
        type: "recording.updated",
        recording: attached.recording
      });
      return attached.snapshot;
    } catch (error) {
      const failed = await this.repository
        .failRecording(begun.recording.id, "recording_start_failed")
        .catch(() => null);
      if (failed) {
        this.#publish(id, {
          type: "recording.updated",
          recording: failed.recording
        });
      }
      this.#onBackgroundError(error);
      throw new CallServiceError("RECORDING_START_FAILED", { cause: error });
    }
  }

  async handleTwilioRecordingStatus(
    input: Parameters<CallRepository["applyRecordingStatus"]>[0]
  ) {
    const result = await this.repository.applyRecordingStatus(input);
    if (!result) return null;
    this.#publish(result.callId, {
      type: "recording.updated",
      recording: result.recording
    });
    if (
      result.recording.status === "available" &&
      this.#postCallTranscriber
    ) {
      this.#runBackground(() => this.#processRecording(result.recording.id));
    }
    return result.snapshot;
  }

  async getRecordingMedia(id: string): Promise<RecordingMedia> {
    const snapshot = await this.#require(id);
    const recording = snapshot.recording;
    if (
      recording?.status !== "available" ||
      !recording.providerRecordingId
    ) {
      throw new CallServiceError("RECORDING_NOT_AVAILABLE");
    }
    return this.telephonyProvider.getRecordingMedia(
      recording.providerRecordingId
    );
  }

  async deleteRecording(id: string) {
    const snapshot = await this.#require(id);
    const recording = snapshot.recording;
    if (!recording) {
      throw new CallServiceError("RECORDING_NOT_AVAILABLE");
    }
    if (recording.status === "deleted") return snapshot;
    if (
      recording.status !== "available" ||
      !recording.providerRecordingId ||
      snapshot.finalTranscript?.status === "processing"
    ) {
      throw new CallServiceError("RECORDING_NOT_AVAILABLE");
    }
    await this.telephonyProvider.deleteRecording(
      recording.providerRecordingId
    );
    const deleted = await this.repository.markRecordingDeleted(id);
    this.#publish(id, {
      type: "recording.updated",
      recording: deleted.recording
    });
    return deleted.snapshot;
  }

  async retryFinalTranscript(id: string) {
    const snapshot = await this.#require(id);
    if (
      snapshot.recording?.status !== "available" ||
      !this.#postCallTranscriber
    ) {
      throw new CallServiceError("RECORDING_NOT_AVAILABLE");
    }
    this.#runBackground(() =>
      this.#processRecording(snapshot.recording!.id, true)
    );
    return snapshot;
  }

  publishTranscriptDelta(
    id: string,
    key: string,
    role: "assistant" | "recipient",
    delta: string,
    locale: CallBrief["locale"]
  ) {
    if (!delta) return;
    this.#publish(id, { type: "transcript.delta", key, role, delta, locale });
  }

  async resolveApproval(
    id: string,
    approvalId: string,
    input: ApprovalDecision
  ) {
    const { approval, snapshot } = await this.repository.resolveApproval(
      id,
      approvalId,
      input.decision
    );
    this.#publish(id, { type: "approval.resolved", approval });
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });

    const copy = getMockCopy(
      snapshot.brief.locale,
      snapshot.brief.representedPerson
    );
    this.#schedule(id, 650, () =>
      this.#addTranscript(
        id,
        "assistant",
        input.decision === "approved" ? approval.proposedSpeech : copy.declinedSpeech
      )
    );
    this.#schedule(id, 2_200, () => this.#updateStatus(id, "completed"));
    return snapshot;
  }

  async ping() {
    await this.repository.ping();
  }

  async close() {
    for (const id of this.#timers.keys()) this.#clearTimers(id);
    if (this.#retentionTimer) clearInterval(this.#retentionTimer);
    this.#retentionTimer = null;
    await Promise.allSettled(this.#backgroundJobs);
    await this.repository.close();
  }

  async #processRecording(recordingId: string, force = false) {
    if (
      !this.#postCallTranscriber ||
      this.#processingRecordings.has(recordingId)
    ) {
      return;
    }
    this.#processingRecordings.add(recordingId);
    let callId: string | null = null;
    try {
      const claimed = await this.repository.claimFinalTranscript(
        recordingId,
        this.#postCallTranscriber.model,
        force
      );
      if (!claimed) return;
      callId = claimed.callId;
      this.#publish(claimed.callId, {
        type: "final_transcript.updated",
        finalTranscript: claimed.finalTranscript
      });
      const providerRecordingId = claimed.snapshot.recording?.providerRecordingId;
      if (!providerRecordingId) {
        throw new PostCallTranscriptionError("AUDIO_EMPTY");
      }
      const media = await this.telephonyProvider.getRecordingMedia(
        providerRecordingId
      );
      const result = await this.#postCallTranscriber.transcribe(
        media,
        claimed.snapshot.brief,
        claimed.snapshot.transcript,
        {
          recordingStartedAt: claimed.snapshot.recording?.startedAt ?? null,
          durationSeconds:
            claimed.snapshot.recording?.durationSeconds ?? null
        }
      );
      const completed = await this.repository.completeFinalTranscript(
        recordingId,
        result.text,
        result.segments
      );
      this.#publish(completed.callId, {
        type: "final_transcript.updated",
        finalTranscript: completed.finalTranscript
      });
      if (completed.snapshot.brief.audioRetentionDays === 0) {
        await this.deleteRecording(completed.callId).catch(
          this.#onBackgroundError
        );
      }
    } catch (error) {
      if (callId) {
        const failed = await this.repository
          .failFinalTranscript(recordingId, transcriptionFailureCode(error))
          .catch(() => null);
        if (failed) {
          this.#publish(failed.callId, {
            type: "final_transcript.updated",
            finalTranscript: failed.finalTranscript
          });
        }
      }
      this.#onBackgroundError(error);
    } finally {
      this.#processingRecordings.delete(recordingId);
    }
  }

  async #purgeExpiredRecordings() {
    const callIds = await this.repository.listExpiredRecordingCallIds(
      new Date().toISOString()
    );
    for (const callId of callIds) {
      await this.deleteRecording(callId).catch(this.#onBackgroundError);
    }
  }

  async #requestApproval(id: string) {
    const snapshot = await this.#require(id);
    const copy = getMockCopy(
      snapshot.brief.locale,
      snapshot.brief.representedPerson
    );
    const result = await this.repository.requestApproval(id, {
      category: "contact_email",
      title: copy.approvalTitle,
      reason: copy.approvalReason,
      proposedSpeech: copy.proposedSpeech
    });
    this.#publish(id, { type: "call.updated", brief: result.snapshot.brief });
    this.#publish(id, { type: "approval.requested", approval: result.approval });
  }

  async #addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string
  ) {
    const snapshot = await this.#require(id);
    const result = await this.repository.addTranscript(
      id,
      role,
      text,
      snapshot.brief.locale
    );
    this.#publish(id, { type: "transcript.added", segment: result.segment });
    return result.snapshot;
  }

  async #updateStatus(id: string, status: CallBrief["status"]) {
    const snapshot = await this.repository.updateStatus(id, status);
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
    return snapshot;
  }

  async #markFailedIfActive(id: string) {
    const snapshot = await this.#require(id);
    if (["completed", "failed", "stopped"].includes(snapshot.brief.status)) {
      return snapshot;
    }
    return this.#updateStatus(id, "failed");
  }

  #schedule(id: string, delay: number, operation: () => Promise<unknown>) {
    const timer = setTimeout(() => {
      this.#timers.get(id)?.delete(timer);
      void operation().catch(this.#onBackgroundError);
    }, delay);

    const timers = this.#timers.get(id) ?? new Set<NodeJS.Timeout>();
    timers.add(timer);
    this.#timers.set(id, timers);
  }

  #clearTimers(id: string) {
    for (const timer of this.#timers.get(id) ?? []) clearTimeout(timer);
    this.#timers.delete(id);
  }

  #publish(id: string, event: CallEvent) {
    for (const subscriber of this.#subscribers.get(id) ?? []) subscriber(event);
  }

  #runBackground(operation: () => Promise<unknown>) {
    const job = operation().finally(() => this.#backgroundJobs.delete(job));
    this.#backgroundJobs.add(job);
    void job.catch(this.#onBackgroundError);
  }

  async #require(id: string): Promise<CallSnapshot> {
    const snapshot = await this.repository.get(id);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    return snapshot;
  }
}

function transcriptionFailureCode(error: unknown) {
  if (error instanceof PostCallTranscriptionError) return error.code;
  if (error instanceof Error && error.message.startsWith("TWILIO_")) {
    return error.message.slice(0, 120);
  }
  return "POST_CALL_TRANSCRIPTION_FAILED";
}

function mapBriefCompilerError(error: BriefCompilerError) {
  return new CallServiceError(
    error.code === "OPENAI_REQUEST_FAILED"
      ? "BRIEF_COMPILER_UNAVAILABLE"
      : "BRIEF_COMPILER_RESPONSE_INVALID",
    {
      cause: error,
      diagnostic: {
        compilerCode: error.code,
        responseId: error.responseId,
        clientRequestId: error.clientRequestId,
        validationPaths: error.validationPaths,
        statusCode: error.statusCode,
        stage: error.stage
      }
    }
  );
}
