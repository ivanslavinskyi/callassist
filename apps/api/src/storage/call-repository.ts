import type {
  ApprovalDecision,
  ApprovalRequest,
  CallBrief,
  CallLocale,
  CallSnapshot,
  CreateCallBriefInput,
  TranscriptSegment
} from "@callassist/contracts";

export type ApprovalRequestDraft = Pick<
  ApprovalRequest,
  "category" | "title" | "reason" | "proposedSpeech"
>;

export type ApprovalMutationResult = {
  approval: ApprovalRequest;
  snapshot: CallSnapshot;
};

export type CallAttemptRecord = {
  id: string;
  callBriefId: string;
  provider: "mock" | "twilio";
  providerCallId: string | null;
  status: CallBrief["status"];
  providerStatus: string | null;
  startedAt: string;
  endedAt: string | null;
  failureReason: string | null;
};

export type StartAttemptInput = Pick<
  CallAttemptRecord,
  "provider"
>;

export type StartAttemptResult = {
  attempt: CallAttemptRecord;
  snapshot: CallSnapshot;
};

export type ProviderStatusResult = {
  callId: string;
  snapshot: CallSnapshot;
};

export interface CallRepository {
  readonly mode: "memory" | "postgres";
  list(): Promise<CallBrief[]>;
  create(input: CreateCallBriefInput): Promise<CallBrief>;
  get(id: string): Promise<CallSnapshot | null>;
  getLatestAttempt(id: string): Promise<CallAttemptRecord | null>;
  startAttempt(id: string, input: StartAttemptInput): Promise<StartAttemptResult>;
  attachProviderCall(
    attemptId: string,
    providerCallId: string,
    providerStatus: string
  ): Promise<CallSnapshot>;
  applyProviderStatus(
    providerCallId: string,
    providerStatus: string,
    callStatus: CallBrief["status"],
    callBriefId?: string
  ): Promise<ProviderStatusResult | null>;
  updateStatus(
    id: string,
    status: CallBrief["status"]
  ): Promise<CallSnapshot>;
  addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string,
    locale: CallLocale
  ): Promise<{ segment: TranscriptSegment; snapshot: CallSnapshot }>;
  requestApproval(
    id: string,
    draft: ApprovalRequestDraft
  ): Promise<ApprovalMutationResult>;
  resolveApproval(
    id: string,
    approvalId: string,
    decision: ApprovalDecision["decision"]
  ): Promise<ApprovalMutationResult>;
  stop(id: string): Promise<CallSnapshot>;
  recoverInterruptedCalls(): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export class CallRepositoryError extends Error {
  constructor(
    readonly code:
      | "CALL_NOT_FOUND"
      | "APPROVAL_NOT_FOUND"
      | "CALL_NOT_READY"
      | "CALL_ATTEMPT_NOT_FOUND",
    message = code
  ) {
    super(message);
    this.name = "CallRepositoryError";
  }
}

const terminalStatuses = new Set<CallBrief["status"]>([
  "completed",
  "stopped",
  "failed"
]);

export function shouldApplyProviderCallStatus(
  current: CallBrief["status"],
  next: CallBrief["status"]
) {
  if (terminalStatuses.has(current)) return false;
  if (terminalStatuses.has(next)) return true;
  if (current === "ready") return next === "dialing";
  if (current === "dialing") {
    return next === "dialing" || next === "in_progress";
  }
  return current === next;
}
