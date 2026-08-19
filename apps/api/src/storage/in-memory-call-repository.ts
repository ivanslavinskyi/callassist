import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  parseSwissDestinationPhone,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallBrief,
  type CallCompilation,
  type CreditTransaction,
  type CreditUsage,
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
  creditSettlementForStatus,
  defaultCallAdmissionPolicy,
  encodeCallBriefCursor,
  shouldApplyProviderCallStatus,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallRepository,
  type ListCallBriefsInput,
  type RecordingStatusInput,
  type RecipientSuppressionInput,
  type SafetyControlInput,
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
  readonly #owners = new Map<string, string | null>();
  readonly #attempts = new Map<string, CallAttemptRecord[]>();
  readonly #creditTransactions: Array<
    CreditTransaction & { userId: string; idempotencyKey: string }
  > = [];
  readonly #recipientSuppressions = new Map<
    string,
    RecipientSuppressionInput & { createdAt: string }
  >();
  #outboundCallsEnabled = true;

  async list(input: ListCallBriefsInput) {
    const filtered = [...this.#calls.values()]
      .filter(({ brief }) =>
        this.#owners.get(brief.id) === (input.userId ?? null)
      )
      .map(({ brief }) => copy(brief))
      .filter((brief) => !input.status || brief.status === input.status)
      .filter((brief) =>
        !input.search || brief.recipientName.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())
      )
      .filter((brief) =>
        !input.cursor || brief.createdAt < input.cursor.createdAt ||
          (brief.createdAt === input.cursor.createdAt && brief.id < input.cursor.id)
      )
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      );
    const items = filtered.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: filtered.length > input.limit && last
        ? encodeCallBriefCursor({ createdAt: last.createdAt, id: last.id })
        : null
    };
  }

  async create(
    input: CreateCallBriefInput,
    compilation: CallCompilation,
    userId: string | null = null
  ) {
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
    this.#owners.set(brief.id, userId);

    return copy(brief);
  }

  async isOwnedBy(id: string, userId: string | null) {
    return this.#calls.has(id) && this.#owners.get(id) === userId;
  }

  async grantSignupCredits(userId: string) {
    const idempotencyKey = `signup:${userId}`;
    if (!this.#creditTransactions.some((entry) => entry.idempotencyKey === idempotencyKey)) {
      this.#creditTransactions.push({
        id: randomUUID(),
        userId,
        amount: 3,
        type: "signup_grant",
        callAttemptId: null,
        promoRedemptionId: null,
        adminId: null,
        reason: "Phone verification signup grant",
        idempotencyKey,
        createdAt: new Date().toISOString()
      });
    }
    return this.#buildCreditUsage(userId);
  }

  async getCreditUsage(userId: string): Promise<CreditUsage> {
    return this.#buildCreditUsage(userId);
  }

  async suppressRecipient(input: RecipientSuppressionInput) {
    const phoneE164 = requireSwissPhone(input.phoneE164);
    const reason = requireReason(input.reason);
    if (!this.#recipientSuppressions.has(phoneE164)) {
      this.#recipientSuppressions.set(phoneE164, {
        ...input,
        phoneE164,
        reason,
        createdAt: new Date().toISOString()
      });
    }
  }

  async liftRecipientSuppression(
    phoneE164: string,
    input: SafetyControlInput
  ) {
    requireReason(input.reason);
    this.#recipientSuppressions.delete(requireSwissPhone(phoneE164));
  }

  async setOutboundCallsEnabled(
    enabled: boolean,
    input: SafetyControlInput
  ) {
    requireReason(input.reason);
    this.#outboundCallsEnabled = enabled;
  }

  #buildCreditUsage(userId: string): CreditUsage {
    const transactions = this.#creditTransactions
      .filter((entry) => entry.userId === userId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      )
      .map(({ userId: _userId, idempotencyKey: _key, ...entry }) => copy(entry));
    let activeCallBriefId: string | null = null;
    for (const [callBriefId, attempts] of this.#attempts) {
      if (
        this.#owners.get(callBriefId) === userId &&
        attempts.some((attempt) => attempt.endedAt === null)
      ) {
        activeCallBriefId = callBriefId;
        break;
      }
    }
    return {
      balance: transactions.reduce((total, entry) => total + entry.amount, 0),
      activeCallBriefId,
      transactions
    };
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
    const userId = input.userId ?? null;
    if (userId !== null && this.#owners.get(id) !== userId) {
      throw new CallRepositoryError("CALL_NOT_FOUND");
    }
    if (snapshot.brief.status !== "ready") {
      throw new CallRepositoryError("CALL_NOT_READY");
    }
    if (!this.#outboundCallsEnabled) {
      throw new CallRepositoryError("OUTBOUND_CALLS_DISABLED");
    }
    if (this.#recipientSuppressions.has(snapshot.brief.phoneNumber)) {
      throw new CallRepositoryError("RECIPIENT_SUPPRESSED");
    }
    if (userId !== null) {
      const usage = this.#buildCreditUsage(userId);
      if (usage.activeCallBriefId) {
        throw new CallRepositoryError("CONCURRENT_CALL_LIMIT");
      }
      if (usage.balance < 1) {
        throw new CallRepositoryError("INSUFFICIENT_CREDITS");
      }
      this.#assertWithinCallLimits(
        userId,
        snapshot.brief.phoneNumber,
        input.admissionPolicy ?? defaultCallAdmissionPolicy
      );
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
    if (userId !== null) {
      this.#creditTransactions.push({
        id: randomUUID(),
        userId,
        amount: -1,
        type: "call_reservation",
        callAttemptId: attempt.id,
        promoRedemptionId: null,
        adminId: null,
        reason: "Outbound call credit reservation",
        idempotencyKey: `call:${attempt.id}:reservation`,
        createdAt: now
      });
    }
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
      this.#settleAttempt(
        callId,
        attempt,
        creditSettlementForStatus(attempt.status, providerStatus)
      );
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
      this.#settleAttempt(
        callId,
        attempt,
        creditSettlementForStatus(callStatus, providerStatus)
      );
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
      this.#settleAttempt(
        id,
        attempt,
        creditSettlementForStatus(status)
      );
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
      this.#settleAttempt(id, attempt, "call_refund");
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
        this.#settleAttempt(snapshot.brief.id, attempt, "call_refund");
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

  #assertWithinCallLimits(
    userId: string,
    phoneE164: string,
    policy: import("./call-repository").CallAdmissionPolicy
  ) {
    const now = Date.now();
    const hourStart = now - 60 * 60 * 1_000;
    const current = new Date(now);
    const dayStart = Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate()
    );
    const attempts = [...this.#attempts.entries()].flatMap(
      ([callBriefId, callAttempts]) =>
        this.#owners.get(callBriefId) === userId
          ? callAttempts.map((attempt) => ({
              attempt,
              phoneE164: this.#require(callBriefId).brief.phoneNumber
            }))
          : []
    );
    if (
      attempts.filter(({ attempt }) => Date.parse(attempt.startedAt) >= hourStart)
        .length >= policy.maxStartsPerHour
    ) {
      throw new CallRepositoryError("HOURLY_CALL_LIMIT");
    }
    const today = attempts.filter(
      ({ attempt }) => Date.parse(attempt.startedAt) >= dayStart
    );
    if (today.length >= policy.maxStartsPerDay) {
      throw new CallRepositoryError("DAILY_CALL_LIMIT");
    }
    if (
      today.filter((attempt) => attempt.phoneE164 === phoneE164).length >=
      policy.maxStartsPerRecipientPerDay
    ) {
      throw new CallRepositoryError("RECIPIENT_REPEAT_LIMIT");
    }
  }

  #settleAttempt(
    callBriefId: string,
    attempt: CallAttemptRecord,
    type: "call_charge" | "call_refund" | null
  ) {
    if (!type) return;
    const userId = this.#owners.get(callBriefId);
    if (!userId) return;
    const hasReservation = this.#creditTransactions.some(
      (entry) =>
        entry.callAttemptId === attempt.id && entry.type === "call_reservation"
    );
    if (!hasReservation) return;
    const alreadySettled = this.#creditTransactions.some(
      (entry) =>
        entry.callAttemptId === attempt.id &&
        (entry.type === "call_charge" || entry.type === "call_refund")
    );
    if (alreadySettled) return;
    this.#creditTransactions.push({
      id: randomUUID(),
      userId,
      amount: type === "call_refund" ? 1 : 0,
      type,
      callAttemptId: attempt.id,
      promoRedemptionId: null,
      adminId: null,
      reason:
        type === "call_refund"
          ? "Call ended before successful connection"
          : "Provider connection confirmed",
      idempotencyKey: `call:${attempt.id}:${type === "call_refund" ? "refund" : "charge"}`,
      createdAt: new Date().toISOString()
    });
  }

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

function requireSwissPhone(value: string) {
  const parsed = parseSwissDestinationPhone(value);
  if (!parsed) throw new Error("A valid Swiss E.164 phone number is required");
  return parsed;
}

function requireReason(value: string) {
  const reason = value.trim();
  if (!reason) throw new Error("A safety-control reason is required");
  return reason;
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
