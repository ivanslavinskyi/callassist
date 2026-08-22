import { randomUUID } from "node:crypto";
import {
  adminOperationsWindowBounds,
  adminSystemStatusSchema,
  normalizeCreateCallBriefInput,
  isSwissDestinationPhone,
  type AdminCallListFilters,
  type AdminOperationsWindow,
  type ApprovalDecision,
  type CallBrief,
  type CallEvent,
  type CallOutcomeView,
  type CallSnapshot,
  type CallTelemetryEventInput,
  type CreateCallBriefInput,
  type OwnerCallFeedbackInput,
  type TranscriptSegment
} from "@callassist/contracts";
import { buildAdminOperationsOverview } from "./admin-operations";
import {
  BriefCompilerError,
  DeterministicBriefCompiler,
  type BriefCompiler
} from "./brief-compiler/brief-compiler";
import { getMockCopy } from "./mock-copy";
import {
  CallRepositoryError,
  defaultCallAdmissionPolicy,
  isUuid,
  type AdminCallCursor,
  type CallAdmissionPolicy,
  type CallRepository,
  type AdminWebhookDeliveryFacts,
  type CallChangeSignal,
  type ProviderWebhookDeliveryInput
} from "./storage/call-repository";
import { MockTelephonyProvider } from "./telephony/mock-telephony-provider";
import {
  mapTwilioStatusToCallStatus,
  type RecordingMedia,
  type TelephonyProvider,
  type TwilioCallStatusCallbackValue
} from "./telephony/telephony-provider";
import {
  PostCallTranscriptionError,
  type PostCallTranscriber
} from "./transcription/openai-post-call-transcriber";
import {
  unavailableOperationalCostPolicy,
  type OperationalCostPolicy
} from "./config/operational-cost-policy";
import type { DurableWorkerMode } from "./config/durable-worker-mode";
import {
  DurableJobExecutionError,
  durableJobMaxAttempts,
  type DurableJob,
  type DurableJobLease
} from "./jobs/durable-job";
import { DurableJobWorker } from "./jobs/durable-job-worker";

type Subscriber = (event: CallEvent) => void;
type LiveEventMode = "disabled" | "publish" | "subscribe" | "both";

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
      | "SWISS_DESTINATION_REQUIRED"
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
  readonly #processingRecordings = new Set<string>();
  readonly #onBackgroundError: (error: unknown) => void;
  readonly #postCallTranscriber?: PostCallTranscriber;
  readonly #briefCompiler: BriefCompiler;
  readonly #admissionPolicy: CallAdmissionPolicy;
  readonly #operationalCostPolicy: OperationalCostPolicy;
  readonly #durableJobWorker: DurableJobWorker;
  readonly #durableWorkerConfigured: boolean;
  readonly #durableWorkerMode: DurableWorkerMode;
  readonly #liveEventMode: LiveEventMode;
  readonly #sourceId = randomUUID();
  readonly #pendingCallChangePublications = new Set<Promise<void>>();
  #unsubscribeCallChanges: (() => Promise<void>) | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(
    readonly repository: CallRepository,
    readonly telephonyProvider: TelephonyProvider = new MockTelephonyProvider(),
    onBackgroundError: (error: unknown) => void = console.error,
    postCallTranscriber?: PostCallTranscriber,
    briefCompiler: BriefCompiler = new DeterministicBriefCompiler(),
    admissionPolicy: CallAdmissionPolicy = defaultCallAdmissionPolicy,
    operationalCostPolicy: OperationalCostPolicy =
      unavailableOperationalCostPolicy,
    runtime: {
      durableWorkerMode?: DurableWorkerMode;
      durableWorkerKeepAlive?: boolean;
      durableWorkerEnabled?: boolean;
      reportDurableWorkerHeartbeat?: boolean;
      liveEventMode?: LiveEventMode;
    } = {}
  ) {
    this.#onBackgroundError = onBackgroundError;
    this.#postCallTranscriber = postCallTranscriber;
    this.#briefCompiler = briefCompiler;
    this.#admissionPolicy = admissionPolicy;
    this.#operationalCostPolicy = operationalCostPolicy;
    this.#durableWorkerMode = runtime.durableWorkerMode ?? "embedded";
    this.#liveEventMode = runtime.liveEventMode ?? "both";
    const durableWorkerEnabled = runtime.durableWorkerEnabled ??
      this.#durableWorkerMode === "embedded";
    this.#durableWorkerConfigured = durableWorkerEnabled;
    this.#durableJobWorker = new DurableJobWorker(
      repository,
      {
        ...(postCallTranscriber
          ? {
              final_transcription: (
                job: DurableJob,
                lease: DurableJobLease
              ) => this.#processRecording(job, lease)
            }
          : {}),
        recording_retention: (
          job: DurableJob,
          lease: DurableJobLease
        ) => this.#processRecordingRetention(job, lease),
        ...(telephonyProvider.getCallStatus
          ? {
              provider_call_reconciliation: (
                job: DurableJob,
                lease: DurableJobLease
              ) => this.#reconcileProviderCall(job, lease)
            }
          : {}),
        ...(telephonyProvider.getRecordingStatus
          ? {
              provider_recording_reconciliation: (
                job: DurableJob,
                lease: DurableJobLease
              ) => this.#reconcileProviderRecording(job, lease)
            }
          : {})
      },
      onBackgroundError,
      {
        enabled: durableWorkerEnabled,
        reportRuntimeHeartbeat:
          runtime.reportDurableWorkerHeartbeat ?? false,
        ...(runtime.durableWorkerKeepAlive === undefined
          ? {}
          : { keepAlive: runtime.durableWorkerKeepAlive })
      }
    );
  }

  async initialize() {
    await this.repository.ping();
    if (
      !this.#unsubscribeCallChanges &&
      ["subscribe", "both"].includes(this.#liveEventMode)
    ) {
      this.#unsubscribeCallChanges = await this.repository.subscribeCallChanges(
        (signal) => {
          void this.#handleRemoteCallChange(signal).catch(
            this.#onBackgroundError
          );
        }
      );
    }
    if (!this.#durableWorkerConfigured) return 0;
    const recoveredCalls = await this.repository.recoverInterruptedCalls();
    await this.repository.seedDurableJobs(new Date().toISOString());
    this.#durableJobWorker.start();
    return recoveredCalls;
  }

  list(input: import("./storage/call-repository").ListCallBriefsInput) {
    return this.repository.list(input);
  }

  async recordTelemetry(id: string, input: CallTelemetryEventInput) {
    const callAttemptId = input.callAttemptId === undefined
      ? (await this.repository.getLatestAttempt(id))?.id ?? null
      : input.callAttemptId;
    const event = await this.repository.appendCallTelemetryEvent(id, {
      ...input,
      callAttemptId
    });
    if ([
      "consent.failed",
      "recording.failed",
      "conversation.ended",
      "transcription.failed"
    ].includes(event.payload.name)) {
      await this.#syncSystemOutcome(id);
    }
    return event;
  }

  recordProviderWebhookDelivery(input: ProviderWebhookDeliveryInput) {
    return this.repository.recordProviderWebhookDelivery(input);
  }

  listTelemetry(id: string) {
    return this.repository.listCallTelemetryEvents(id);
  }

  async getOutcome(id: string): Promise<CallOutcomeView> {
    return this.repository.recordSystemCallOutcome(id);
  }

  submitOwnerFeedback(
    id: string,
    userId: string,
    input: OwnerCallFeedbackInput
  ) {
    return this.repository.submitOwnerCallFeedback(id, userId, input);
  }

  getOutcomeMetrics() {
    return this.repository.getCallOutcomeMetrics();
  }

  listAdminCalls(
    filters: AdminCallListFilters,
    limit: number,
    cursor?: AdminCallCursor
  ) {
    return this.repository.listAdminCalls({ ...filters, limit, cursor });
  }

  getAdminCallInspector(id: string) {
    return this.repository.getAdminCallInspector(id);
  }

  getAdminCallSensitiveContent(
    id: string,
    actorUserId: string,
    reason: string
  ) {
    return this.repository.getAdminCallSensitiveContent(
      id,
      actorUserId,
      reason
    );
  }

  async getAdminOperationsOverview(
    kind: AdminOperationsWindow,
    now = new Date()
  ) {
    const { from, to } = adminOperationsWindowBounds(kind, now);
    const facts = await this.repository.getAdminOperationsFacts(from, to);
    return buildAdminOperationsOverview({
      facts,
      kind,
      from,
      to,
      costPolicy: this.#operationalCostPolicy
    });
  }

  async getAdminSystemStatus(
    realtimeConfigured: boolean,
    now = new Date()
  ) {
    const generatedAt = now.toISOString();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000)
      .toISOString();
    const webhookSinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    webhookSinceDate.setUTCMinutes(0, 0, 0);
    const webhookSince = webhookSinceDate.toISOString();
    await this.repository.ping();
    const facts = await this.repository.getAdminSystemFacts(
      generatedAt,
      since,
      webhookSince
    );
    return adminSystemStatusSchema.parse({
      generatedAt,
      components: {
        api: { state: "healthy" },
        database: { state: "healthy" },
        telephony: {
          state: this.telephonyProvider.mode === "mock"
            ? "development"
            : "configured",
          mode: this.telephonyProvider.mode,
          upstreamChecked: false
        },
        realtime: {
          state: realtimeConfigured ? "configured" : "disabled",
          upstreamChecked: false
        },
        transcription: {
          state: this.#postCallTranscriber ? "configured" : "disabled",
          upstreamChecked: false
        }
      },
      outboundCalls: facts.outboundCalls,
      runtime: {
        uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
        backgroundTasks: this.#durableJobWorker.runningCount,
        processingRecordings: this.#processingRecordings.size,
        durableWorkerEnabled: this.#durableJobWorker.enabled,
        durableWorkerMode: this.#durableWorkerMode,
        externalWorker: externalWorkerView(
          this.#durableWorkerMode,
          facts.externalWorker,
          generatedAt
        )
      },
      workload: {
        activeCalls: facts.activeCalls,
        recordingsProcessing: facts.recordingsProcessing,
        transcriptionReady: facts.transcriptionReady,
        transcriptionProcessing: facts.transcriptionProcessing,
        transcriptionFailed: facts.transcriptionFailed,
        retentionScheduled: facts.retentionScheduled,
        retentionOverdue: facts.retentionOverdue
      },
      jobs: facts.jobs,
      webhooks: {
        since: webhookSince,
        retentionDays: 30,
        voice: adminWebhookDeliveryView(facts.webhooks.voice, generatedAt),
        callStatus: adminWebhookDeliveryView(
          facts.webhooks.call_status,
          generatedAt
        ),
        recordingStatus: adminWebhookDeliveryView(
          facts.webhooks.recording_status,
          generatedAt
        )
      },
      recentTelemetry: {
        since,
        warnings: facts.recentWarnings,
        errors: facts.recentErrors
      }
    });
  }

  async retryAdminDurableJob(
    jobId: string,
    actorUserId: string,
    reason: string
  ) {
    const job = await this.repository.retryDurableJob(
      jobId,
      actorUserId,
      reason,
      new Date().toISOString()
    );
    this.#durableJobWorker.wake();
    return job;
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

  grantSignupCredits(userId: string) {
    return this.repository.grantSignupCredits(userId);
  }

  getCreditUsage(userId: string) {
    return this.repository.getCreditUsage(userId);
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

  async approveAndStart(id: string, userId: string | null = null) {
    await this.approveCompilation(id);
    return this.start(id, userId);
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

  async start(id: string, userId: string | null = null) {
    const current = await this.#require(id);
    if (!isSwissDestinationPhone(current.brief.phoneNumber)) {
      throw new CallServiceError("SWISS_DESTINATION_REQUIRED");
    }
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
      provider: this.telephonyProvider.mode,
      userId,
      admissionPolicy: this.#admissionPolicy
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
        started.providerStatus,
        this.#providerReconciliationDeadline(60_000)
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

    this.#schedule(
      id,
      this.#admissionPolicy.maxDurationSeconds * 1_000,
      async () => {
        const call = await this.#require(id);
        if (["dialing", "in_progress", "awaiting_approval"].includes(
          call.brief.status
        )) {
          await this.stop(id);
        }
      }
    );

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
    await this.#syncSystemOutcome(id);
    this.#durableJobWorker.wake();
    return snapshot;
  }

  async handleTwilioStatus(
    providerCallId: string,
    status: TwilioCallStatusCallbackValue,
    callBriefId?: string,
    lease?: DurableJobLease
  ) {
    const result = await this.repository.applyProviderStatus(
      providerCallId,
      status,
      mapTwilioStatusToCallStatus(status),
      callBriefId,
      lease
    );
    if (result) {
      if (["completed", "failed", "stopped"].includes(result.snapshot.brief.status)) {
        this.#clearTimers(result.callId);
      }
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
      if (["completed", "failed", "stopped"].includes(
        result.snapshot.brief.status
      )) {
        await this.#syncSystemOutcome(result.callId);
        this.#durableJobWorker.wake();
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
        providerRecording.providerStatus,
        this.#providerReconciliationDeadline(120_000)
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
        await this.#syncSystemOutcome(id);
      }
      this.#onBackgroundError(error);
      throw new CallServiceError("RECORDING_START_FAILED", { cause: error });
    }
  }

  async handleTwilioRecordingStatus(
    input: Parameters<CallRepository["applyRecordingStatus"]>[0],
    lease?: DurableJobLease
  ) {
    const result = await this.repository.applyRecordingStatus(input, lease);
    if (!result) return null;
    this.#publish(result.callId, {
      type: "recording.updated",
      recording: result.recording
    });
    if (
      result.recording.status === "available" &&
      this.#postCallTranscriber
    ) {
      this.#durableJobWorker.wake();
    }
    if (["available", "failed"].includes(result.recording.status)) {
      await this.#syncSystemOutcome(result.callId);
      this.#durableJobWorker.wake();
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
    await this.repository.enqueueDurableJob({
      type: "final_transcription",
      recordingId: snapshot.recording.id,
      runAfter: new Date().toISOString(),
      maxAttempts: durableJobMaxAttempts.final_transcription,
      force: true,
      restartTerminal: true
    });
    this.#durableJobWorker.wake();
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

  close() {
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close() {
    for (const id of this.#timers.keys()) this.#clearTimers(id);
    await this.#durableJobWorker.close();
    await Promise.allSettled([...this.#pendingCallChangePublications]);
    await this.#unsubscribeCallChanges?.();
    this.#unsubscribeCallChanges = null;
    await this.repository.close();
  }

  async #processRecording(job: DurableJob, lease: DurableJobLease) {
    const recordingId = job.recordingId;
    if (!recordingId) {
      throw new DurableJobExecutionError("DURABLE_JOB_TARGET_INVALID");
    }
    if (!this.#postCallTranscriber) return;
    this.#processingRecordings.add(recordingId);
    let callId: string | null = null;
    try {
      const claimed = await this.repository.claimFinalTranscript(
        recordingId,
        this.#postCallTranscriber.model,
        job.forceRequested,
        currentLease(lease)
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
        result.segments,
        currentLease(lease)
      );
      this.#publish(completed.callId, {
        type: "final_transcript.updated",
        finalTranscript: completed.finalTranscript
      });
      await this.#syncSystemOutcome(completed.callId);
    } catch (error) {
      if (callId) {
        const failureCode = transcriptionFailureCode(error);
        const failed = await this.repository
          .failFinalTranscript(
            recordingId,
            failureCode,
            currentLease(lease)
          )
          .catch(() => null);
        if (failed) {
          this.#publish(failed.callId, {
            type: "final_transcript.updated",
            finalTranscript: failed.finalTranscript
          });
          await this.#syncSystemOutcome(failed.callId);
        }
        throw new DurableJobExecutionError(failureCode, { cause: error });
      }
      throw error;
    } finally {
      this.#processingRecordings.delete(recordingId);
    }
  }

  async #processRecordingRetention(job: DurableJob, lease: DurableJobLease) {
    if (!job.recordingId) {
      throw new DurableJobExecutionError("DURABLE_JOB_TARGET_INVALID");
    }
    const snapshot = await this.#require(job.callId);
    const recording = snapshot.recording;
    if (!recording || recording.status === "deleted") return;
    if (recording.status !== "available" || !recording.providerRecordingId) {
      throw new DurableJobExecutionError("RECORDING_NOT_AVAILABLE");
    }
    try {
      await this.telephonyProvider.deleteRecording(
        recording.providerRecordingId
      );
      const deleted = await this.repository.markRecordingDeleted(
        job.callId,
        currentLease(lease)
      );
      this.#publish(job.callId, {
        type: "recording.updated",
        recording: deleted.recording
      });
    } catch (error) {
      throw new DurableJobExecutionError(
        recordingRetentionFailureCode(error),
        { cause: error }
      );
    }
  }

  async #reconcileProviderCall(job: DurableJob, lease: DurableJobLease) {
    if (!job.callAttemptId || !this.telephonyProvider.getCallStatus) {
      throw new DurableJobExecutionError("DURABLE_JOB_TARGET_INVALID");
    }
    const snapshot = await this.#require(job.callId);
    if (["completed", "failed", "stopped"].includes(snapshot.brief.status)) {
      return;
    }
    const attempt = await this.repository.getLatestAttempt(job.callId);
    if (
      !attempt ||
      attempt.id !== job.callAttemptId ||
      !attempt.providerCallId
    ) {
      throw new DurableJobExecutionError("PROVIDER_CALL_TARGET_MISSING");
    }
    try {
      const provider = await this.telephonyProvider.getCallStatus(
        attempt.providerCallId
      );
      const reconciled = await this.handleTwilioStatus(
        provider.providerCallId,
        provider.status,
        job.callId,
        currentLease(lease)
      );
      if (!reconciled) {
        throw new DurableJobExecutionError("PROVIDER_CALL_TARGET_MISSING");
      }
      if (!["completed", "failed", "stopped"].includes(
        reconciled.brief.status
      )) {
        await this.telephonyProvider.stopCall(provider.providerCallId);
        throw new DurableJobExecutionError("PROVIDER_CALL_STOP_PENDING");
      }
    } catch (error) {
      if (error instanceof DurableJobExecutionError) throw error;
      throw new DurableJobExecutionError(
        providerReconciliationFailureCode(error, "PROVIDER_CALL_FETCH_FAILED"),
        { cause: error }
      );
    }
  }

  async #reconcileProviderRecording(job: DurableJob, lease: DurableJobLease) {
    if (!job.recordingId || !this.telephonyProvider.getRecordingStatus) {
      throw new DurableJobExecutionError("DURABLE_JOB_TARGET_INVALID");
    }
    const snapshot = await this.#require(job.callId);
    const recording = snapshot.recording;
    if (!recording || recording.id !== job.recordingId) {
      throw new DurableJobExecutionError("PROVIDER_RECORDING_TARGET_MISSING");
    }
    if (["available", "failed", "deleted"].includes(recording.status)) {
      return;
    }
    if (!recording.providerRecordingId) {
      throw new DurableJobExecutionError("PROVIDER_RECORDING_TARGET_MISSING");
    }
    const attempt = await this.repository.getLatestAttempt(job.callId);
    if (!attempt?.providerCallId) {
      throw new DurableJobExecutionError("PROVIDER_CALL_TARGET_MISSING");
    }
    try {
      const provider = await this.telephonyProvider.getRecordingStatus(
        recording.providerRecordingId
      );
      if (provider.status === "pending") {
        throw new DurableJobExecutionError("PROVIDER_RECORDING_PENDING");
      }
      const reconciled = await this.handleTwilioRecordingStatus({
        callBriefId: job.callId,
        recordingId: recording.id,
        providerCallId: attempt.providerCallId,
        providerRecordingId: provider.providerRecordingId,
        providerStatus: provider.status,
        durationSeconds: provider.durationSeconds,
        channels: provider.channels,
        startedAt: provider.startedAt,
        failureReason: provider.failureReason
      }, currentLease(lease));
      if (!reconciled) {
        throw new DurableJobExecutionError(
          "PROVIDER_RECORDING_TARGET_MISSING"
        );
      }
    } catch (error) {
      if (error instanceof DurableJobExecutionError) throw error;
      throw new DurableJobExecutionError(
        providerReconciliationFailureCode(
          error,
          "PROVIDER_RECORDING_FETCH_FAILED"
        ),
        { cause: error }
      );
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
    if (["completed", "failed", "stopped"].includes(status)) {
      this.#clearTimers(id);
    }
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
    if (["completed", "failed", "stopped"].includes(status)) {
      await this.#syncSystemOutcome(id);
    }
    return snapshot;
  }

  async #syncSystemOutcome(id: string) {
    try {
      return await this.repository.recordSystemCallOutcome(id);
    } catch (error) {
      this.#onBackgroundError(error);
      return null;
    }
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
    timer.unref();

    const timers = this.#timers.get(id) ?? new Set<NodeJS.Timeout>();
    timers.add(timer);
    this.#timers.set(id, timers);
  }

  #clearTimers(id: string) {
    for (const timer of this.#timers.get(id) ?? []) clearTimeout(timer);
    this.#timers.delete(id);
  }

  #providerReconciliationDeadline(graceMs: number) {
    return new Date(
      Date.now() + this.#admissionPolicy.maxDurationSeconds * 1_000 + graceMs
    ).toISOString();
  }

  #publish(id: string, event: CallEvent) {
    for (const subscriber of this.#subscribers.get(id) ?? []) subscriber(event);
    if (
      event.type === "transcript.delta" ||
      !["publish", "both"].includes(this.#liveEventMode)
    ) return;
    const publication = this.repository.publishCallChange({
      sourceId: this.#sourceId,
      callId: id
    });
    this.#pendingCallChangePublications.add(publication);
    void publication.catch(this.#onBackgroundError).finally(() => {
      this.#pendingCallChangePublications.delete(publication);
    });
  }

  async #handleRemoteCallChange(signal: CallChangeSignal) {
    if (
      signal.sourceId === this.#sourceId ||
      !this.#subscribers.has(signal.callId)
    ) return;
    const snapshot = await this.repository.get(signal.callId);
    if (!snapshot) return;
    for (const subscriber of this.#subscribers.get(signal.callId) ?? []) {
      subscriber({ type: "call.updated", brief: snapshot.brief });
    }
  }

  async #require(id: string): Promise<CallSnapshot> {
    const snapshot = await this.repository.get(id);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    return snapshot;
  }
}

function externalWorkerView(
  mode: DurableWorkerMode,
  facts: {
    healthyInstances: number;
    staleInstances: number;
    activeJobs: number;
    lastSeenAt: string | null;
  },
  generatedAt: string
) {
  if (mode === "embedded") {
    return {
      state: "not_applicable" as const,
      healthyInstances: 0,
      staleInstances: 0,
      activeJobs: 0,
      lastSeenAt: null,
      lastSeenAgeSeconds: null
    };
  }
  return {
    state: facts.healthyInstances > 0
      ? "healthy" as const
      : facts.staleInstances > 0
        ? "stale" as const
        : "offline" as const,
    ...facts,
    lastSeenAgeSeconds: facts.lastSeenAt
      ? Math.max(
          0,
          Math.floor(
            (Date.parse(generatedAt) - Date.parse(facts.lastSeenAt)) / 1_000
          )
        )
      : null
  };
}

function transcriptionFailureCode(error: unknown) {
  if (error instanceof PostCallTranscriptionError) return error.code;
  if (error instanceof Error && error.message.startsWith("TWILIO_")) {
    return error.message.slice(0, 120);
  }
  return "POST_CALL_TRANSCRIPTION_FAILED";
}

function recordingRetentionFailureCode(error: unknown) {
  if (error instanceof Error && error.message.startsWith("TWILIO_")) {
    return error.message.slice(0, 120);
  }
  if (
    error instanceof CallRepositoryError &&
    error.code === "DURABLE_JOB_LEASE_LOST"
  ) {
    return error.code;
  }
  return "RECORDING_RETENTION_DELETE_FAILED";
}

function providerReconciliationFailureCode(
  error: unknown,
  fallback: string
) {
  if (error instanceof Error && error.message.startsWith("TWILIO_")) {
    return error.message.slice(0, 120);
  }
  if (
    error instanceof CallRepositoryError &&
    error.code === "DURABLE_JOB_LEASE_LOST"
  ) {
    return error.code;
  }
  return fallback;
}

function currentLease(lease: DurableJobLease): DurableJobLease {
  return { ...lease, checkedAt: new Date().toISOString() };
}

function adminWebhookDeliveryView(
  facts: AdminWebhookDeliveryFacts,
  generatedAt: string
) {
  return {
    ...facts,
    lastAcceptedAgeSeconds: facts.lastAcceptedAt
      ? Math.max(0, Math.floor(
          (Date.parse(generatedAt) - Date.parse(facts.lastAcceptedAt)) / 1_000
        ))
      : null
  };
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
