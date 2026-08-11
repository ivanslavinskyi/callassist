import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallBrief,
  type CallCompilation,
  type CallRecording,
  type CallLocale,
  type CallSnapshot,
  type CreateCallBriefInput,
  type FinalTranscript,
  type FinalTranscriptSegment,
  type NormalizedCallBriefInput,
  type TranscriptSegment
} from "@callassist/contracts";
import {
  CallRepositoryError,
  buildRuntimeBriefFields,
  shouldApplyProviderCallStatus,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallRepository,
  type RecordingStatusInput,
  type StartAttemptInput
} from "./call-repository";

const interruptedStatuses = new Set<CallBrief["status"]>([
  "dialing",
  "in_progress",
  "awaiting_approval"
]);
const terminalStatuses = new Set<CallBrief["status"]>([
  "blocked",
  "completed",
  "stopped",
  "failed"
]);

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCallRepository implements CallRepository {
  readonly mode = "memory" as const;
  readonly #calls = new Map<string, CallSnapshot>();
  readonly #attempts = new Map<string, CallAttemptRecord[]>();

  async list() {
    return [...this.#calls.values()]
      .map(({ brief }) => copy(brief))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(input: CreateCallBriefInput, compilation: CallCompilation) {
    const parsed = normalizeCreateCallBriefInput(input);
    const runtime = buildRuntimeBriefFields(compilation);
    const now = new Date().toISOString();
    const brief: CallBrief = {
      ...storedBriefIdentity(parsed),
      ...runtime,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    };

    this.#calls.set(brief.id, {
      brief,
      compilation: copy(compilation),
      transcript: [],
      pendingApproval: null,
      recording: null,
      finalTranscript: null
    });

    return copy(brief);
  }

  async recompile(
    id: string,
    input: CreateCallBriefInput,
    compilation: CallCompilation
  ) {
    const snapshot = this.#require(id);
    if (
      !["review_required", "needs_clarification", "blocked", "ready"].includes(
        snapshot.brief.status
      ) ||
      (this.#attempts.get(id)?.length ?? 0) > 0
    ) {
      throw new CallRepositoryError("CALL_BRIEF_NOT_EDITABLE");
    }
    const parsed = normalizeCreateCallBriefInput(input);
    const runtime = buildRuntimeBriefFields(compilation);
    const now = new Date().toISOString();
    snapshot.brief = {
      ...storedBriefIdentity(parsed),
      ...runtime,
      id,
      createdAt: snapshot.brief.createdAt,
      updatedAt: now
    };
    snapshot.compilation = copy(compilation);
    snapshot.pendingApproval = null;
    return copy(snapshot);
  }

  async get(id: string) {
    const snapshot = this.#calls.get(id);
    return snapshot ? copy(snapshot) : null;
  }

  async approveCompilation(id: string) {
    const snapshot = this.#require(id);
    if (
      snapshot.brief.status !== "review_required" ||
      snapshot.compilation?.policyDecision.status !== "ready_for_review" ||
      !snapshot.compilation.compiledBrief
    ) {
      throw new CallRepositoryError("CALL_BRIEF_NOT_REVIEWABLE");
    }
    const now = new Date().toISOString();
    snapshot.compilation.approvedAt = now;
    snapshot.brief.status = "ready";
    snapshot.brief.updatedAt = now;
    return copy(snapshot);
  }

  async getLatestAttempt(id: string) {
    this.#require(id);
    const attempts = this.#attempts.get(id) ?? [];
    return attempts.length > 0 ? copy(attempts[attempts.length - 1]!) : null;
  }

  async startAttempt(id: string, input: StartAttemptInput) {
    const snapshot = this.#require(id);
    if (snapshot.brief.status !== "ready") {
      throw new CallRepositoryError("CALL_NOT_READY");
    }
    const now = new Date().toISOString();
    const attempt: CallAttemptRecord = {
      id: randomUUID(),
      callBriefId: id,
      provider: input.provider,
      providerCallId: null,
      status: "dialing",
      providerStatus: null,
      startedAt: now,
      endedAt: null,
      failureReason: null
    };
    const attempts = this.#attempts.get(id) ?? [];
    attempts.push(attempt);
    this.#attempts.set(id, attempts);
    snapshot.brief.status = "dialing";
    snapshot.brief.updatedAt = now;
    return { attempt: copy(attempt), snapshot: copy(snapshot) };
  }

  async attachProviderCall(
    attemptId: string,
    providerCallId: string,
    providerStatus: string
  ) {
    for (const [callId, attempts] of this.#attempts) {
      const attempt = attempts.find((candidate) => candidate.id === attemptId);
      if (!attempt) continue;
      if (
        attempt.providerCallId &&
        attempt.providerCallId !== providerCallId
      ) {
        throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
      }
      if (!attempt.providerCallId) {
        attempt.providerCallId = providerCallId;
        attempt.providerStatus = providerStatus;
      }
      return copy(this.#require(callId));
    }
    throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
  }

  async applyProviderStatus(
    providerCallId: string,
    providerStatus: string,
    callStatus: CallBrief["status"],
    callBriefId?: string
  ) {
    for (const [callId, attempts] of this.#attempts) {
      const attempt = attempts.find(
        (candidate) =>
          candidate.providerCallId === providerCallId ||
          (candidate.providerCallId === null && callId === callBriefId)
      );
      if (!attempt) continue;
      const snapshot = this.#require(callId);
      const now = new Date().toISOString();
      attempt.providerCallId ??= providerCallId;
      attempt.providerStatus = providerStatus;
      if (terminalStatuses.has(callStatus)) attempt.endedAt ??= now;
      if (callStatus === "failed") attempt.failureReason ??= providerStatus;
      if (shouldApplyProviderCallStatus(snapshot.brief.status, callStatus)) {
        attempt.status = callStatus;
        snapshot.brief.status = callStatus;
        snapshot.brief.updatedAt = now;
      }
      if (
        terminalStatuses.has(callStatus) &&
        (snapshot.recording?.status === "starting" ||
          snapshot.recording?.status === "recording")
      ) {
        snapshot.recording.status = "processing";
      }
      return { callId, snapshot: copy(snapshot) };
    }
    return null;
  }

  async updateStatus(id: string, status: CallBrief["status"]) {
    const snapshot = this.#require(id);
    snapshot.brief.status = status;
    snapshot.brief.updatedAt = new Date().toISOString();
    const attempts = this.#attempts.get(id) ?? [];
    const attempt = attempts[attempts.length - 1];
    if (attempt) {
      attempt.status = status;
      if (terminalStatuses.has(status)) attempt.endedAt = snapshot.brief.updatedAt;
    }
    return copy(snapshot);
  }

  async addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string,
    locale: CallLocale
  ) {
    const snapshot = this.#require(id);
    const segment: TranscriptSegment = {
      id: randomUUID(),
      role,
      text,
      locale,
      final: true,
      createdAt: new Date().toISOString()
    };
    snapshot.transcript.push(segment);
    return { segment: copy(segment), snapshot: copy(snapshot) };
  }

  async requestApproval(id: string, draft: ApprovalRequestDraft) {
    const snapshot = this.#require(id);
    const approval: ApprovalRequest = {
      ...draft,
      id: randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString()
    };
    snapshot.pendingApproval = approval;
    snapshot.brief.status = "awaiting_approval";
    snapshot.brief.updatedAt = new Date().toISOString();
    return { approval: copy(approval), snapshot: copy(snapshot) };
  }

  async resolveApproval(
    id: string,
    approvalId: string,
    decision: ApprovalDecision["decision"]
  ) {
    const snapshot = this.#require(id);
    const approval = snapshot.pendingApproval;
    if (!approval || approval.id !== approvalId || approval.status !== "pending") {
      throw new CallRepositoryError("APPROVAL_NOT_FOUND");
    }

    approval.status = decision;
    snapshot.pendingApproval = null;
    snapshot.brief.status = "in_progress";
    snapshot.brief.updatedAt = new Date().toISOString();
    return { approval: copy(approval), snapshot: copy(snapshot) };
  }

  async stop(id: string) {
    const snapshot = this.#require(id);
    if (terminalStatuses.has(snapshot.brief.status)) return copy(snapshot);
    if (snapshot.pendingApproval) snapshot.pendingApproval.status = "expired";
    snapshot.pendingApproval = null;
    snapshot.brief.status = "stopped";
    snapshot.brief.updatedAt = new Date().toISOString();
    const attempts = this.#attempts.get(id) ?? [];
    const attempt = attempts[attempts.length - 1];
    if (attempt) {
      attempt.status = "stopped";
      attempt.endedAt = snapshot.brief.updatedAt;
    }
    if (
      snapshot.recording?.status === "starting" ||
      snapshot.recording?.status === "recording"
    ) {
      snapshot.recording.status = "processing";
    }
    return copy(snapshot);
  }

  async beginRecording(id: string) {
    const snapshot = this.#require(id);
    const attempts = this.#attempts.get(id) ?? [];
    const attempt = attempts[attempts.length - 1];
    if (
      !attempt?.providerCallId ||
      attempt.provider !== "twilio" ||
      terminalStatuses.has(attempt.status)
    ) {
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    if (snapshot.recording) {
      throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    }
    const consentGrantedAt = new Date().toISOString();
    const recording: CallRecording = {
      id: randomUUID(),
      status: "starting",
      providerRecordingId: null,
      consentGrantedAt,
      startedAt: null,
      completedAt: null,
      durationSeconds: null,
      channels: null,
      deleteAfter: null,
      deletedAt: null,
      failureReason: null
    };
    snapshot.recording = recording;
    return {
      providerCallId: attempt.providerCallId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  async attachProviderRecording(
    recordingId: string,
    providerRecordingId: string,
    _providerStatus: string
  ) {
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    recording.providerRecordingId = providerRecordingId;
    if (recording.status === "starting") recording.status = "recording";
    recording.startedAt ??= new Date().toISOString();
    if (recording.status !== "failed") recording.failureReason = null;
    return {
      callId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  async failRecording(recordingId: string, failureReason: string) {
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    if (recording.status === "starting" || recording.status === "recording") {
      recording.status = "failed";
      recording.failureReason = failureReason;
    }
    return {
      callId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  async applyRecordingStatus(input: RecordingStatusInput) {
    const snapshot = this.#calls.get(input.callBriefId);
    if (!snapshot?.recording || snapshot.recording.id !== input.recordingId) {
      return null;
    }
    const attempt = (this.#attempts.get(input.callBriefId) ?? []).find(
      (candidate) => candidate.providerCallId === input.providerCallId
    );
    if (!attempt) return null;
    const recording = snapshot.recording;
    if (
      recording.providerRecordingId &&
      recording.providerRecordingId !== input.providerRecordingId
    ) {
      return null;
    }
    recording.providerRecordingId = input.providerRecordingId;
    recording.durationSeconds = input.durationSeconds ?? recording.durationSeconds;
    recording.channels = input.channels ?? recording.channels;
    recording.startedAt = input.startedAt ?? recording.startedAt;
    if (
      input.providerStatus === "in-progress" &&
      recording.status !== "available" &&
      recording.status !== "processing" &&
      recording.status !== "deleted"
    ) {
      recording.status = "recording";
      recording.startedAt ??= new Date().toISOString();
    } else if (input.providerStatus === "completed") {
      if (recording.status !== "deleted") {
        recording.status = "available";
        recording.completedAt ??= new Date().toISOString();
      }
    } else if (
      input.providerStatus === "absent" &&
      recording.status !== "available" &&
      recording.status !== "deleted"
    ) {
      recording.status = "failed";
      recording.failureReason = input.failureReason ?? "recording_absent";
    }
    return {
      callId: input.callBriefId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  async claimFinalTranscript(recordingId: string, model: string, force = false) {
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    if (recording.status !== "available") return null;
    if (snapshot.finalTranscript?.status === "completed" && !force) return null;
    if (snapshot.finalTranscript?.status === "processing") return null;
    const now = new Date().toISOString();
    const finalTranscript: FinalTranscript = snapshot.finalTranscript
      ? {
          ...snapshot.finalTranscript,
          status: "processing",
          text: null,
          segments: [],
          model,
          failureReason: null,
          updatedAt: now,
          completedAt: null
        }
      : {
          id: randomUUID(),
          status: "processing",
          text: null,
          segments: [],
          model,
          failureReason: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null
        };
    snapshot.finalTranscript = finalTranscript;
    return {
      callId,
      finalTranscript: copy(finalTranscript),
      snapshot: copy(snapshot)
    };
  }

  async completeFinalTranscript(
    recordingId: string,
    text: string,
    segments: FinalTranscriptSegment[]
  ) {
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    const finalTranscript = snapshot.finalTranscript;
    if (!finalTranscript) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    const now = new Date();
    finalTranscript.status = "completed";
    finalTranscript.text = text;
    finalTranscript.segments = copy(segments);
    finalTranscript.failureReason = null;
    finalTranscript.updatedAt = now.toISOString();
    finalTranscript.completedAt = now.toISOString();
    recording.deleteAfter = new Date(
      now.getTime() + snapshot.brief.audioRetentionDays * 86_400_000
    ).toISOString();
    return {
      callId,
      finalTranscript: copy(finalTranscript),
      snapshot: copy(snapshot)
    };
  }

  async failFinalTranscript(recordingId: string, failureReason: string) {
    const { callId, snapshot } = this.#requireRecording(recordingId);
    const finalTranscript = snapshot.finalTranscript;
    if (!finalTranscript) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    finalTranscript.status = "failed";
    finalTranscript.text = null;
    finalTranscript.segments = [];
    finalTranscript.failureReason = failureReason;
    finalTranscript.updatedAt = new Date().toISOString();
    return {
      callId,
      finalTranscript: copy(finalTranscript),
      snapshot: copy(snapshot)
    };
  }

  async listTranscriptionCandidates() {
    return [...this.#calls.values()]
      .filter(
        (snapshot) =>
          snapshot.recording?.status === "available" &&
          snapshot.finalTranscript?.status !== "completed" &&
          snapshot.finalTranscript?.status !== "processing"
      )
      .map((snapshot) => snapshot.recording!.id);
  }

  async listExpiredRecordingCallIds(now: string) {
    return [...this.#calls.values()]
      .filter(
        (snapshot) =>
          snapshot.recording?.status === "available" &&
          snapshot.recording.deleteAfter !== null &&
          snapshot.recording.deleteAfter <= now
      )
      .map((snapshot) => snapshot.brief.id);
  }

  async markRecordingDeleted(id: string) {
    const snapshot = this.#require(id);
    const recording = snapshot.recording;
    if (!recording) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    recording.status = "deleted";
    recording.deletedAt = new Date().toISOString();
    return { callId: id, recording: copy(recording), snapshot: copy(snapshot) };
  }

  async recoverInterruptedCalls() {
    let recovered = 0;
    for (const snapshot of this.#calls.values()) {
      if (!interruptedStatuses.has(snapshot.brief.status)) continue;
      if (snapshot.pendingApproval) snapshot.pendingApproval.status = "expired";
      snapshot.pendingApproval = null;
      snapshot.brief.status = "failed";
      snapshot.brief.updatedAt = new Date().toISOString();
      const attempts = this.#attempts.get(snapshot.brief.id) ?? [];
      const attempt = attempts[attempts.length - 1];
      if (attempt) {
        attempt.status = "failed";
        attempt.endedAt = snapshot.brief.updatedAt;
        attempt.failureReason = "server_restarted";
      }
      recovered += 1;
    }
    return recovered;
  }

  async recoverInterruptedTranscriptions() {
    let recovered = 0;
    for (const snapshot of this.#calls.values()) {
      if (snapshot.finalTranscript?.status !== "processing") continue;
      snapshot.finalTranscript.status = "failed";
      snapshot.finalTranscript.failureReason = "server_restarted";
      snapshot.finalTranscript.updatedAt = new Date().toISOString();
      recovered += 1;
    }
    return recovered;
  }

  async ping() {}

  async close() {}

  #require(id: string) {
    const snapshot = this.#calls.get(id);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    return snapshot;
  }

  #requireRecording(recordingId: string) {
    for (const [callId, snapshot] of this.#calls) {
      if (snapshot.recording?.id === recordingId) {
        return { callId, snapshot, recording: snapshot.recording };
      }
    }
    throw new CallRepositoryError("RECORDING_NOT_FOUND");
  }
}

function storedBriefIdentity(parsed: NormalizedCallBriefInput) {
  return {
    recipientName: parsed.recipientName,
    phoneNumber: parsed.phoneNumber,
    assistantProfileId: parsed.assistantProfileId,
    agentName: parsed.agentName,
    representedPerson: parsed.representedPerson,
    assistanceReason: parsed.assistanceReason,
    assistanceDisclosure: parsed.assistanceDisclosure,
    locale: parsed.locale,
    voiceGender: parsed.voiceGender,
    audioRetentionDays: parsed.audioRetentionDays,
    allowLanguageSwitch: parsed.allowLanguageSwitch,
    ...(parsed.fallbackLocale ? { fallbackLocale: parsed.fallbackLocale } : {})
  };
}
