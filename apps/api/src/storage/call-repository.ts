import type {
  ApprovalDecision,
  ApprovalRequest,
  CallBrief,
  CallCompilation,
  CallOutcomeMetrics,
  CallOutcomeView,
  CallTelemetryEventInput,
  CreditTransaction,
  CreditUsage,
  DurableCallEvent,
  CallRecording,
  CallLocale,
  CallSnapshot,
  CreateCallBriefInput,
  FinalTranscript,
  FinalTranscriptSegment,
  OwnerCallFeedbackInput,
  PromoCodeSummary,
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
> & {
  userId?: string | null;
  admissionPolicy?: CallAdmissionPolicy;
};

export type CallAdmissionPolicy = {
  maxStartsPerHour: number;
  maxStartsPerDay: number;
  maxStartsPerRecipientPerDay: number;
  maxDurationSeconds: number;
};

export const defaultCallAdmissionPolicy: CallAdmissionPolicy = {
  maxStartsPerHour: 3,
  maxStartsPerDay: 10,
  maxStartsPerRecipientPerDay: 2,
  maxDurationSeconds: 15 * 60
};

export type RecipientSuppressionSource =
  | "recipient_request"
  | "staff"
  | "complaint"
  | "provider";

export type RecipientSuppressionInput = {
  phoneE164: string;
  source: RecipientSuppressionSource;
  reason: string;
  actorUserId?: string | null;
};

export type SafetyControlInput = {
  reason: string;
  actorUserId?: string | null;
};

export type CreatePromoCodeRepositoryInput = Omit<
  PromoCodeSummary,
  "id" | "createdAt"
> & {
  codeHash: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  now: string;
};

export type PromoCodeCreationResult = {
  created: boolean;
  promoCode: PromoCodeSummary;
};

export type RedeemPromoRepositoryInput = {
  codeHash: string;
  userId: string;
  idempotencyKey: string;
  now: string;
};

export type AdminCreditGrantRepositoryInput = {
  actorUserId: string;
  targetUserId: string;
  credits: number;
  reason: string;
  idempotencyKey: string;
  now: string;
};

export type CreditMutationResult = {
  applied: boolean;
  usage: CreditUsage;
};

export type StartAttemptResult = {
  attempt: CallAttemptRecord;
  snapshot: CallSnapshot;
};

export type CallBriefCursor = { createdAt: string; id: string };
export type ListCallBriefsInput = {
  limit: number;
  userId?: string | null;
  cursor?: CallBriefCursor;
  search?: string;
  status?: CallBrief["status"];
};
export type ListCallBriefsResult = {
  items: CallBrief[];
  nextCursor: string | null;
};

export function encodeCallBriefCursor(cursor: CallBriefCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCallBriefCursor(value: string): CallBriefCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { createdAt, id } = parsed as Record<string, unknown>;
    if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) return null;
    if (typeof id !== "string" || !isUuid(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type ProviderStatusResult = {
  callId: string;
  snapshot: CallSnapshot;
};

export type BeginRecordingResult = {
  providerCallId: string;
  recording: CallRecording;
  snapshot: CallSnapshot;
};

export type RecordingStatusInput = {
  recordingId: string;
  callBriefId: string;
  providerCallId: string;
  providerRecordingId: string;
  providerStatus: "in-progress" | "completed" | "absent";
  durationSeconds?: number;
  channels?: number;
  startedAt?: string;
  failureReason?: string;
};

export type RecordingMutationResult = {
  callId: string;
  recording: CallRecording;
  snapshot: CallSnapshot;
};

export type FinalTranscriptMutationResult = {
  callId: string;
  finalTranscript: FinalTranscript;
  snapshot: CallSnapshot;
};

export interface CallRepository {
  readonly mode: "memory" | "postgres";
  list(input: ListCallBriefsInput): Promise<ListCallBriefsResult>;
  create(
    input: CreateCallBriefInput,
    compilation: CallCompilation,
    userId?: string | null
  ): Promise<CallBrief>;
  isOwnedBy(id: string, userId: string | null): Promise<boolean>;
  grantSignupCredits(userId: string): Promise<CreditUsage>;
  getCreditUsage(userId: string): Promise<CreditUsage>;
  createPromoCode(
    input: CreatePromoCodeRepositoryInput
  ): Promise<PromoCodeCreationResult>;
  redeemPromo(
    input: RedeemPromoRepositoryInput
  ): Promise<CreditMutationResult>;
  grantAdminCredits(
    input: AdminCreditGrantRepositoryInput
  ): Promise<CreditMutationResult>;
  suppressRecipient(input: RecipientSuppressionInput): Promise<boolean>;
  liftRecipientSuppression(
    phoneE164: string,
    input: SafetyControlInput
  ): Promise<boolean>;
  setOutboundCallsEnabled(
    enabled: boolean,
    input: SafetyControlInput
  ): Promise<void>;
  recompile(
    id: string,
    input: CreateCallBriefInput,
    compilation: CallCompilation
  ): Promise<CallSnapshot>;
  get(id: string): Promise<CallSnapshot | null>;
  appendCallTelemetryEvent(
    id: string,
    input: CallTelemetryEventInput
  ): Promise<DurableCallEvent>;
  listCallTelemetryEvents(id: string): Promise<DurableCallEvent[]>;
  getCallOutcome(id: string): Promise<CallOutcomeView>;
  recordSystemCallOutcome(id: string): Promise<CallOutcomeView>;
  submitOwnerCallFeedback(
    id: string,
    userId: string,
    input: OwnerCallFeedbackInput
  ): Promise<CallOutcomeView>;
  getCallOutcomeMetrics(): Promise<CallOutcomeMetrics>;
  approveCompilation(id: string): Promise<CallSnapshot>;
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
  beginRecording(id: string): Promise<BeginRecordingResult>;
  attachProviderRecording(
    recordingId: string,
    providerRecordingId: string,
    providerStatus: string
  ): Promise<RecordingMutationResult>;
  failRecording(
    recordingId: string,
    failureReason: string
  ): Promise<RecordingMutationResult>;
  applyRecordingStatus(
    input: RecordingStatusInput
  ): Promise<RecordingMutationResult | null>;
  claimFinalTranscript(
    recordingId: string,
    model: string,
    force?: boolean
  ): Promise<FinalTranscriptMutationResult | null>;
  completeFinalTranscript(
    recordingId: string,
    text: string,
    segments: FinalTranscriptSegment[]
  ): Promise<FinalTranscriptMutationResult>;
  failFinalTranscript(
    recordingId: string,
    failureReason: string
  ): Promise<FinalTranscriptMutationResult>;
  listTranscriptionCandidates(): Promise<string[]>;
  listExpiredRecordingCallIds(now: string): Promise<string[]>;
  markRecordingDeleted(id: string): Promise<RecordingMutationResult>;
  recoverInterruptedCalls(): Promise<number>;
  recoverInterruptedTranscriptions(): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export class CallRepositoryError extends Error {
  constructor(
    readonly code:
      | "CALL_NOT_FOUND"
      | "APPROVAL_NOT_FOUND"
      | "CALL_NOT_READY"
      | "CALL_BRIEF_NOT_REVIEWABLE"
      | "CALL_BRIEF_NOT_EDITABLE"
      | "CALL_ATTEMPT_NOT_FOUND"
      | "INSUFFICIENT_CREDITS"
      | "CONCURRENT_CALL_LIMIT"
      | "OUTBOUND_CALLS_DISABLED"
      | "RECIPIENT_SUPPRESSED"
      | "HOURLY_CALL_LIMIT"
      | "DAILY_CALL_LIMIT"
      | "RECIPIENT_REPEAT_LIMIT"
      | "PROMO_CODE_UNAVAILABLE"
      | "PROMO_GLOBAL_LIMIT_REACHED"
      | "PROMO_USER_LIMIT_REACHED"
      | "PROMO_CODE_ALREADY_EXISTS"
      | "CREDIT_IDEMPOTENCY_CONFLICT"
      | "CREDIT_ADMIN_ACTION_FORBIDDEN"
      | "CREDIT_SELF_GRANT_FORBIDDEN"
      | "CREDIT_USER_NOT_FOUND"
      | "RECORDING_NOT_FOUND"
      | "RECORDING_NOT_AVAILABLE"
      | "CALL_FEEDBACK_NOT_AVAILABLE"
      | "CALL_FEEDBACK_IDEMPOTENCY_CONFLICT",
    message = code
  ) {
    super(message);
    this.name = "CallRepositoryError";
  }
}

export const connectedProviderStatuses = new Set([
  "in-progress",
  "completed"
]);

export function creditSettlementForStatus(
  callStatus: CallBrief["status"],
  providerStatus?: string | null
): Extract<CreditTransaction["type"], "call_charge" | "call_refund"> | null {
  if (
    callStatus === "in_progress" ||
    (providerStatus && connectedProviderStatuses.has(providerStatus))
  ) {
    return "call_charge";
  }
  return terminalStatuses.has(callStatus) ? "call_refund" : null;
}

const terminalStatuses = new Set<CallBrief["status"]>([
  "blocked",
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

export function buildRuntimeBriefFields(
  compilation: CallCompilation
) {
  const compiled = compilation.compiledBrief;
  const status: CallBrief["status"] =
    compilation.policyDecision.status === "ready_for_review"
      ? "review_required"
      : compilation.policyDecision.status;
  if (!compiled) {
    return {
      objective: "This call brief did not pass the policy review.",
      context: "",
      allowedFacts: [] as string[],
      status
    };
  }

  return {
    objective: compiled.localizedObjective,
    context: buildRuntimeContext(compiled),
    allowedFacts: compiled.approvedFacts.map(
      ({ callLanguageText }) => callLanguageText
    ),
    status
  };
}

function buildRuntimeContext(
  compiled: NonNullable<CallCompilation["compiledBrief"]>
) {
  return [
    compiled.backgroundSummary,
    "Conversation settings:",
    `- Addressing: ${compiled.addressingStyle ?? "formal"}`,
    `- Tone: ${compiled.tone}`,
    `- Result handling: ${compiled.resultHandling ?? "capture_in_callassist"}`,
    `- Voicemail: ${compiled.voicemailAction ?? "hang_up"}`,
    "- If the recipient refuses, respect the refusal and end politely.",
    "Ordered questions:",
    ...compiled.orderedQuestions.map(
      ({ text, required }, index) =>
        `${index + 1}. ${text}${required ? " (required)" : ""}`
    ),
    ...(compiled.conditionalFollowUps.length
      ? [
          "Conditional follow-ups:",
          ...compiled.conditionalFollowUps.map(
            ({ condition, question }) => `- If ${condition}: ${question}`
          )
        ]
      : []),
    "Success criteria:",
    ...compiled.successCriteria.map((criterion) => `- ${criterion}`),
    "Unresolved criteria:",
    ...compiled.unresolvedCriteria.map((criterion) => `- ${criterion}`),
    "Stop conditions:",
    ...compiled.stopConditions.map((condition) => `- ${condition}`),
    "Prohibited actions:",
    ...compiled.prohibitedActions.map((action) => `- ${action}`)
  ]
    .filter(Boolean)
    .join("\n");
}
