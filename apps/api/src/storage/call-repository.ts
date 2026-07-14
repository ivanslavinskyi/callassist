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

export interface CallRepository {
  readonly mode: "memory" | "postgres";
  list(): Promise<CallBrief[]>;
  create(input: CreateCallBriefInput): Promise<CallBrief>;
  get(id: string): Promise<CallSnapshot | null>;
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
    readonly code: "CALL_NOT_FOUND" | "APPROVAL_NOT_FOUND",
    message = code
  ) {
    super(message);
    this.name = "CallRepositoryError";
  }
}
