import { randomUUID } from "node:crypto";
import {
  createCallBriefInputSchema,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallBrief,
  type CallLocale,
  type CallSnapshot,
  type CreateCallBriefInput,
  type TranscriptSegment
} from "@callassist/contracts";
import {
  CallRepositoryError,
  shouldApplyProviderCallStatus,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallRepository,
  type StartAttemptInput
} from "./call-repository";

const interruptedStatuses = new Set<CallBrief["status"]>([
  "dialing",
  "in_progress",
  "awaiting_approval"
]);
const terminalStatuses = new Set<CallBrief["status"]>([
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

  async create(input: CreateCallBriefInput) {
    const parsed = createCallBriefInputSchema.parse(input);
    const now = new Date().toISOString();
    const brief: CallBrief = {
      ...parsed,
      id: randomUUID(),
      status: "ready",
      createdAt: now,
      updatedAt: now
    };

    this.#calls.set(brief.id, {
      brief,
      transcript: [],
      pendingApproval: null
    });

    return copy(brief);
  }

  async get(id: string) {
    const snapshot = this.#calls.get(id);
    return snapshot ? copy(snapshot) : null;
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
    return copy(snapshot);
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

  async ping() {}

  async close() {}

  #require(id: string) {
    const snapshot = this.#calls.get(id);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    return snapshot;
  }
}
