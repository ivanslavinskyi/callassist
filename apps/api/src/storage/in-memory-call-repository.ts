import { initialPreparationSettings, PreparationPolicyError } from "./preparation-policy-store";
import { preparationSettingsUpdateSchema, preparationProfileAdmissionSchema, preparationProfileKey, preparationCheckpointSchema, type PreparationCheckpoint } from "@callassist/contracts";
import { supportsSummaryAssessment, preparationTransportDiagnosticsSchema, consentDisclosureInputSchema, consentDecisionInputSchema, consentEvidenceSchema,
  defaultVoiceConsentRuntimePolicy, voiceConsentRuntimePolicy, voiceConsentSettingsUpdateSchema,
  type ConsentDisclosureInput, type ConsentDecisionInput, type VoiceConsentSettingsUpdate } from "@callassist/contracts";
import { initialVoiceConsentSettings, VoiceConsentPolicyError } from "./voice-consent-policy-store";
import { consentDecisionKey, consentDisclosureKey, requireConsentReceipt, validateConsentGrant } from "./consent-audit";
import { defaultBetaCreditPolicy, type BetaCreditPolicy, type CreditFunding } from "@callassist/contracts";
import { betaCreditPeriod } from "../credits/beta-credit-period";
import { terminalDecisionSchema, type TerminalDecision } from "@callassist/contracts";
import { initialDisclosureProjection } from "@callassist/contracts";
import type { NativeTranscriptCapture, NativeTranscriptResult } from "./native-transcript";
import { createCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { answeringUsage } from "../telephony/answering-usage";
import { transitionAnswering, type AnsweringTransitionInput } from "../telephony/answering-policy";
import { historyObjective } from "./history-objective";
import { voiceActionTransitionAllowed, type VoiceActionInput, type VoiceActionRecord, type VoiceActionTransition } from "./voice-action";
import { assertRetryableCall } from "./call-retry";
import { appointmentPlanExpired } from "@callassist/contracts";
import { assessmentDeadlineMs, assessmentVersion, validateFinalAssessment } from "../credits/final-assessment";
import { InMemoryRecipientOptOutStore } from "./in-memory-recipient-opt-out-store";
import { provesRecipientContact } from "../safety/recipient-opt-out-store";
import type { CallAssessmentRecord, CallTextArtifact } from "@callassist/contracts";
import type { FinalCreditEvidence } from "./postgres-call-assessment-store";
import { deriveCallLifecycle, emptyCallLifecycleCounts, countCallLifecycle, callStage, emptyCallStageCounts, summarizeCallFeedback, callFeedbackScope } from "@callassist/contracts";
import { createHash, randomUUID } from "node:crypto";
import { toAdminDurableJob } from "../jobs/admin-durable-job";
import { InMemoryCallTextStore } from "./in-memory-call-text-store";
import type { CallTextRepository, TextArtifactProviderReservationInput } from "./call-text-repository";
import type { CompilationReviewApprovalInput } from "@callassist/contracts";
import type { TextArtifactProviderOperationRecord } from "./call-repository";
import { conversationCreditEvidenceSchema, conversationCreditReason, conversationCreditRefundReason, type ConversationCreditEvidence } from "../credits/conversation-credit";
import {
  CALL_OUTCOME_SCHEMA_VERSION,
  CALL_TELEMETRY_SCHEMA_VERSION,
  adminCallInspectorSchema,
  adminCallListSchema,
  adminCallSensitiveContentSchema,
  adminCallSummarySchema,
  callFeedbackRevisionSchema,
  callOutcomeMetricsSchema,
  callOutcomeRevisionSchema,
  callOutcomeViewSchema,
  callTelemetryEventInputSchema,
  createApprovedExecutionSnapshot,
  deriveTechnicalCallOutcome,
  describeCallTelemetryEvent,
  durableCallEventSchema,
  normalizeCreateCallBriefInput,
  resolveTaskLanguage,
  type CallLanguageContext,
  type TextLanguage,
  ownerCallFeedbackInputSchema,
  parseSwissDestinationPhone,
  semanticOutcomeForGoalResult,
  sensitiveCallAccessInputSchema,
  type AdminCallSummary,
  type ApprovedExecutionSnapshot,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallBrief,
  type CallPreparation,
  type CallCompilation,
  type CompilationApprovalInput,
  type CallFeedbackRevision,
  type CallOutcomeMetrics,
  type CallOutcomeRevision,
  type CallOutcomeView,
  type CallTelemetryEventInput,
  type CreditTransaction,
  type CreditUsage,
  type DurableCallEvent,
  type CallRecording,
  type CallLocale,
  type CallSnapshot,
  type CreateCallBriefInput,
  type FinalTranscript,
  type FinalTranscriptSegment,
  type NormalizedCallBriefInput,
  type OwnerCallFeedbackInput,
  type PromoCodeSummary,
  type TranscriptSegment
} from "@callassist/contracts";
import {
  CallRepositoryError,
  createTelephonyLegResult,
  assertCompilationIntegrity,
  buildRuntimeBriefFields,
  connectedProviderStatuses,
  creditSettlementForStatus,
  defaultCallAdmissionPolicy,
  durableWorkerHeartbeatRetentionMs,
  durableWorkerHeartbeatStaleAfterMs,
  encodeCallBriefCursor,
  encodeAdminCallCursor,
  shouldApplyProviderCallStatus,
  type AdminCreditGrantRepositoryInput,
  type AdminOperationsFacts,
  type AdminProviderCostBucket,
  type AdminProviderUsageBucket,
  type AdminSystemFacts,
  type AdminWebhookDeliveryFacts,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallChangeSignal,
  type CompleteProviderOperationInput,
  type CompletePostCallTranscriptionProviderOperationInput,
  type CallRepository,
  type CallPreparationPublication,
  type PreparationLanguageOptions,
  type CallDataDeletionRecord,
  type CreatePromoCodeRepositoryInput,
  type DeleteCallDataInput,
  type EnqueueCallPreparationRepositoryInput,
  type EnqueueCallRecompilationRepositoryInput,
  type ListCallBriefsInput,
  type ListRecipientSuggestionsInput,
  type ListAdminCallsInput,
  type RecordingStatusInput,
  type RecipientSuppressionInput,
  type RedeemPromoRepositoryInput,
  type SafetyControlInput,
  type StartAttemptInput,
  type ProviderWebhookDeliveryInput,
  type ProviderWebhookKind,
  type ProviderOperationRecord,
  type ProviderOperationReservationInput,
  type PostCallTranscriptionProviderOperationInput,
  type PostCallTranscriptionProviderOperationRecord,
  type PostCallTranscriptionChunkLookupInput,
  type RealtimeProviderOperationInput,
  type RealtimeProviderOperationRecord,
  type RealtimeProviderSessionInput,
  type TelephonyLegUsageInput,
  type TelephonyProviderCostInput,
  type TelephonyProviderOperationInput,
  type TelephonyProviderOperationRecord,
  type ProviderCostRecord,
  type DurableWorkerHeartbeatInput
} from "./call-repository";
import {
  durableJobMaxAttempts,
  type ClaimDurableJobInput,
  type DurableJob,
  type DurableJobAttempt,
  type DurableJobLease,
  type EnqueueDurableJobInput
} from "../jobs/durable-job";

type StoredPromoCode = PromoCodeSummary & {
  codeHash: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
};

type StoredCallTelemetryEvent = {
  event: DurableCallEvent;
  idempotencyKey: string;
};

type StoredCallOutcomeRevision = {
  revision: CallOutcomeRevision;
  idempotencyKey: string;
};

type StoredCallFeedbackRevision = {
  revision: CallFeedbackRevision;
  idempotencyKey: string;
};

type StoredPromoRedemption = {
  id: string;
  promoCodeId: string;
  userId: string;
  redemptionNumber: number;
  credits: number;
  idempotencyKey: string;
  redeemedAt: string;
};

type StoredProviderWebhookBucket = {
  kind: ProviderWebhookKind;
  outcome: ProviderWebhookDeliveryInput["outcome"];
  bucketStartedAt: string;
  deliveryCount: number;
  lastReceivedAt: string;
  lastErrorCode: string | null;
};

type StoredWorkerHeartbeat = DurableWorkerHeartbeatInput & {
  stoppedAt: string | null;
};

type StoredCallPreparation = {
  runtimePolicy: import("@callassist/contracts").PreparationRuntimePolicy;
  language?: PreparationLanguageOptions;
  preparation: Omit<CallPreparation, "attemptCount">;
  userId: string | null;
  idempotencyKey: string;
  inputFingerprint: string;
  input: CreateCallBriefInput | null;
  providerRequestCount: number;
  targetCallBriefId: string | null;
  expectedCompilationId: string | null;
  targetRevision: number;
};

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

function callPreparationFailureCode(
  errorCode: string
): CallPreparation["failureCode"] {
  if (errorCode === "BRIEF_COMPILER_UNAVAILABLE") return errorCode;
  if (errorCode === "BRIEF_COMPILER_RESPONSE_INVALID") return errorCode;
  return "BRIEF_COMPILATION_FAILED";
}

export class InMemoryCallRepository implements CallRepository {
  #preparationSettings = initialPreparationSettings();
  readonly #preparationCheckpoints = new Map<string, PreparationCheckpoint[]>();
  readonly #diagnosticRevokedUsers = new Set<string>();
  readonly #preparationDispatch = new Map<string, string>();
  readonly #preparationPermits = new Map<string, number>();
  readonly #preparationAdmissions = new Map<string, { at: number; tokens: number }>();
  #preparationCooldown = 0;
  async getCompilationPreparationPolicy(callId: string, compilationId: string) {
    const compilation = (this.#compilations.get(callId) ?? []).find(c => c.id === compilationId);
    const work = [...this.#callPreparations.values()].find(p => p.preparation.callBriefId === callId && p.targetRevision === compilation?.revision);
    return work ? copy(work.runtimePolicy) : null;
  }
  async preparationWorkersReady() { return true; }
  async maintainPreparationTelemetry() {}
  async getPreparationRuntimeStatus() { return { workers: [], queue: [], metrics: [] }; }
  async getPreparationSettings() { return copy(this.#preparationSettings); }
  async updatePreparationSettings(input: import("@callassist/contracts").PreparationSettingsUpdate, actorUserId: string) {
    const parsed = preparationSettingsUpdateSchema.parse(input);
    if (parsed.expectedRevision !== this.#preparationSettings.policy.revision) throw new PreparationPolicyError("PREPARATION_REVISION_CONFLICT");
    if (!this.#preparationSettings.approvedProfiles.includes(preparationProfileKey(parsed.generation))) throw new PreparationPolicyError("PREPARATION_PROFILE_NOT_APPROVED");
    this.#preparationSettings.policy.generation = copy(parsed.generation);
    this.#preparationSettings.capacity = copy(parsed.capacity);
    this.#preparationSettings.policy.revision++;
    this.#recordPreparationSettings(actorUserId, parsed.reason, null);
    return this.getPreparationSettings();
  }
  async admitPreparationProfile(input: import("@callassist/contracts").PreparationProfileAdmission, actorUserId: string) {
    const parsed = preparationProfileAdmissionSchema.parse(input);
    if (parsed.expectedRevision !== this.#preparationSettings.policy.revision) throw new PreparationPolicyError("PREPARATION_REVISION_CONFLICT");
    this.#preparationSettings.approvedProfiles = [...new Set([...this.#preparationSettings.approvedProfiles, preparationProfileKey(parsed.profile)])];
    this.#preparationSettings.policy.revision++;
    this.#recordPreparationSettings(actorUserId,parsed.reason,parsed.reportSha256);
    return this.getPreparationSettings();
  }
  #recordPreparationSettings(actorUserId: string, reason: string, reportSha256: string | null) {
    const settings = this.#preparationSettings;
    settings.updatedAt = new Date().toISOString(); settings.updatedByUserId = actorUserId; settings.reason = reason;
    settings.history.unshift({ revision: settings.policy.revision, actorUserId, reason, reportSha256, createdAt: settings.updatedAt,
      generation: copy(settings.policy.generation), capacity: copy(settings.capacity) });
    settings.history = settings.history.slice(0,50);
  }
  async recordPreparationCheckpoint(operationId: string, checkpoint: PreparationCheckpoint) {
    if (!this.#canRecordPreparationDiagnostic(operationId)) return;
    const rows = this.#preparationCheckpoints.get(operationId) ?? [];
    if (!rows.some(row => row.kind === checkpoint.kind)) rows.push(preparationCheckpointSchema.parse(checkpoint));
    this.#preparationCheckpoints.set(operationId, rows);
  }
  #canRecordPreparationDiagnostic(operationId: string) {
    const operation=this.#providerOperations.get(operationId);if(!operation)return false;
    const preparation="callPreparationId" in operation ? this.#callPreparations.get(operation.callPreparationId) : undefined;
    const callId=("callBriefId" in operation ? operation.callBriefId : null) ?? preparation?.preparation.callBriefId ?? preparation?.targetCallBriefId;
    const owner=preparation?.userId ?? (callId ? this.#owners.get(callId) : null);
    return preparation?.preparation.status!=="cancelled" && !(owner && this.#diagnosticRevokedUsers.has(owner)) && !(callId && this.#callDataDeletions.has(callId));
  }
  #admitPreparation(userId: string | null) {
    const active = [...this.#callPreparations.values()].filter(p => ["queued","processing","retrying"].includes(p.preparation.status));
    if (active.length >= this.#preparationSettings.capacity.queueLimit) throw new PreparationPolicyError("PREPARATION_QUEUE_FULL");
    if (active.filter(p => p.userId === userId && p.preparation.status !== "processing").length >= this.#preparationSettings.capacity.perUserWaiting)
      throw new PreparationPolicyError("PREPARATION_USER_QUEUE_FULL");
  }
  #voiceConsentSettings = initialVoiceConsentSettings();
  readonly #consentRuntimePolicies = new Map<string, import("@callassist/contracts").VoiceConsentRuntimePolicy>();
  async getVoiceConsentSettings() { return copy(this.#voiceConsentSettings); }
  async updateVoiceConsentSettings(input: VoiceConsentSettingsUpdate, actorUserId: string) {
    const parsed = voiceConsentSettingsUpdateSchema.parse(input);
    if (parsed.expectedRevision !== this.#voiceConsentSettings.policy.revision) throw new VoiceConsentPolicyError("VOICE_CONSENT_REVISION_CONFLICT");
    this.#voiceConsentSettings = { policy: voiceConsentRuntimePolicy(parsed.mode, parsed.expectedRevision + 1),
      updatedAt: new Date().toISOString(), updatedByUserId: actorUserId, reason: parsed.reason };
    return copy(this.#voiceConsentSettings);
  }
  async getConsentRuntimePolicy(callId: string, attemptId: string) {
    this.#require(callId);
    if (!(this.#attempts.get(callId) ?? []).some(a => a.id === attemptId)) throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    return copy(this.#consentRuntimePolicies.get(attemptId) ?? defaultVoiceConsentRuntimePolicy);
  }
  #consentAttempt(callId: string, attemptId: string) {
    this.#require(callId);
    const attempt = this.#attempts.get(callId)?.at(-1);
    if (!attempt || attempt.id !== attemptId || !["dialing", "in_progress"].includes(attempt.status) || this.#callDataDeletions.has(callId))
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    return attempt;
  }
  async recordConsentDisclosure(callId: string, input: ConsentDisclosureInput) {
    const parsed = consentDisclosureInputSchema.parse(input), attempt = this.#consentAttempt(callId, parsed.callAttemptId);
    if (attempt.compilationSnapshotHash !== parsed.compilationSnapshotHash) throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    const event = this.#appendTelemetry(callId, { callAttemptId: attempt.id,
      idempotencyKey: consentDisclosureKey(parsed),
      occurredAt: parsed.acknowledgedAt, payload: { name: "disclosure.completed", metadata: parsed } });
    if (JSON.stringify(event.payload.metadata) !== JSON.stringify(parsed)) throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    return event.id;
  }
  #recordConsentDecision(callId: string, input: ConsentDecisionInput) {
    const parsed = consentDecisionInputSchema.parse(input);
    this.#consentAttempt(callId, parsed.callAttemptId);
    const events = (this.#callTelemetryEvents.get(callId) ?? []).map(e => e.event);
    requireConsentReceipt(events, parsed.callAttemptId, parsed.disclosureReceiptId);
    const latest = events.findLast(e => e.callAttemptId === parsed.callAttemptId && e.payload.name === "consent.decision");
    if (latest?.payload.name === "consent.decision" && latest.payload.metadata.revision > parsed.revision)
      throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    const event = this.#appendTelemetry(callId, { callAttemptId: parsed.callAttemptId,
      idempotencyKey: consentDecisionKey(parsed), payload: { name: "consent.decision", metadata: parsed } });
    if (JSON.stringify(event.payload.metadata) !== JSON.stringify(parsed)) throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    return event.id;
  }
  async recordConsentDecision(callId: string, input: ConsentDecisionInput) { return this.#recordConsentDecision(callId, input); }
  readonly #betaCreditEnrollments = new Map<string, { id: string; policy: BetaCreditPolicy; activated: boolean;
    lifetimeGrantAllowed: boolean; pending?: { id: string; policy: BetaCreditPolicy; effectiveAt: string } }>();
  readonly #betaCreditPeriods = new Map<string, { id: string; userId: string; policyId: string; startsAt: string; endsAt: string }>();
  /** Explicit synthetic enrollment; production snapshots the policy in account creation's transaction. */
  enrollBetaCredits(userId: string, policy: BetaCreditPolicy, existing = false) {
    const current = this.#betaCreditEnrollments.get(userId), now = new Date();
    if (current && current.policy.amount === policy.amount && current.policy.period === policy.period && !current.pending) return;
    const pending = { id: randomUUID(), policy: copy(policy), effectiveAt: betaCreditPeriod(current?.policy.period ?? "lifetime", now)?.endsAt ?? now.toISOString() };
    if (current && existing && pending.effectiveAt > now.toISOString()) current.pending = pending;
    else this.#betaCreditEnrollments.set(userId, { id: pending.id, policy: copy(policy), activated: current?.activated ?? existing, lifetimeGrantAllowed: !existing });
  }
  #ensureBetaCredits(userId: string) {
    const enrollment = this.#betaCreditEnrollments.get(userId), now = new Date();
    if (!enrollment?.activated) return null;
    if (enrollment.pending && enrollment.pending.effectiveAt <= now.toISOString()) {
      enrollment.id = enrollment.pending.id; enrollment.policy = enrollment.pending.policy;
      enrollment.pending = undefined; enrollment.lifetimeGrantAllowed = false;
    }
    const window = betaCreditPeriod(enrollment.policy.period, now);
    if (!window) return null;
    const key = `${userId}:${enrollment.id}:${window.startsAt}`;
    let period = this.#betaCreditPeriods.get(key);
    if (!period) {
      period = { id: randomUUID(), userId, policyId: enrollment.id, ...window }; this.#betaCreditPeriods.set(key, period);
      this.#creditTransactions.push({ id: randomUUID(), userId, amount: enrollment.policy.amount, type: "beta_grant", callAttemptId: null,
        promoRedemptionId: null, adminId: null, reason: "Beta allowance for UTC calendar period", idempotencyKey: `beta:${period.id}`,
        createdAt: now.toISOString(), betaPeriodId: period.id, expiresAt: period.endsAt });
    }
    return period;
  }
  readonly #voiceActions = new Map<string, VoiceActionRecord>();
  readonly #terminalDecisions = new Map<string, TerminalDecision>();
  async recordTerminalDecision(input: TerminalDecision) {
    const parsed = terminalDecisionSchema.parse(input);
    const attempt = this.#attempts.get(parsed.callBriefId)?.find(a => a.id === parsed.callAttemptId);
    if (!attempt || attempt.compilationSnapshotHash !== parsed.snapshotHash || attempt.endedAt) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
    const key = `${parsed.callAttemptId}:${parsed.revision}`;
    const prior = this.#terminalDecisions.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(parsed)) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    this.#terminalDecisions.set(key, parsed);
  }
  async beginVoiceAction(input: VoiceActionInput) {
    const attempt = (this.#attempts.get(input.callBriefId) ?? []).at(-1);
    if (!attempt || attempt.id !== input.callAttemptId || attempt.compilationSnapshotHash !== input.snapshotHash ||
      !attempt.executionSnapshot || !["dialing", "in_progress"].includes(attempt.status) ||
      [...this.#voiceActions.values()].some(action => action.callAttemptId === input.callAttemptId)) return null;
    const record: VoiceActionRecord = { ...structuredClone(input), id: randomUUID(), version: 1, state: "sending" };
    this.#voiceActions.set(record.id, record); return structuredClone(record);
  }
  async transitionVoiceAction(input: VoiceActionTransition) {
    const record = this.#voiceActions.get(input.id);
    if (!record || record.version !== input.version || !voiceActionTransitionAllowed(record.state, input.state, record.delivery, input.delivery)) return null;
    record.state = input.state; record.version++; record.evidence = [...new Set([...record.evidence, ...input.evidence])];
    if (input.delivery) record.delivery = structuredClone(input.delivery);
    if (input.observations) record.observations = [...new Map([...(record.observations ?? []), ...structuredClone(input.observations)].map(turn => [turn.id, turn])).values()];
    return structuredClone(record);
  }
  readonly #callText = new InMemoryCallTextStore({
    snapshot: id => {
      if(this.#callDataDeletions.has(id)) throw new CallRepositoryError("CALL_NOT_FOUND");
      return this.#require(id);
    },
    textAllowed: id => !this.#textCancelledUsers.has(this.#owners.get(id)??""),
    action: id => this.#voiceActions.get(id),
    compilations: id => this.#compilations.get(id)??[],
    attempt: (id,attemptId) => {
      const recordingId=this.#calls.get(id)?.recording?.id;
      const sourceAttemptId=attemptId??(recordingId?this.#recordingAttempts.get(recordingId):null);
      return sourceAttemptId?this.#attempts.get(id)?.find(row=>row.id===sourceAttemptId):this.#attempts.get(id)?.at(-1);
    },
    enqueue: input => this.enqueueDurableJob(input),
    job: id => this.#findDurableJob(id),
    jobs: () => [...this.#durableJobs.values()],
    complete: artifact => this.#completeAssessment(artifact),
    failure: artifact => this.#failAssessment(artifact)
  });
  readonly mode = "memory" as const;
  readonly recipientOptOut = new InMemoryRecipientOptOutStore(
    phone => this.#recipientSuppressions.has(phone),
    (phoneE164, reason) => this.suppressRecipient({ phoneE164, reason, source: "recipient_request", actorUserId: null })
  );
  readonly #calls = new Map<string, CallSnapshot>();
  readonly #assessments = new Map<string, CallAssessmentRecord>();
  readonly #assessmentRevisions = new Map<string, CallAssessmentRecord>();
  readonly #owners = new Map<string, string | null>();
  readonly #textCancelledUsers = new Set<string>();
  readonly #creationRequests = new Map<
    string,
    { callId: string; userId: string | null }
  >();
  readonly #callPreparations = new Map<string, StoredCallPreparation>();
  readonly #providerOperations = new Map<
    string,
    | ProviderOperationRecord
    | TextArtifactProviderOperationRecord
    | PostCallTranscriptionProviderOperationRecord
    | RealtimeProviderOperationRecord
    | TelephonyProviderOperationRecord
  >();
  readonly #usageSupplements = new Map<string, { durationSeconds: number | null; billableSeconds: number | null }>();
  readonly #providerCosts = new Map<string, ProviderCostRecord>();
  readonly #postCallTranscriptionChunks = new Map<
    string,
    PostCallTranscriptionChunkLookupInput & {
      providerOperationId: string;
      text: string;
    }
  >();
  readonly #callPreparationRequests = new Map<string, string>();
  readonly #attempts = new Map<string, CallAttemptRecord[]>();
  readonly #recordingAttempts = new Map<string,string>();
  readonly #consentedRecordingAttempts = new Set<string>();
  readonly #compilations = new Map<
    string,
    Array<{
      id: string;
      revision: number;
      snapshotHash: string;
      compilation: CallCompilation | null;
      approvedAt: string | null;
      executionSnapshot: ApprovedExecutionSnapshot | null;
    }>
  >();
  readonly #callTelemetryEvents = new Map<
    string,
    StoredCallTelemetryEvent[]
  >();
  readonly #callOutcomeRevisions = new Map<
    string,
    StoredCallOutcomeRevision[]
  >();
  readonly #callFeedbackRevisions = new Map<
    string,
    StoredCallFeedbackRevision[]
  >();
  readonly #callDataDeletions = new Map<string, CallDataDeletionRecord>();
  readonly #sensitiveCallAccessEvents: Array<{
    id: string;
    callBriefId: string;
    actorUserId: string;
    reason: string;
    createdAt: string;
  }> = [];
  readonly #creditTransactions: Array<
    CreditTransaction & { userId: string; idempotencyKey: string }
  > = [];
  readonly #qualifiedCreditAttempts = new Set<string>();
  readonly #promoCodes = new Map<string, StoredPromoCode>();
  readonly #promoCreationIdempotency = new Map<string, string>();
  readonly #promoRedemptions: StoredPromoRedemption[] = [];
  readonly #durableJobs = new Map<string, DurableJob>();
  readonly #durableJobAttempts: DurableJobAttempt[] = [];
  readonly #durableJobAdminEvents: Array<{
    jobId: string;
    actorUserId: string;
    reason: string;
    createdAt: string;
  }> = [];
  readonly #providerWebhookBuckets = new Map<
    string,
    StoredProviderWebhookBucket
  >();
  readonly #callChangeSubscribers = new Set<
    (signal: CallChangeSignal) => void
  >();
  readonly #workerHeartbeats = new Map<string, StoredWorkerHeartbeat>();
  readonly #recipientSuppressions = new Map<
    string,
    RecipientSuppressionInput & { createdAt: string }
  >();
  readonly #safetyEvents: Array<{
    eventType:
      | "recipient.suppressed"
      | "recipient.suppression_lifted"
      | "outbound_calls.enabled"
      | "outbound_calls.disabled";
    actorUserId: string | null;
    phoneE164: string | null;
    source?: RecipientSuppressionInput["source"];
    reason: string;
  }> = [];
  #outboundCallsEnabled = true;
  #outboundCallsReason = "Initial public-beta default";
  #outboundCallsUpdatedAt: string | null = null;

  async list(input: ListCallBriefsInput) {
    const scoped = [...this.#calls.values()]
      .filter(({ brief }) =>
        this.#owners.get(brief.id) === (input.userId ?? null) &&
        !this.#callDataDeletions.has(brief.id)
      )
      .map(({ brief }) => brief)
      .filter((brief) =>
        !input.search || brief.recipientName.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())
      );
    const stageCounts = emptyCallStageCounts();
    for (const brief of scoped) stageCounts[callStage(brief.status)]++;
    const legacyStatusCount = input.status ? scoped.filter(brief => brief.status === input.status).length : null;
    const filtered = scoped
      .filter(brief => !input.stage || callStage(brief.status) === input.stage)
      .filter(brief => !input.status || brief.status === input.status)
      .filter((brief) =>
        !input.cursor || brief.createdAt < input.cursor.createdAt ||
          (brief.createdAt === input.cursor.createdAt && brief.id < input.cursor.id)
      )
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      );
    const items = filtered.slice(0, input.limit).map(brief => ({ ...copy(brief),
      ...historyObjective(this.#calls.get(brief.id)?.compilation, this.#callText.listTextArtifacts(brief.id)), lifecycle: this.#lifecycle(brief),
      feedback: summarizeCallFeedback(this.#callFeedbackRevisions.get(brief.id)?.at(-1)?.revision ?? null,
        (this.#attempts.get(brief.id) ?? []).map(attempt => attempt.startedAt)) }));
    const last = items.at(-1);
    return {
      items,
      stageCounts,
      legacyStatusCount,
      nextCursor: filtered.length > input.limit && last
        ? encodeCallBriefCursor({ createdAt: last.createdAt, id: last.id })
        : null
    };
  }

  async listRecipientSuggestions(input: ListRecipientSuggestionsInput) {
    const query = input.query?.toLocaleLowerCase();
    const seen = new Set<string>();
    const items = [...this.#calls.values()]
      .filter(({ brief }) =>
        this.#owners.get(brief.id) === input.userId &&
        !this.#callDataDeletions.has(brief.id) &&
        brief.phoneNumber.length > 0
      )
      .map(({ brief }) => brief)
      .filter((brief) =>
        !query ||
        brief.recipientName.toLocaleLowerCase().includes(query) ||
        brief.phoneNumber.toLocaleLowerCase().includes(query)
      )
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
      )
      .filter((brief) => {
        const key = `${brief.recipientName.trim().replace(/\s+/g, " ").toLocaleLowerCase()}\0${brief.phoneNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, input.limit)
      .map((brief) => ({
        recipientName: brief.recipientName,
        phoneNumber: brief.phoneNumber,
        lastUsedAt: brief.createdAt
      }));

    return { items };
  }

  async create(
    input: CreateCallBriefInput,
    compilation: CallCompilation,
    userId: string | null = null,
    creationIdempotencyKey: string = randomUUID(),
    publication?: CallPreparationPublication,
    retrySource?: import("./call-repository").CallRetrySource
  ) {
    assertCompilationIntegrity(compilation);
    if (retrySource) {
      if (this.#owners.get(retrySource.callId) !== userId || this.#callDataDeletions.has(retrySource.callId)) throw new CallRepositoryError("CALL_NOT_FOUND");
      const source = await this.get(retrySource.callId);
      const attempt = await this.getLatestAttempt(retrySource.callId);
      if (!source) throw new CallRepositoryError("CALL_NOT_FOUND");
      assertRetryableCall(source, attempt);
      if (attempt?.id !== retrySource.attemptId || source.compilation?.snapshotHash !== compilation.snapshotHash) throw new CallRepositoryError("CALL_COMPILATION_STALE");
    }
    let preparation: StoredCallPreparation | null = null;
    if (publication) {
      this.#assertDurableJobLease(publication.lease);
      const pinned = this.#callPreparations.get(publication.preparationId);
      if (pinned && Date.parse(publication.lease.checkedAt)>=Date.parse(pinned.preparation.createdAt)+pinned.runtimePolicy.timeoutMs)
        throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
      preparation = this.#callPreparations.get(publication.preparationId) ?? null;
      if (
        !preparation ||
        preparation.userId !== userId ||
        preparation.idempotencyKey !== creationIdempotencyKey ||
        ["failed", "cancelled"].includes(preparation.preparation.status)
      ) {
        throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
      }
    }
    const finishPublication = (callBriefId: string) => {
      if (!preparation || !publication) return;
      preparation.preparation = {
        ...preparation.preparation,
        status: "succeeded",
        callBriefId,
        failureCode: null,
        updatedAt: publication.lease.checkedAt,
        completedAt: publication.lease.checkedAt
      };
      preparation.input = null;
      const job = this.#findDurableJob(publication.lease.jobId);
      if (job) job.callId = callBriefId;
    };
    const creationRequest = this.#creationRequests.get(creationIdempotencyKey);
    if (creationRequest) {
      if (
        creationRequest.userId === userId &&
        !this.#callDataDeletions.has(creationRequest.callId)
      ) {
        const existing = this.#calls.get(creationRequest.callId);
        if (existing && (!retrySource || existing.brief.retrySourceCallId === retrySource.callId)) {
          finishPublication(existing.brief.id);
          return copy(existing.brief);
        }
      }
      throw new CallRepositoryError("CALL_CREATION_IDEMPOTENCY_CONFLICT");
    }

    const parsed = normalizeCreateCallBriefInput(input);
    const runtime = buildRuntimeBriefFields(compilation);
    const now = new Date().toISOString();
    const brief: CallBrief = {
      ...storedBriefIdentity(parsed),
      retrySourceCallId: retrySource?.callId ?? null,
      ...runtime,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    };

    this.#calls.set(brief.id, {
      languageContext: resolveTaskLanguage({ preferences: preparation?.language?.preferences, accountPreference: preparation?.language?.accountPreference, detectedLanguage: compilation.compiledBrief?.sourceLanguage, compilationRevision: compilation.revision }),
      executionPlanSource: "immutable",
      brief,
      compilation: copy(compilation),
      transcript: [],
      pendingApproval: null,
      recording: null,
      finalTranscript: null
    });
    this.#compilations.set(brief.id, [{
      id: randomUUID(),
      revision: compilation.revision,
      snapshotHash: compilation.snapshotHash,
      compilation: copy(compilation),
      approvedAt: null,
      executionSnapshot: null
    }]);
    if (retrySource) {
      const source = this.#calls.get(retrySource.callId)!;
      this.#calls.get(brief.id)!.languageContext = copy(source.languageContext);
      const compilationId = this.#compilations.get(brief.id)![0]!.id;
      for (const artifact of this.#callText.listTextArtifacts(retrySource.callId)) {
        if (artifact.kind !== "plan_review" || artifact.status !== "ready" || artifact.sourceHash !== compilation.snapshotHash || !artifact.payload) continue;
        const id = randomUUID();
        this.#callText.artifacts.set(id, { ...copy(artifact), id, callId: brief.id, compilationId, createdAt: now, updatedAt: now, retryable: false });
      }
    }
    this.#owners.set(brief.id, userId);
    this.#creationRequests.set(
      creationIdempotencyKey,
      { callId: brief.id, userId }
    );
    this.#appendTelemetry(brief.id, {
      idempotencyKey: `brief:${compilation.revision}:created`,
      occurredAt: now,
      payload: {
        name: "brief.created",
        metadata: {
          locale: brief.locale,
          compilationRevision: compilation.revision,
          status: brief.status
        }
      }
    });
    if (!retrySource) this.#appendCompilationTelemetry(brief.id, compilation, now);
    finishPublication(brief.id);

    return copy(brief);
  }

  async findByCreationRequest(
    userId: string | null,
    creationIdempotencyKey: string
  ) {
    const request = this.#creationRequests.get(creationIdempotencyKey);
    if (
      !request ||
      request.userId !== userId ||
      this.#callDataDeletions.has(request.callId)
    ) return null;
    const snapshot = this.#calls.get(request.callId);
    return snapshot ? copy(snapshot.brief) : null;
  }

  async enqueueCallPreparation(input: EnqueueCallPreparationRepositoryInput) {
    const requestKey = `${input.userId}:${input.idempotencyKey}`;
    const existingId = this.#callPreparationRequests.get(requestKey);
    if (existingId) {
      const existing = this.#callPreparations.get(existingId)!;
      if (
        existing.inputFingerprint !== input.inputFingerprint ||
        existing.targetCallBriefId !== null
      ) {
        throw new CallRepositoryError(
          "CALL_PREPARATION_IDEMPOTENCY_CONFLICT"
        );
      }
      return this.#mapCallPreparation(existing);
    }

    const id = randomUUID();
    this.#admitPreparation(input.userId);
    const stored: StoredCallPreparation = {
      runtimePolicy: copy(this.#preparationSettings.policy),
      language: input.language ? copy(input.language) : undefined,
      preparation: {
        id,
        status: "queued",
        callBriefId: null,
        failureCode: null,
        createdAt: input.now,
        updatedAt: input.now,
        completedAt: null
      },
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      inputFingerprint: input.inputFingerprint,
      input: copy(input.input),
      providerRequestCount: 0,
      targetCallBriefId: null,
      expectedCompilationId: null,
      targetRevision: 1
    };
    this.#callPreparations.set(id, stored);
    this.#callPreparationRequests.set(requestKey, id);
    try {
      await this.enqueueDurableJob({
        type: "brief_compilation",
        callPreparationId: id,
        runAfter: input.now,
        maxAttempts: durableJobMaxAttempts.brief_compilation
      });
    } catch (error) {
      this.#callPreparations.delete(id);
      this.#callPreparationRequests.delete(requestKey);
      throw error;
    }
    return this.#mapCallPreparation(stored);
  }

  async enqueueCallRecompilation(
    input: EnqueueCallRecompilationRepositoryInput
  ) {
    const requestKey = `${input.userId}:${input.idempotencyKey}`;
    const existingId = this.#callPreparationRequests.get(requestKey);
    if (existingId) {
      const existing = this.#callPreparations.get(existingId)!;
      if (
        existing.inputFingerprint !== input.inputFingerprint ||
        existing.targetCallBriefId !== input.callBriefId
      ) {
        throw new CallRepositoryError(
          "CALL_PREPARATION_IDEMPOTENCY_CONFLICT"
        );
      }
      return this.#mapCallPreparation(existing);
    }

    const snapshot = this.#calls.get(input.callBriefId);
    if (
      !snapshot ||
      this.#owners.get(input.callBriefId) !== input.userId ||
      this.#callDataDeletions.has(input.callBriefId)
    ) {
      throw new CallRepositoryError("CALL_NOT_FOUND");
    }
    if (
      !["review_required", "needs_clarification", "blocked", "ready"].includes(
        snapshot.brief.status
      ) ||
      (this.#attempts.get(input.callBriefId)?.length ?? 0) > 0
    ) {
      throw new CallRepositoryError("CALL_BRIEF_NOT_EDITABLE");
    }
    const active = [...this.#callPreparations.values()].find(
      (stored) =>
        stored.targetCallBriefId === input.callBriefId &&
        ["queued", "processing", "retrying"].includes(
          stored.preparation.status
        )
    );
    if (active) {
      throw new CallRepositoryError("CALL_RECOMPILATION_IN_PROGRESS");
    }
    const currentCompilation = (this.#compilations.get(input.callBriefId) ?? [])
      .find((stored) =>
        stored.revision === snapshot.compilation?.revision &&
        stored.snapshotHash === snapshot.compilation?.snapshotHash
      );
    if (!currentCompilation || !snapshot.compilation) {
      throw new CallRepositoryError("CALL_COMPILATION_INTEGRITY_FAILED");
    }

    const id = randomUUID();
    this.#admitPreparation(input.userId);
    const stored: StoredCallPreparation = {
      runtimePolicy: copy(this.#preparationSettings.policy),
      language: input.language ? copy(input.language) : undefined,
      preparation: {
        id,
        status: "queued",
        callBriefId: null,
        failureCode: null,
        createdAt: input.now,
        updatedAt: input.now,
        completedAt: null
      },
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      inputFingerprint: input.inputFingerprint,
      input: copy(input.input),
      providerRequestCount: 0,
      targetCallBriefId: input.callBriefId,
      expectedCompilationId: currentCompilation.id,
      targetRevision: snapshot.compilation.revision + 1
    };
    this.#callPreparations.set(id, stored);
    this.#callPreparationRequests.set(requestKey, id);
    try {
      await this.enqueueDurableJob({
        type: "brief_compilation",
        callPreparationId: id,
        runAfter: input.now,
        maxAttempts: durableJobMaxAttempts.brief_compilation
      });
    } catch (error) {
      this.#callPreparations.delete(id);
      this.#callPreparationRequests.delete(requestKey);
      throw error;
    }
    return this.#mapCallPreparation(stored);
  }

  async getCallPreparation(id: string, userId: string) {
    const stored = this.#callPreparations.get(id);
    return stored?.userId === userId ? this.#mapCallPreparation(stored) : null;
  }

  async getAdminCallPreparation(id: string) {
    const stored = this.#callPreparations.get(id);
    return stored ? this.#mapCallPreparation(stored) : null;
  }

  readonly #runtimeDescriptors = new Map<string, import("../voice/runtime-descriptor").RuntimeDescriptor>();
  async recordRuntimeDescriptor(callId: string, attemptId: string, descriptor: import("../voice/runtime-descriptor").RuntimeDescriptor) {
    if (this.#callDataDeletions.has(callId) || !this.#calls.has(callId)) throw new CallRepositoryError("CALL_NOT_FOUND");
    if (!(this.#attempts.get(callId) ?? []).some(attempt => attempt.id === attemptId && ["dialing", "in_progress", "awaiting_approval"].includes(attempt.status))) throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    if (!this.#runtimeDescriptors.has(attemptId)) this.#runtimeDescriptors.set(attemptId, copy(descriptor));
  }

  async getPreparationDiagnostics(id: string) {
    const operations = [...this.#providerOperations.values()].filter((operation): operation is ProviderOperationRecord =>
      "callPreparationId" in operation && operation.callPreparationId === id);
    const timeline = operations.sort((a,b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
      .slice(0,100).map(operation => ({ id: operation.id, stage: operation.stage, model: operation.requestedModel,
        startedAt: operation.startedAt, completedAt: operation.result?.completedAt ?? null,
        durationMs: operation.result?.durationMs ?? null, outcome: operation.result?.outcome ?? null,
        errorCode: operation.result?.errorCode ?? null, metadata: operation.requestMetadata ?? null,
        clientRequestId: operation.clientRequestId, providerRequestId: operation.result?.providerRequestId ?? null,
        statusCode: operation.result?.statusCode ?? null, generation: operation.durableJobGeneration ?? null,
        diagnostics: operation.result?.diagnostics ?? null, requestedServiceTier: operation.requestedServiceTier ?? null, actualServiceTier: operation.result?.actualServiceTier ?? null,
        checkpoints: copy(this.#preparationCheckpoints.get(operation.id) ?? []),
        tokens: { input: operation.result?.usage?.inputTextTokens ?? null,
          cachedInput: operation.result?.usage?.cachedInputTextTokens ?? null,
          output: operation.result?.usage?.outputTextTokens ?? null,
          reasoning: operation.result?.usage?.reasoningOutputTokens ?? null } }));
    const preparation = this.#callPreparations.get(id)?.preparation;
    const jobs = (await this.listDurableJobs()).filter(job => job.callPreparationId === id);
    const attempts = (await Promise.all(jobs.map(job => this.listDurableJobAttempts(job.id)))).flat();
    const first = [...attempts.map(attempt => Date.parse(attempt.startedAt)),
      ...jobs.filter(job => job.attemptCount === 1 && job.leasedAt).map(job => Date.parse(job.leasedAt!))]
      .sort((a,b) => a-b)[0];
    return { timeline, initialQueueMs: preparation && first !== undefined ? Math.max(0, first-Date.parse(preparation.createdAt)) : null,
      workerAttempts: attempts.sort((a,b) => a.startedAt.localeCompare(b.startedAt)).map(
        ({ generation, attemptNumber, startedAt, completedAt, outcome, errorCode }) =>
          ({ generation, attemptNumber, startedAt, completedAt, outcome, errorCode })) };
  }

  async findCallPreparationByRequest(
    userId: string | null,
    idempotencyKey: string,
    inputFingerprint: string,
    targetCallBriefId: string | null = null
  ) {
    const id = this.#callPreparationRequests.get(`${userId}:${idempotencyKey}`);
    if (!id) return null;
    const stored = this.#callPreparations.get(id);
    if (!stored) return null;
    if (
      stored.inputFingerprint !== inputFingerprint ||
      stored.targetCallBriefId !== targetCallBriefId
    ) {
      throw new CallRepositoryError("CALL_PREPARATION_IDEMPOTENCY_CONFLICT");
    }
    return this.#mapCallPreparation(stored);
  }

  async claimCallPreparation(id: string, lease: DurableJobLease) {
    this.#assertDurableJobLease(lease);
    const stored = this.#callPreparations.get(id);
    if (!stored) throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
    if (["failed", "cancelled"].includes(stored.preparation.status)) {
      throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
    }
    if (stored.preparation.status !== "succeeded") {
      stored.preparation.status = "processing";
      stored.preparation.updatedAt = lease.checkedAt;
    }
    return copy({
      runtimePolicy: stored.runtimePolicy,
      preparation: this.#mapCallPreparation(stored),
      userId: stored.userId,
      idempotencyKey: stored.idempotencyKey,
      input: stored.input,
      targetCallBriefId: stored.targetCallBriefId,
      expectedCompilationId: stored.expectedCompilationId,
      targetRevision: stored.targetRevision
    });
  }

  async reserveCallPreparationProviderRequest(
    input: ProviderOperationReservationInput,
    lease: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    const job = this.#findDurableJob(lease.jobId);
    const stored = this.#callPreparations.get(input.preparationId);
    if (
      !stored ||
      job?.callPreparationId !== input.preparationId ||
      stored.preparation.status !== "processing"
    ) {
      throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
    }
    if (this.#providerOperations.has(input.id)) return true;
    this.#checkPreparationPermit(input.estimatedTokens);
    if (stored.providerRequestCount >= input.maxRequests) return false;
    const { preparationId, maxRequests: _maxRequests, ...operation } = input;
    this.#preparationPermits.set(input.id,Date.now()+(input.requestMetadata?.timeoutMs ?? 35000)+5000);
    this.#preparationAdmissions.set(input.id,{ at: Date.now(), tokens: input.estimatedTokens ?? 250000 });
    stored.providerRequestCount += 1;
    stored.preparation.updatedAt = lease.checkedAt;
    this.#providerOperations.set(input.id, {
      ...copy(operation),
      callPreparationId: preparationId,
      durableJobId: lease.jobId,
      result: null
    });
    return true;
  }

  async reserveTextArtifactProviderRequest(input:TextArtifactProviderReservationInput,lease:DurableJobLease) {
    const artifact=this.#callText.requireLease(input.artifactId,lease);
    if(input.durableJobGeneration!==lease.generation) throw new CallRepositoryError("DURABLE_JOB_LEASE_LOST");
    const existing=this.#providerOperations.get(input.id);
    if(existing) {
      if(!("artifactId" in existing)||existing.artifactId!==input.artifactId||existing.durableJobId!==lease.jobId) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
      return true;
    }
    this.#checkPreparationPermit(input.estimatedTokens);
    if(!this.#callText.reserveRequest(input.artifactId,input.maxRequests,lease)) return false;
    this.#preparationPermits.set(input.id,Date.now()+125000);
    this.#preparationAdmissions.set(input.id,{ at: Date.now(), tokens: input.estimatedTokens ?? 250000 });
    const {maxRequests:_maxRequests,...operation}=input;
    this.#providerOperations.set(input.id,{...operation,callBriefId:artifact.callId,durableJobId:lease.jobId,result:null});
    return true;
  }

  #checkPreparationPermit(estimatedTokens = 250000) {
    if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0 || estimatedTokens > 1000000) throw new Error("Invalid provider token reservation");
    for (const [id,expiry] of this.#preparationPermits) if (expiry<=Date.now()) this.#preparationPermits.delete(id);
    if (this.#preparationCooldown>Date.now() || this.#preparationPermits.size>=this.#preparationSettings.capacity.providerSlots)
      throw new PreparationPolicyError("PREPARATION_PROVIDER_BUSY",Math.max(1000,this.#preparationCooldown-Date.now()));
    for (const [id, row] of this.#preparationAdmissions) if (row.at <= Date.now()-60000) this.#preparationAdmissions.delete(id);
    const capacity = this.#preparationSettings.capacity, fraction = (100-capacity.voiceReservePercent)/100;
    const rows = [...this.#preparationAdmissions.values()];
    if (rows.length >= Math.floor(capacity.providerRequestsPerMinute*fraction) ||
        rows.reduce((sum,row) => sum+row.tokens,0)+estimatedTokens > Math.floor(capacity.providerTokensPerMinute*fraction)) {
      throw new PreparationPolicyError("PREPARATION_PROVIDER_BUSY", rows.length ? Math.max(1000,Math.min(...rows.map(row=>row.at))+60000-Date.now()) : 60000);
    }
  }
  async completeProviderOperation(input: CompleteProviderOperationInput) {
    const stored = this.#providerOperations.get(input.operationId);
    if (!stored) throw new CallRepositoryError("PROVIDER_OPERATION_NOT_FOUND");
    if (stored.result) return;
    if (input.outcome !== "network_error") this.#preparationPermits.delete(input.operationId);
    if (input.retryAfterMs || input.statusCode===429) this.#preparationCooldown=Math.max(this.#preparationCooldown,Date.now()+Math.max(1000,input.retryAfterMs ?? 0));
    stored.result = copy({
      actualServiceTier: input.actualServiceTier,
      outcome: input.outcome,
      providerRequestId: input.providerRequestId,
      providerResponseId: input.providerResponseId,
      providerModel: input.providerModel,
      statusCode: input.statusCode,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      ...(input.diagnostics && this.#canRecordPreparationDiagnostic(input.operationId) ? { diagnostics: preparationTransportDiagnosticsSchema.parse(input.diagnostics) } : {}),
      errorCode: input.errorCode,
      usage: input.usage
    });
  }

  async startRealtimeProviderSessions(inputs: RealtimeProviderSessionInput[]) {
    for (const input of inputs) {
      const attempt = (this.#attempts.get(input.callBriefId) ?? []).find(
        ({ id }) => id === input.callAttemptId
      );
      if (!attempt) {
        throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
      }
    }
    for (const input of inputs) {
      if (this.#providerOperations.has(input.id)) continue;
      this.#providerOperations.set(input.id, {
        ...copy(input),
        result: null
      });
    }
  }

  async recordRealtimeProviderOperation(
    input: RealtimeProviderOperationInput
  ) {
    const existing = this.#providerOperations.get(input.id);
    if (existing) {
      if (!existing.result && input.result) existing.result = copy(input.result);
      return;
    }
    const attempt = (this.#attempts.get(input.callBriefId) ?? []).find(
      ({ id }) => id === input.callAttemptId
    );
    if (!attempt) {
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    const parent = this.#providerOperations.get(input.parentOperationId);
    if (
      !parent ||
      !("callAttemptId" in parent) ||
      parent.callAttemptId !== input.callAttemptId ||
      parent.callBriefId !== input.callBriefId ||
      parent.operationType !== "realtime_session"
    ) {
      throw new CallRepositoryError("PROVIDER_OPERATION_NOT_FOUND");
    }
    this.#providerOperations.set(input.id, copy(input));
  }

  async reservePostCallTranscriptionProviderRequest(
    input: PostCallTranscriptionProviderOperationInput,
    lease: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    const job = this.#findDurableJob(lease.jobId);
    const { callId, snapshot } = this.#requireRecording(input.recordingId);
    const attempt = (this.#attempts.get(callId) ?? []).at(-1);
    if (
      job?.type !== "final_transcription" ||
      job.recordingId !== input.recordingId ||
      job.generation !== input.durableJobGeneration ||
      callId !== input.callBriefId ||
      snapshot.recordingTranscript?.status !== "processing" ||
      !snapshot.recordingTranscriptRequest ||
      (snapshot.recording?.status!=="available" || (snapshot.recording.deleteAfter!==null && Date.parse(snapshot.recording.deleteAfter)<=Date.now())) ||
      !this.#callText.hooks.textAllowed(callId) || !attempt
    ) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    if (this.#providerOperations.has(input.id)) return;
    this.#providerOperations.set(input.id, {
      ...copy(input),
      callAttemptId: attempt.id,
      durableJobId: lease.jobId,
      result: null
    });
  }

  async findCompletedPostCallTranscriptionChunk(
    input: PostCallTranscriptionChunkLookupInput,
    lease: DurableJobLease
  ) {
    this.#assertPostCallTranscriptionContext(input, lease);
    return this.#postCallTranscriptionChunks.get(
      postCallTranscriptionChunkKey(input)
    )?.text ?? null;
  }

  async completePostCallTranscriptionProviderRequest(
    input: CompletePostCallTranscriptionProviderOperationInput
  ) {
    const operation = this.#providerOperations.get(input.operationId);
    if (
      !operation ||
      !("recordingId" in operation) ||
      operation.operationType !== "transcription" ||
      operation.callBriefId !== input.callBriefId ||
      operation.recordingId !== input.recordingId ||
      operation.durableJobGeneration !== input.durableJobGeneration ||
      operation.stage !== input.stage
    ) {
      throw new CallRepositoryError("PROVIDER_OPERATION_NOT_FOUND");
    }
    await this.completeProviderOperation(input);
    const { snapshot } = this.#requireRecording(input.recordingId);
    if (
      input.outcome !== "succeeded" ||
      !input.transcriptText ||
      snapshot.recording?.status !== "available" ||
      snapshot.recordingTranscript?.status !== "processing" ||
      !this.#callText.hooks.textAllowed(input.callBriefId) ||
      (snapshot.recording.deleteAfter !== null && Date.parse(snapshot.recording.deleteAfter) <= Date.now())
    ) return;
    const chunk = {
      callBriefId: input.callBriefId,
      recordingId: input.recordingId,
      durableJobGeneration: input.durableJobGeneration,
      stage: input.stage,
      chunkKey: input.chunkKey,
      inputFingerprint: input.inputFingerprint,
      requestedModel: operation.requestedModel,
      providerOperationId: input.operationId,
      text: input.transcriptText
    };
    this.#postCallTranscriptionChunks.set(
      postCallTranscriptionChunkKey(chunk),
      copy(chunk)
    );
  }

  async startTelephonyProviderOperation(
    input: TelephonyProviderOperationInput
  ) {
    const attempt = (this.#attempts.get(input.callBriefId) ?? []).find(
      ({ id }) => id === input.callAttemptId
    );
    if (!attempt || attempt.provider !== "twilio") {
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    const existing = [...this.#providerOperations.values()].find(
      (operation) =>
        "callAttemptId" in operation &&
        operation.callAttemptId === input.callAttemptId &&
        operation.operationType === "telephony_leg"
    );
    if (existing) return;
    this.#providerOperations.set(input.id, { ...copy(input), result: null });
  }

  async recordTelephonyLegUsage(input: TelephonyLegUsageInput) {
    const attempt = (this.#attempts.get(input.callBriefId) ?? []).find(
      ({ id }) => id === input.callAttemptId
    );
    if (!attempt || attempt.providerCallId !== input.providerCallId) {
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    let operation = [...this.#providerOperations.values()].find(
      (candidate): candidate is TelephonyProviderOperationRecord =>
        "callAttemptId" in candidate &&
        candidate.callAttemptId === input.callAttemptId &&
        candidate.operationType === "telephony_leg"
    );
    if (!operation) {
      operation = {
        id: input.fallbackOperationId,
        callBriefId: input.callBriefId,
        callAttemptId: input.callAttemptId,
        provider: "twilio",
        operationType: "telephony_leg",
        stage: "outbound_call",
        requestedModel: "programmable_voice",
        clientRequestId: input.fallbackOperationId,
        startedAt: attempt.startedAt,
        result: null
      };
      this.#providerOperations.set(operation.id, operation);
    }
    if (
      !operation.result &&
      (input.durationSeconds !== null || input.billableSeconds !== null)
    ) {
      operation.result = createTelephonyLegResult(input);
    }
    const prior = this.#usageSupplements.get(operation.id);
    this.#usageSupplements.set(operation.id, {
      durationSeconds: prior?.durationSeconds ?? input.durationSeconds,
      billableSeconds: prior?.billableSeconds ?? input.billableSeconds
    });
    await this.enqueueDurableJob({
      type: "provider_call_cost_reconciliation",
      callAttemptId: input.callAttemptId,
      runAfter: input.occurredAt,
      maxAttempts: durableJobMaxAttempts.provider_call_cost_reconciliation
    });
  }

  async recordTelephonyProviderCost(
    input: TelephonyProviderCostInput,
    lease: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    const attempt = (this.#attempts.get(input.callBriefId) ?? []).find(
      ({ id }) => id === input.callAttemptId
    );
    if (
      !attempt ||
      attempt.provider !== "twilio" ||
      attempt.providerCallId !== input.providerCallId
    ) {
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    let operation = [...this.#providerOperations.values()].find(
      (candidate): candidate is TelephonyProviderOperationRecord =>
        "callAttemptId" in candidate &&
        candidate.callAttemptId === input.callAttemptId &&
        candidate.operationType === "telephony_leg"
    );
    if (!operation) {
      operation = {
        id: input.fallbackOperationId,
        callBriefId: input.callBriefId,
        callAttemptId: input.callAttemptId,
        provider: "twilio",
        operationType: "telephony_leg",
        stage: "outbound_call",
        requestedModel: "programmable_voice",
        clientRequestId: input.fallbackOperationId,
        startedAt: attempt.startedAt,
        result: null
      };
      this.#providerOperations.set(operation.id, operation);
    }
    const providerCostId = `${input.providerCallId}:connectivity`;
    const existing = [...this.#providerCosts.values()].find(
      (cost) => cost.operationId === operation.id ||
        cost.providerCostId === providerCostId
    );
    if (existing) {
      if (
        existing.operationId !== operation.id ||
        existing.amountMicros !== input.amountMicros ||
        existing.currency !== input.currency ||
        existing.rawCost.price !== input.rawAmount
      ) {
        throw new CallRepositoryError("PROVIDER_COST_CONFLICT");
      }
      return;
    }
    this.#providerCosts.set(input.id, {
      id: input.id,
      operationId: operation.id,
      provider: "twilio",
      providerCostId,
      costBasis: "provider_reported_actual",
      component: "connectivity",
      amountMicros: input.amountMicros,
      currency: input.currency,
      rawCost: { price: input.rawAmount, price_unit: input.currency },
      observedAt: input.observedAt
    });
  }

  providerOperationsForTest(preparationId?: string) {
    return copy([...this.#providerOperations.values()].filter((operation) =>
      !preparationId ||
      ("callPreparationId" in operation &&
        operation.callPreparationId === preparationId)
    ));
  }

  providerCostsForTest() {
    return copy([...this.#providerCosts.values()]);
  }

  async cancelCallPreparations(userId: string, now: string) {
    this.#diagnosticRevokedUsers.add(userId);
    for (const operation of this.#providerOperations.values()) {
      if (!this.#canRecordPreparationDiagnostic(operation.id)) {
        this.#preparationCheckpoints.delete(operation.id);
        if ("requestMetadata" in operation) delete operation.requestMetadata;
        if (operation.result) delete operation.result.diagnostics;
      }
    }
    for (const [id, stored] of this.#callPreparations) {
      if (
        stored.userId !== userId ||
        ["succeeded", "failed", "cancelled"].includes(stored.preparation.status)
      ) continue;
      stored.preparation = {
        ...stored.preparation,
        status: "cancelled",
        failureCode: null,
        updatedAt: now,
        completedAt: now
      };
      stored.input = null;
      const job = [...this.#durableJobs.values()].find(
        ({ callPreparationId }) => callPreparationId === id
      );
      if (!job || ["succeeded", "dead_letter", "cancelled"].includes(job.status)) {
        continue;
      }
      if (job.status === "running") {
        this.#durableJobAttempts.push({
          id: randomUUID(),
          jobId: job.id,
          generation: job.generation,
          attemptNumber: job.attemptCount,
          workerId: job.leaseOwner!,
          startedAt: job.leasedAt!,
          completedAt: now,
          outcome: "cancelled",
          errorCode: "account_deletion_requested"
        });
      }
      job.status = "cancelled";
      job.leaseOwner = null;
      job.leasedAt = null;
      job.leaseExpiresAt = null;
      job.lastErrorCode = "account_deletion_requested";
      job.updatedAt = now;
      job.completedAt = now;
    }
  }

  async cancelUserTextArtifacts(userId:string,now:string) {
    this.#textCancelledUsers.add(userId);
    for(const artifact of this.#callText.artifacts.values()) {
      if(this.#owners.get(artifact.callId)!==userId) continue;
      artifact.status="cancelled";artifact.updatedAt=now;
      const job=[...this.#durableJobs.values()].find(row=>row.textArtifactId===artifact.id);
      if(!job||!["queued","running"].includes(job.status)) continue;
      if(job.status==="running") this.#durableJobAttempts.push({id:randomUUID(),jobId:job.id,generation:job.generation,
        attemptNumber:job.attemptCount,workerId:job.leaseOwner!,startedAt:job.leasedAt!,completedAt:now,outcome:"cancelled",errorCode:"account_deletion_requested"});
      Object.assign(job,{status:"cancelled",leaseOwner:null,leasedAt:null,leaseExpiresAt:null,lastErrorCode:"account_deletion_requested",updatedAt:now,completedAt:now});
    }
  }

  async isOwnedBy(id: string, userId: string | null) {
    return this.#calls.has(id) &&
      !this.#callDataDeletions.has(id) &&
      this.#owners.get(id) === userId;
  }

  async findCallDataDeletion(
    id: string,
    userId: string,
    requestId: string
  ) {
    const deletion = this.#callDataDeletions.get(id);
    return deletion?.userId === userId && deletion.requestId === requestId
      ? copy(deletion)
      : null;
  }

  async deleteCallData(input: DeleteCallDataInput) {
    const existing = this.#callDataDeletions.get(input.callId);
    if (existing) {
      if (
        existing.userId === input.userId &&
        existing.requestId === input.requestId
      ) return copy(existing);
      throw new CallRepositoryError(
        "CALL_DATA_DELETION_IDEMPOTENCY_CONFLICT"
      );
    }
    const snapshot = this.#calls.get(input.callId);
    if (!snapshot || this.#owners.get(input.callId) !== input.userId) {
      throw new CallRepositoryError("CALL_NOT_FOUND");
    }
    if (!terminalStatuses.has(snapshot.brief.status)) {
      throw new CallRepositoryError("CALL_DATA_DELETION_NOT_AVAILABLE");
    }
    if (snapshot.recording) {
      for (const [key, chunk] of this.#postCallTranscriptionChunks) {
        if (chunk.recordingId === snapshot.recording.id) {
          this.#postCallTranscriptionChunks.delete(key);
        }
      }
    }

    snapshot.brief = {
      ...snapshot.brief,
      recipientName: "Deleted call",
      phoneNumber: "",
      objective: "Deleted by owner",
      representedPerson: "Deleted account",
      representedPersonFirstName: "Deleted",
      representedPersonLastName: "Account",
      assistanceReason: "speech_impairment",
      assistanceDisclosure: "Deleted by owner",
      context: "",
      allowedFacts: [],
      updatedAt: input.deletedAt
    };
    this.#callText.redact(input.callId);
    for (const operation of this.#providerOperations.values()) {
      const preparation = "callPreparationId" in operation ? this.#callPreparations.get(operation.callPreparationId) : undefined;
      if (("callBriefId" in operation && operation.callBriefId === input.callId) ||
          preparation?.preparation.callBriefId === input.callId || preparation?.targetCallBriefId === input.callId) {
        this.#preparationCheckpoints.delete(operation.id);
        if ("requestMetadata" in operation) delete operation.requestMetadata;
        if (operation.result) delete operation.result.diagnostics;
      }
    }
    for (const [id, action] of this.#voiceActions) if (action.callBriefId === input.callId) this.#voiceActions.delete(id);
    for (const [id, decision] of this.#terminalDecisions) if (decision.callBriefId === input.callId) this.#terminalDecisions.delete(id);
    for (const [id, assessment] of this.#assessmentRevisions) if (this.#attempts.get(input.callId)?.some(a => a.id === assessment.callAttemptId)) this.#assessmentRevisions.delete(id);
    for (const attempt of this.#attempts.get(input.callId) ?? []) { const a=this.#assessments.get(attempt.id); if(a) a.decision=null; }
    snapshot.compilation = null;
    snapshot.languageContext = null;
    for (const stored of this.#compilations.get(input.callId) ?? []) {
      stored.compilation = null;
      stored.executionSnapshot = null;
    }
    snapshot.transcript = [];
    snapshot.pendingApproval = null;
    if (snapshot.recording) {
      snapshot.recording = {
        ...snapshot.recording,
        status: "deleted",
        providerRecordingId: null,
        deleteAfter: null,
        deletedAt: input.deletedAt,
        failureReason: null
      };
    }
    if (snapshot.finalTranscript) {
      snapshot.finalTranscript = {
        ...snapshot.finalTranscript,
        text: null,
        segments: [],
        failureReason: null,
        updatedAt: input.deletedAt
      };
    }
    snapshot.recordingTranscript = null;
    snapshot.recordingTranscriptRevision = null;
    snapshot.recordingTranscriptRequest = null;
    const attempts = this.#attempts.get(input.callId) ?? [];
    for (const attempt of attempts) {
      this.#nativeCaptures.delete(attempt.id);
      this.#runtimeDescriptors.delete(attempt.id);
      attempt.providerCallId = null;
      delete attempt.recipientContactHash;
      attempt.failureReason = null;
      attempt.compilationRevision = null;
      attempt.compilationSnapshotHash = null;
      attempt.executionSnapshot = null;
    }
    const feedback = this.#callFeedbackRevisions.get(input.callId) ?? [];
    for (const item of feedback) item.revision.comment = null;
    for (const job of this.#durableJobs.values()) {
      const preparation = job.callPreparationId
        ? this.#callPreparations.get(job.callPreparationId)
        : null;
      if (
        (
          job.callId !== input.callId &&
          preparation?.targetCallBriefId !== input.callId
        ) ||
        ["succeeded", "dead_letter", "cancelled"].includes(job.status)
      ) continue;
      if (job.status === "running") {
        this.#durableJobAttempts.push({
          id: randomUUID(),
          jobId: job.id,
          generation: job.generation,
          attemptNumber: job.attemptCount,
          workerId: job.leaseOwner!,
          startedAt: job.leasedAt!,
          completedAt: input.deletedAt,
          outcome: "cancelled",
          errorCode: "call_data_deleted"
        });
      }
      job.status = "cancelled";
      job.leaseOwner = null;
      job.leasedAt = null;
      job.leaseExpiresAt = null;
      job.lastErrorCode = "call_data_deleted";
      job.updatedAt = input.deletedAt;
      job.completedAt = input.deletedAt;
      if (preparation) {
        preparation.preparation.status = "cancelled";
        preparation.preparation.failureCode = null;
        preparation.preparation.updatedAt = input.deletedAt;
        preparation.preparation.completedAt = input.deletedAt;
        preparation.input = null;
      }
    }
    const deletion: CallDataDeletionRecord = {
      requestId: input.requestId,
      callId: input.callId,
      userId: input.userId,
      providerRecordingDisposition: input.providerRecordingDisposition,
      deletedAt: input.deletedAt
    };
    this.#callDataDeletions.set(input.callId, deletion);
    return copy(deletion);
  }

  async grantSignupCredits(userId: string) {
    if (!this.#betaCreditEnrollments.has(userId)) this.enrollBetaCredits(userId, defaultBetaCreditPolicy);
    const enrollment = this.#betaCreditEnrollments.get(userId)!; enrollment.activated = true;
    const idempotencyKey = `signup:${userId}`;
    if (enrollment.policy.period === "lifetime" && enrollment.lifetimeGrantAllowed && !this.#creditTransactions.some((entry) => entry.idempotencyKey === idempotencyKey)) {
      this.#creditTransactions.push({
        id: randomUUID(),
        userId,
        amount: enrollment.policy.amount,
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

  async createPromoCode(input: CreatePromoCodeRepositoryInput) {
    const previousHash = this.#promoCreationIdempotency.get(input.idempotencyKey);
    if (previousHash) {
      const previous = this.#promoCodes.get(previousHash)!;
      if (!samePromoDefinition(previous, input)) {
        throw new CallRepositoryError("CREDIT_IDEMPOTENCY_CONFLICT");
      }
      return { created: false, promoCode: promoSummary(previous) };
    }
    if (this.#promoCodes.has(input.codeHash)) {
      throw new CallRepositoryError("PROMO_CODE_ALREADY_EXISTS");
    }
    const promoCode: StoredPromoCode = {
      id: randomUUID(),
      codeHash: input.codeHash,
      credits: input.credits,
      globalRedemptionLimit: input.globalRedemptionLimit,
      perUserLimit: input.perUserLimit,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      active: input.active,
      campaign: input.campaign,
      actorUserId: input.actorUserId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now
    };
    this.#promoCodes.set(input.codeHash, promoCode);
    this.#promoCreationIdempotency.set(input.idempotencyKey, input.codeHash);
    return { created: true, promoCode: promoSummary(promoCode) };
  }

  async redeemPromo(input: RedeemPromoRepositoryInput) {
    const previous = this.#promoRedemptions.find(
      ({ idempotencyKey }) => idempotencyKey === input.idempotencyKey
    );
    if (previous) {
      const promo = [...this.#promoCodes.values()].find(
        ({ id }) => id === previous.promoCodeId
      );
      if (!promo || previous.userId !== input.userId || promo.codeHash !== input.codeHash) {
        throw new CallRepositoryError("CREDIT_IDEMPOTENCY_CONFLICT");
      }
      return { applied: false, usage: this.#buildCreditUsage(input.userId) };
    }
    const promo = this.#promoCodes.get(input.codeHash);
    const now = Date.parse(input.now);
    if (
      !promo ||
      !promo.active ||
      (promo.startsAt !== null && Date.parse(promo.startsAt) > now) ||
      (promo.expiresAt !== null && Date.parse(promo.expiresAt) <= now)
    ) {
      throw new CallRepositoryError("PROMO_CODE_UNAVAILABLE");
    }
    const redemptions = this.#promoRedemptions.filter(
      ({ promoCodeId }) => promoCodeId === promo.id
    );
    if (
      promo.globalRedemptionLimit !== null &&
      redemptions.length >= promo.globalRedemptionLimit
    ) {
      throw new CallRepositoryError("PROMO_GLOBAL_LIMIT_REACHED");
    }
    const userRedemptions = redemptions.filter(
      ({ userId }) => userId === input.userId
    );
    if (userRedemptions.length >= promo.perUserLimit) {
      throw new CallRepositoryError("PROMO_USER_LIMIT_REACHED");
    }
    const redemption: StoredPromoRedemption = {
      id: randomUUID(),
      promoCodeId: promo.id,
      userId: input.userId,
      redemptionNumber: userRedemptions.length + 1,
      credits: promo.credits,
      idempotencyKey: input.idempotencyKey,
      redeemedAt: input.now
    };
    this.#promoRedemptions.push(redemption);
    this.#creditTransactions.push({
      id: randomUUID(),
      userId: input.userId,
      amount: promo.credits,
      type: "promo_grant",
      callAttemptId: null,
      promoRedemptionId: redemption.id,
      adminId: null,
      reason: `Promo campaign: ${promo.campaign}`,
      idempotencyKey: `promo:${redemption.id}`,
      createdAt: input.now
    });
    return { applied: true, usage: this.#buildCreditUsage(input.userId) };
  }

  async grantAdminCredits(input: AdminCreditGrantRepositoryInput) {
    const idempotencyKey = `admin-grant:${input.idempotencyKey}`;
    const previous = this.#creditTransactions.find(
      (entry) => entry.idempotencyKey === idempotencyKey
    );
    if (previous) {
      if (
        previous.userId !== input.targetUserId ||
        previous.adminId !== input.actorUserId ||
        previous.amount !== input.credits ||
        previous.reason !== input.reason
      ) {
        throw new CallRepositoryError("CREDIT_IDEMPOTENCY_CONFLICT");
      }
      return {
        applied: false,
        usage: this.#buildCreditUsage(input.targetUserId)
      };
    }
    this.#creditTransactions.push({
      id: randomUUID(),
      userId: input.targetUserId,
      amount: input.credits,
      type: "admin_grant",
      callAttemptId: null,
      promoRedemptionId: null,
      adminId: input.actorUserId,
      reason: input.reason,
      idempotencyKey,
      createdAt: input.now
    });
    return { applied: true, usage: this.#buildCreditUsage(input.targetUserId) };
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
      this.#safetyEvents.push({
        eventType: "recipient.suppressed",
        actorUserId: input.actorUserId ?? null,
        phoneE164,
        source: input.source,
        reason
      });
      return true;
    }
    return false;
  }

  async liftRecipientSuppression(
    phoneE164: string,
    input: SafetyControlInput
  ) {
    const reason = requireReason(input.reason);
    const normalizedPhone = requireSwissPhone(phoneE164);
    if (this.#recipientSuppressions.delete(normalizedPhone)) {
      this.#safetyEvents.push({
        eventType: "recipient.suppression_lifted",
        actorUserId: input.actorUserId ?? null,
        phoneE164: normalizedPhone,
        reason
      });
      return true;
    }
    return false;
  }

  async getOutboundCallControl() {
    return {
      enabled: this.#outboundCallsEnabled,
      reason: this.#outboundCallsReason,
      updatedAt: this.#outboundCallsUpdatedAt
    };
  }

  async setOutboundCallsEnabled(
    enabled: boolean,
    input: SafetyControlInput
  ) {
    const reason = requireSystemControlReason(input.reason);
    this.#outboundCallsEnabled = enabled;
    this.#outboundCallsReason = reason;
    this.#outboundCallsUpdatedAt = new Date().toISOString();
    this.#safetyEvents.push({
      eventType: enabled ? "outbound_calls.enabled" : "outbound_calls.disabled",
      actorUserId: input.actorUserId ?? null,
      phoneE164: null,
      reason
    });
    return { enabled, reason, updatedAt: this.#outboundCallsUpdatedAt };
  }

  safetyEventsForTest() {
    return copy(this.#safetyEvents);
  }

  #buildCreditUsage(userId: string): CreditUsage {
    const period = this.#ensureBetaCredits(userId);
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
    const e = this.#betaCreditEnrollments.get(userId);
    const persistent = transactions.filter(t => !t.betaPeriodId).reduce((sum, t) => sum + t.amount, 0);
    const current = transactions.filter(t => t.betaPeriodId && t.betaPeriodId === period?.id);
    const available = current.reduce((sum, t) => sum + t.amount, 0);
    const funding: CreditFunding = { persistent, allowance: e ? { policyId: e.id, period: e.policy.period, limit: e.policy.amount, lifetimeGrantAllowed: e.lifetimeGrantAllowed,
      available, reserved: current.filter(t => t.type === "call_reservation" && !current.some(s => s.callAttemptId === t.callAttemptId && ["call_charge", "call_refund"].includes(s.type))).length,
      used: current.filter(t => t.type === "call_charge").length, startsAt: period?.startsAt ?? null, endsAt: period?.endsAt ?? null,
      pending: e.pending ? { policy: e.pending.policy, effectiveAt: e.pending.effectiveAt } : null } : null };
    return {
      balance: persistent + available, funding,
      activeCallBriefId,
      transactions
    };
  }

  async recompile(
    id: string,
    input: CreateCallBriefInput,
    compilation: CallCompilation,
    publication?: CallPreparationPublication
  ) {
    assertCompilationIntegrity(compilation);
    const snapshot = this.#require(id);
    let preparation: StoredCallPreparation | null = null;
    if (publication) {
      this.#assertDurableJobLease(publication.lease);
      const pinned = this.#callPreparations.get(publication.preparationId);
      if (pinned && Date.parse(publication.lease.checkedAt)>=Date.parse(pinned.preparation.createdAt)+pinned.runtimePolicy.timeoutMs)
        throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
      preparation = this.#callPreparations.get(publication.preparationId) ?? null;
      if (
        !preparation ||
        preparation.targetCallBriefId !== id ||
        preparation.targetRevision !== compilation.revision ||
        ["failed", "cancelled"].includes(preparation.preparation.status)
      ) {
        throw new CallRepositoryError("CALL_PREPARATION_NOT_FOUND");
      }
      if (preparation.preparation.status === "succeeded") {
        return copy(snapshot);
      }
      const currentCompilation = (this.#compilations.get(id) ?? []).find(
        (stored) =>
          stored.revision === snapshot.compilation?.revision &&
          stored.snapshotHash === snapshot.compilation?.snapshotHash
      );
      if (
        !currentCompilation ||
        currentCompilation.id !== preparation.expectedCompilationId
      ) {
        throw new CallRepositoryError("CALL_COMPILATION_STALE");
      }
    }
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
    snapshot.languageContext = resolveTaskLanguage({ preferences: preparation?.language?.preferences, accountPreference: preparation?.language?.accountPreference, detectedLanguage: compilation.compiledBrief?.sourceLanguage, compilationRevision: compilation.revision, previous: snapshot.languageContext });
    const history = this.#compilations.get(id) ?? [];
    history.push({
      id: randomUUID(),
      revision: compilation.revision,
      snapshotHash: compilation.snapshotHash,
      compilation: copy(compilation),
      approvedAt: null,
      executionSnapshot: null
    });
    this.#compilations.set(id, history);
    snapshot.pendingApproval = null;
    this.#appendCompilationTelemetry(id, compilation, now);
    if (preparation && publication) {
      preparation.preparation = {
        ...preparation.preparation,
        status: "succeeded",
        callBriefId: id,
        failureCode: null,
        updatedAt: publication.lease.checkedAt,
        completedAt: publication.lease.checkedAt
      };
      preparation.input = null;
      const job = this.#findDurableJob(publication.lease.jobId);
      if (job) job.callId = id;
    }
    return copy(snapshot);
  }

  async get(id: string) {
    if (this.#callDataDeletions.has(id)) return null;
    const snapshot = this.#calls.get(id);
    if(!snapshot) return null;
    if(snapshot.recordingTranscriptRequest && snapshot.recording) {
      const job=this.#durableJobs.get(durableJobKey('final_transcription',snapshot.recording.id));
      snapshot.recordingTranscriptRequest.status=snapshot.recordingTranscript?.status==='completed' ? 'completed' : snapshot.recording.status!=='available' || (snapshot.recording.deleteAfter && Date.parse(snapshot.recording.deleteAfter)<=Date.now()) ? 'unavailable' : job?.status==='queued' ? 'queued' : job?.status==='running' ? 'processing' : 'failed';
    }
    const action = [...this.#voiceActions.values()].find(a => a.callAttemptId === this.#attempts.get(id)?.at(-1)?.id);
    if(!snapshot.languageContext&&snapshot.compilation) snapshot.languageContext=resolveTaskLanguage({detectedLanguage:snapshot.compilation.compiledBrief?.sourceLanguage,compilationRevision:snapshot.compilation.revision});
    return {...copy(snapshot),initialDisclosure: initialDisclosureProjection(this.#attempts.get(id)?.at(-1) ?? null),appointmentAction: action ? { callAttemptId: action.callAttemptId, state: action.state, delivery: copy(action.delivery ?? null) } : null,
      brief:{...copy(snapshot.brief),lifecycle:this.#lifecycle(snapshot.brief)},planSource:snapshot.compilation?this.#callText.getPlanSource(id):null,
      nativeTranscriptCapture: copy(this.#nativeCaptures.get(this.#attempts.get(id)?.at(-1)?.id??'')??null),
      recordingTranscriptRevision:await this.#callText.getRecordingTranscriptRevision(id),
      textArtifacts:this.#callText.listTextArtifacts(id),finalTranscriptRevision:await this.#callText.getCurrentTranscriptRevision(id)};
  }

  async getCallAssessment(callId: string, attemptId: string) {
    if (this.#callDataDeletions.has(callId)) return null;
    if (!this.#attempts.get(callId)?.some(a=>a.id===attemptId)) return null;
    return copy(this.#displayAssessment(attemptId) ?? null);
  }
  #displayAssessment(attemptId: string) {
    return [...this.#assessmentRevisions.values()].filter(a => a.callAttemptId === attemptId).at(-1) ?? this.#assessments.get(attemptId);
  }

  async getPlanSource(...args: Parameters<CallTextRepository["getPlanSource"]>) { return this.#callText.getPlanSource(...args); }
  async getTextArtifactSourceCompilation(...args: Parameters<CallTextRepository["getTextArtifactSourceCompilation"]>) { return this.#callText.getTextArtifactSourceCompilation(...args); }
  async getCurrentTranscriptRevision(...args: Parameters<CallTextRepository["getCurrentTranscriptRevision"]>) { return this.#callText.getCurrentTranscriptRevision(...args); }
  async getTranscriptRevision(...args: Parameters<CallTextRepository["getTranscriptRevision"]>) { return this.#callText.getTranscriptRevision(...args); }
  async listTextArtifacts(...args: Parameters<CallTextRepository["listTextArtifacts"]>) { return this.#callText.listTextArtifacts(...args); }
  async getTextArtifact(...args: Parameters<CallTextRepository["getTextArtifact"]>) { return this.#callText.getTextArtifact(...args); }
  async enqueueTextArtifact(...args: Parameters<CallTextRepository["enqueueTextArtifact"]>) { return this.#callText.enqueueTextArtifact(...args); }
  async claimTextArtifact(...args: Parameters<CallTextRepository["claimTextArtifact"]>) { return this.#callText.claimTextArtifact(...args); }
  async freezeTextArtifactContext(...args: Parameters<CallTextRepository["freezeTextArtifactContext"]>) { return this.#callText.freezeTextArtifactContext(...args); }
  async getTextArtifactChunks(...args: Parameters<CallTextRepository["getTextArtifactChunks"]>) { return this.#callText.getTextArtifactChunks(...args); }
  async saveTextArtifactChunk(...args: Parameters<CallTextRepository["saveTextArtifactChunk"]>) { return this.#callText.saveTextArtifactChunk(...args); }
  async completeTextArtifact(...args: Parameters<CallTextRepository["completeTextArtifact"]>) { return this.#callText.completeTextArtifact(...args); }
  async failTextArtifact(...args: Parameters<CallTextRepository["failTextArtifact"]>) { return this.#callText.failTextArtifact(...args); }
  async retryTextArtifact(...args: Parameters<CallTextRepository["retryTextArtifact"]>) { return this.#callText.retryTextArtifact(...args); }
  async getCurrentReviewReceipt(...args: Parameters<CallTextRepository["getCurrentReviewReceipt"]>) { return this.#callText.getCurrentReviewReceipt(...args); }
  async exportCallTextData(...args: Parameters<CallTextRepository["exportCallTextData"]>) {
    const text = this.#callText.exportCallTextData(...args);
    const attempts = new Set((this.#attempts.get(args[0]) ?? []).map(a=>a.id));
    return {...text, assessments: copy([...this.#assessments.values()].filter(a=>attempts.has(a.callAttemptId))),
      assessmentRevisions: copy([...this.#assessmentRevisions.values()].filter(a=>attempts.has(a.callAttemptId))),
      terminalDecisions: copy([...this.#terminalDecisions.values()].filter(d=>d.callBriefId===args[0])),
      voiceActions: copy([...this.#voiceActions.values()].filter(a => a.callBriefId === args[0])) };
  }

  async getLanguageContext(id: string) {
    return (await this.get(id))?.languageContext ?? null;
  }

  async updateContentLanguage(id: string, targetLanguage: TextLanguage, expectedSelectionRevision: number) {
    const snapshot = this.#require(id);
    if (snapshot.compilation?.approvedAt) throw new CallRepositoryError("CALL_LANGUAGE_LOCKED");
    const previous = snapshot.languageContext;
    if (!previous || previous.selectionRevision !== expectedSelectionRevision) throw new CallRepositoryError("CALL_LANGUAGE_STALE");
    const context: CallLanguageContext = { ...previous, taskContentLanguage: targetLanguage, selectionSource: "task", selectionRevision: previous.selectionRevision + 1 };
    snapshot.languageContext = context;
    return copy(context);
  }

  async transitionAnswering(id: string, input: AnsweringTransitionInput) {
    const brief = this.#require(id).brief;
    const attempt = this.#attempts.get(id)?.find(a => a.id === input.attemptId);
    if (!attempt) throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    const latest = this.#attempts.get(id)?.at(-1);
    const events = (this.#callTelemetryEvents.get(id) ?? []).map(e => e.event).filter(e => e.callAttemptId === input.attemptId);
    const event = events.findLast(e => e.payload.name === "answering.updated");
    const current = event?.payload.name === "answering.updated" ? event.payload.metadata : null;
    const active = latest?.id === attempt.id && ["dialing", "in_progress"].includes(brief.status) &&
      !events.some(e => e.payload.name === "call.stop" && e.payload.metadata.phase === "requested") &&
      !(["dispatch", "expire"].includes(input.kind) && events.some(e => e.payload.name === "consent.granted"));
    const result = transitionAnswering(attempt, current, input, active);
    if (result.applied && result.state) {
      attempt.providerCallId ??= input.providerCallId;
      if (["resolve", "timeout", "dispatch"].includes(input.kind)) for (const op of answeringUsage(attempt, result.state!).filter(op => input.kind !== "dispatch" || op.operationType === "voicemail_tts")) {
        if (!this.#providerOperations.has(op.id)) this.#providerOperations.set(op.id, op);
      }
      this.#appendTelemetry(id, { callAttemptId: attempt.id, idempotencyKey: `answering:${attempt.id}:${input.kind}`,
        occurredAt: input.now, payload: { name: "answering.updated", metadata: result.state } });
    }
    return copy(result);
  }

  async appendCallTelemetryEvent(
    id: string,
    input: CallTelemetryEventInput
  ) {
    return copy(this.#appendTelemetry(id, input));
  }

  async listCallTelemetryEvents(id: string) {
    this.#require(id);
    return copy(
      (this.#callTelemetryEvents.get(id) ?? []).map(({ event }) => event)
    );
  }

  async listAdminCalls(input: ListAdminCallsInput) {
    const filtered = [...this.#calls.values()]
      .map(({ brief }) => this.#buildAdminCallSummary(brief.id))
      .filter((summary) => !input.status || summary.status === input.status)
      .filter((summary) =>
        !input.outcome || summary.semanticOutcome === input.outcome
      )
      .filter((summary) =>
        !input.consent || summary.technical.consent === input.consent
      )
      .filter((summary) =>
        !input.failureStage ||
        summary.technical.failureStage === input.failureStage
      )
      .filter((summary) => !input.locale || summary.locale === input.locale)
      .filter((summary) =>
        !input.dateFrom || summary.createdAt >= input.dateFrom
      )
      .filter((summary) =>
        !input.dateTo || summary.createdAt <= input.dateTo
      )
      .filter((summary) =>
        !input.cursor ||
        summary.createdAt < input.cursor.createdAt ||
        (
          summary.createdAt === input.cursor.createdAt &&
          summary.id < input.cursor.id
        )
      )
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
      );
    const items = filtered.slice(0, input.limit);
    const last = items.at(-1);
    return adminCallListSchema.parse({
      items,
      nextCursor: filtered.length > input.limit && last
        ? encodeAdminCallCursor({ createdAt: last.createdAt, id: last.id })
        : null
    });
  }

  async getAdminCallInspector(id: string) {
    this.#require(id);
    const timeline = (this.#callTelemetryEvents.get(id) ?? []).map(
      ({ event: { callBriefId: _callBriefId, userId: _userId, ...event } }) =>
        event
    );
    const outcomeHistory = (this.#callOutcomeRevisions.get(id) ?? [])
      .map(({ revision }) => revision);
    return adminCallInspectorSchema.parse({
      summary: this.#buildAdminCallSummary(id),
      timeline,
      outcomeHistory
    });
  }

  async getAdminCallSensitiveContent(
    id: string,
    actorUserId: string,
    reason: string
  ) {
    const snapshot = this.#require(id);
    const parsed = sensitiveCallAccessInputSchema.parse({ reason });
    this.#sensitiveCallAccessEvents.push({
      id: randomUUID(),
      callBriefId: id,
      actorUserId,
      reason: parsed.reason,
      createdAt: new Date().toISOString()
    });
    const feedback = this.#callFeedbackRevisions.get(id)?.at(-1)?.revision;
    return adminCallSensitiveContentSchema.parse({
      callBriefId: id,
      recipientName: snapshot.brief.recipientName,
      phoneNumber: snapshot.brief.phoneNumber,
      representedPerson: snapshot.brief.representedPerson,
      objective: snapshot.brief.objective,
      context: snapshot.brief.context,
      allowedFacts: snapshot.brief.allowedFacts,
      transcript: snapshot.transcript,
      finalTranscript: snapshot.finalTranscript,
      feedbackComment: feedback?.comment ?? null
    });
  }

  sensitiveCallAccessEventsForTest() {
    return copy(this.#sensitiveCallAccessEvents);
  }

  async getAdminOperationsFacts(
    from: string,
    to: string,
    callId?: string,
    preparationId?: string
  ): Promise<AdminOperationsFacts> {
    const scoped = [...this.#calls.values()].filter(({ brief }) =>
      !preparationId &&
      brief.createdAt >= from && brief.createdAt <= to &&
      (!callId || brief.id === callId)
    );
    const facts = emptyAdminOperationsFacts();
    facts.lifecycle = emptyCallLifecycleCounts();
    facts.userGoalFeedback = {yes:0,partly:0,no:0,notProvided:0};
    facts.providerUsage.incurredFrom = from;
    facts.providerUsage.incurredTo = to;
    facts.providerCosts.incurredFrom = from;
    facts.providerCosts.incurredTo = to;
    const durationValues: number[] = [];
    const firstAudioValues: number[] = [];
    for (const snapshot of scoped) {
      const id = snapshot.brief.id;
      const events = (this.#callTelemetryEvents.get(id) ?? [])
        .map(({ event }) => event);
      const attempts = this.#attempts.get(id) ?? [];
      const outcome = this.#buildOutcomeView(id);
      const lifecycle = this.#lifecycle(snapshot.brief);
      countCallLifecycle(facts.lifecycle, lifecycle);
      facts.createdCalls += 1;
      if (attempts.length > 0) facts.attemptedCalls += 1;
      if (interruptedStatuses.has(snapshot.brief.status)) {
        facts.activeCalls += 1;
      }
      if (terminalStatuses.has(snapshot.brief.status)) {
        facts.terminalCalls += 1;
      }
      if (lifecycle.connected) {
        facts.connectedCalls += 1;
      }
      if (lifecycle.consent === "granted") {
        facts.consentGrantedCalls += 1;
      } else if (lifecycle.connected && (lifecycle.consent === "declined" || lifecycle.consent === "not_received")) {
        facts.consentFailedCalls += 1;
      }
      if (terminalStatuses.has(snapshot.brief.status) && outcome.technical.failureStage !== null) {
        facts.technicalFailureCalls += 1;
      }
      if (outcome.latestFeedback) facts.feedbackResponses += 1;
      facts.userGoalFeedback[outcome.latestFeedback?.goalResult ?? "notProvided"]++;
      incrementAdminSemanticOutcome(
        facts,
        outcome.latestOutcome?.outcome ?? null
      );

      const duration = snapshot.recording?.durationSeconds;
      if (duration !== null && duration !== undefined) {
        durationValues.push(duration);
        if (events.some(
          ({ payload }) => payload.name === "transcription.started"
        )) {
          facts.usageSeconds.transcription += duration;
        }
      }
      for (const event of events) {
        if (event.payload.name === "conversation.first_audio") {
          firstAudioValues.push(event.payload.metadata.latencyMs);
        } else if (
          event.payload.name === "transcription.started" &&
          event.payload.metadata.retry
        ) {
          facts.transcriptionRetries += 1;
        } else if (
          event.payload.name === "conversation.ended" &&
          ["openai_closed", "openai_error"].includes(
            event.payload.metadata.reason
          )
        ) {
          facts.realtimeDisconnects += 1;
        } else if (event.payload.name === "call.recovered") {
          facts.recoveries += 1;
        }
      }
      let realtimeElapsedSeconds = 0;
      for (const attempt of attempts) {
        if (!attempt.endedAt) continue;
        const realtimeReadyAt = events.find((event) =>
          event.callAttemptId === attempt.id &&
          event.payload.name === "realtime.ready"
        )?.occurredAt;
        if (realtimeReadyAt) {
          realtimeElapsedSeconds += Math.max(
            0,
            Math.floor(
              (Date.parse(attempt.endedAt) - Date.parse(realtimeReadyAt)) /
                1_000
            )
          );
        }
        const connectedAt = events.find((event) =>
          event.callAttemptId === attempt.id &&
          event.payload.name === "connection.confirmed"
        )?.occurredAt;
        if (!connectedAt) continue;
        facts.usageSeconds.telephony += Math.max(
          0,
          Math.floor(
            (Date.parse(attempt.endedAt) - Date.parse(connectedAt)) / 1_000
          )
        );
      }
      if (events.some(({ payload }) => payload.name === "realtime.ready")) {
        facts.usageSeconds.realtime += Math.max(
          duration ?? 0,
          realtimeElapsedSeconds
        );
      }
    }
    facts.recordedDurationSeconds = aggregateFacts(durationValues);
    facts.firstAudioLatencyMs = aggregateFacts(firstAudioValues);
    const providerBuckets = new Map<string, AdminProviderUsageBucket>();
    for (const operation of this.#providerOperations.values()) {
      if (!this.#providerOperationMatchesScope(
        operation,
        callId,
        preparationId
      )) continue;
      if (operation.provider === "openai" && operation.result?.usage) {
        const at = operation.result.completedAt;
        if (!facts.providerUsage.firstRecordedAt || at < facts.providerUsage.firstRecordedAt) facts.providerUsage.firstRecordedAt = at;
      }
      if (operation.startedAt < from || operation.startedAt >= to) continue;
      facts.providerUsage.operationCount += 1;
      if (operation.operationType === "realtime_session" && operation.result?.outcome !== "succeeded") {
        facts.providerUsage.incompleteSessions = (facts.providerUsage.incompleteSessions ?? 0) + 1;
      }
      if (operation.operationType === "telephony_leg" && ![...this.#providerCosts.values()].some(c => c.operationId === operation.id)) {
        facts.providerCosts.pendingOperations = (facts.providerCosts.pendingOperations ?? 0) + 1;
      }
      const result = operation.result ? structuredClone(operation.result) : null;
      if (!result?.usage) {
        if (operation.operationType !== "brief_moderation" && operation.operationType !== "telephony_leg" &&
            (operation.operationType !== "realtime_session" || operation.stage === "live_conversation")) {
          facts.providerUsage.missingUsageOperations = (facts.providerUsage.missingUsageOperations ?? 0) + 1;
        }
        const bucket = emptyAdminProviderUsageBucket({ provider: operation.provider, operationType: operation.operationType,
          stage: operation.stage, model: result?.providerModel ?? operation.requestedModel });
        Object.assign(bucket, { operationId: operation.id, startedAt: operation.startedAt, outcome: result?.outcome ?? null });
        providerBuckets.set(operation.id, bucket);
        continue;
      }
      const supplemental = this.#usageSupplements.get(operation.id);
      result.usage.durationSeconds ??= supplemental?.durationSeconds ?? null;
      result.usage.billableSeconds ??= supplemental?.billableSeconds ?? null;
      const model = result.providerModel ?? operation.requestedModel;
      const key = operation.id;
      let bucket = providerBuckets.get(key);
      if (!bucket) {
        bucket = emptyAdminProviderUsageBucket({
          provider: operation.provider,
          operationType: operation.operationType,
          stage: operation.stage,
          model
        });
        providerBuckets.set(key, bucket);
      }
      const reported = [...this.#providerCosts.values()].filter(c => c.operationId === operation.id && c.currency === "USD");
      bucket.reportedUsdMicros = reported.length ? reported.reduce((sum, c) => sum + c.amountMicros, 0) : null;
      bucket.operationId = operation.id;
      bucket.startedAt = operation.startedAt;
      bucket.outcome = result.outcome;
      bucket.pricingVersion = result.usage.pricingVersion;
      bucket.billableCharacters = typeof result.usage.rawUsage.characters === "number" ? result.usage.rawUsage.characters : null;
      bucket.usageRecords += 1;
      bucket.requestCount += result.usage.requestCount ?? 1;
      addAdminProviderMetric(
        bucket,
        "inputTextTokens",
        "inputTextTokenSamples",
        result.usage.inputTextTokens
      );
      addAdminProviderMetric(
        bucket,
        "cachedInputTextTokens",
        "cachedInputTextTokenSamples",
        result.usage.cachedInputTextTokens
      );
      addAdminProviderMetric(
        bucket,
        "cacheWriteInputTextTokens",
        "cacheWriteInputTextTokenSamples",
        result.usage.cacheWriteInputTextTokens
      );
      addAdminProviderMetric(
        bucket,
        "outputTextTokens",
        "outputTextTokenSamples",
        result.usage.outputTextTokens
      );
      addAdminProviderMetric(
        bucket,
        "reasoningOutputTokens",
        "reasoningOutputTokenSamples",
        result.usage.reasoningOutputTokens
      );
      addAdminProviderMetric(
        bucket,
        "inputAudioTokens",
        "inputAudioTokenSamples",
        result.usage.inputAudioTokens
      );
      addAdminProviderMetric(
        bucket,
        "cachedInputAudioTokens",
        "cachedInputAudioTokenSamples",
        result.usage.cachedInputAudioTokens
      );
      addAdminProviderMetric(
        bucket,
        "outputAudioTokens",
        "outputAudioTokenSamples",
        result.usage.outputAudioTokens
      );
      addAdminProviderMetric(
        bucket,
        "totalTokens",
        "totalTokenSamples",
        result.usage.totalTokens
      );
      addAdminProviderMetric(
        bucket,
        "durationSeconds",
        "durationSamples",
        result.usage.durationSeconds
      );
      addAdminProviderMetric(
        bucket,
        "billableSeconds",
        "billableSamples",
        result.usage.billableSeconds
      );
    }
    facts.providerUsage.buckets = [...providerBuckets.values()].sort(
      (left, right) => [
        left.provider,
        left.operationType,
        left.stage,
        left.model
      ].join("\0").localeCompare([
        right.provider,
        right.operationType,
        right.stage,
        right.model
      ].join("\0"))
    );
    facts.providerUsage.usageRecordCount = facts.providerUsage.buckets.reduce(
      (total, bucket) => total + bucket.usageRecords,
      0
    );
    const providerCostBuckets = new Map<string, AdminProviderCostBucket>();
    for (const cost of this.#providerCosts.values()) {
      const operation = this.#providerOperations.get(cost.operationId);
      if (!operation || operation.startedAt < from || operation.startedAt >= to || !this.#providerOperationMatchesScope(
        operation,
        callId,
        preparationId
      )) {
        continue;
      }
      const key = [
        cost.provider,
        cost.costBasis,
        cost.component,
        cost.currency
      ].join("\0");
      const bucket = providerCostBuckets.get(key) ?? {
        provider: cost.provider,
        costBasis: cost.costBasis,
        component: cost.component,
        currency: cost.currency,
        records: 0,
        amountMicros: 0
      };
      bucket.records += 1;
      bucket.amountMicros += cost.amountMicros;
      providerCostBuckets.set(key, bucket);
    }
    facts.providerCosts.buckets = [...providerCostBuckets.values()].sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.component.localeCompare(right.component) ||
        left.currency.localeCompare(right.currency)
    );
    facts.providerCosts.recordCount = facts.providerCosts.buckets.reduce(
      (total, bucket) => total + bucket.records,
      0
    );
    return facts;
  }

  async getAdminSystemFacts(
    now: string,
    recentSince: string,
    webhookSince = recentSince
  ): Promise<AdminSystemFacts> {
    const snapshots = [...this.#calls.values()];
    const visibleSnapshots = snapshots.filter(
      ({ brief }) => !this.#callDataDeletions.has(brief.id)
    );
    const attempts = [...this.#attempts.entries()]
      .filter(([callId]) => !this.#callDataDeletions.has(callId))
      .flatMap(([, stored]) => stored);
    const events = [...this.#callTelemetryEvents.values()]
      .flatMap((stored) => stored.map(({ event }) => event))
      .filter(({ occurredAt }) => occurredAt >= recentSince);
    const jobs = [...this.#durableJobs.values()];
    const queued = jobs.filter(({ status }) => status === "queued");
    const webhooks = emptyAdminWebhookFacts();
    for (const bucket of this.#providerWebhookBuckets.values()) {
      if (bucket.bucketStartedAt < webhookSince) continue;
      const facts = webhooks[bucket.kind];
      facts[bucket.outcome] += bucket.deliveryCount;
      if (bucket.outcome === "accepted") {
        if (
          !facts.lastAcceptedAt ||
          bucket.lastReceivedAt > facts.lastAcceptedAt
        ) {
          facts.lastAcceptedAt = bucket.lastReceivedAt;
        }
      } else if (
        !facts.lastProblemAt ||
        bucket.lastReceivedAt >= facts.lastProblemAt
      ) {
        facts.lastProblemAt = bucket.lastReceivedAt;
        facts.lastProblemCode = bucket.lastErrorCode;
      }
    }
    const nowMs = Date.parse(now);
    const retentionCutoff = nowMs - durableWorkerHeartbeatRetentionMs;
    for (const [workerId, heartbeat] of this.#workerHeartbeats) {
      if (Date.parse(heartbeat.seenAt) < retentionCutoff) {
        this.#workerHeartbeats.delete(workerId);
      }
    }
    const workerHeartbeats = [...this.#workerHeartbeats.values()];
    const activeWorkerHeartbeats = workerHeartbeats.filter(
      ({ stoppedAt }) => stoppedAt === null
    );
    const healthyWorkerHeartbeats = activeWorkerHeartbeats.filter(
      ({ seenAt }) =>
        nowMs - Date.parse(seenAt) <= durableWorkerHeartbeatStaleAfterMs
    );
    const staleWorkerHeartbeats = activeWorkerHeartbeats.filter(
      ({ seenAt }) =>
        nowMs - Date.parse(seenAt) > durableWorkerHeartbeatStaleAfterMs
    );
    return {
      outboundCalls: {
        enabled: this.#outboundCallsEnabled,
        reason: this.#outboundCallsReason,
        updatedAt: this.#outboundCallsUpdatedAt
      },
      activeCalls: snapshots.filter(({ brief }) =>
        interruptedStatuses.has(brief.status)
      ).length,
      recordingsProcessing: snapshots.filter(({ recording }) =>
        recording && ["starting", "recording", "processing"]
          .includes(recording.status)
      ).length,
      transcriptionReady: snapshots.filter(({ recording, finalTranscript }) =>
        recording?.status === "available" &&
        finalTranscript?.status !== "completed" &&
        finalTranscript?.status !== "processing"
      ).length,
      transcriptionProcessing: snapshots.filter(({ finalTranscript }) =>
        finalTranscript?.status === "processing"
      ).length,
      transcriptionFailed: snapshots.filter(({ finalTranscript }) =>
        finalTranscript?.status === "failed"
      ).length,
      retentionScheduled: snapshots.filter(({ recording }) =>
        recording?.status === "available" && recording.deleteAfter !== null
      ).length,
      retentionOverdue: snapshots.filter(({ recording }) =>
        recording?.status === "available" &&
        recording.deleteAfter !== null &&
        recording.deleteAfter <= now
      ).length,
      recentWarnings: events.filter(({ severity }) => severity === "warning")
        .length,
      recentErrors: events.filter(({ severity }) => severity === "error")
        .length,
      callPlanCutover: {
        recoverableLegacyCalls: visibleSnapshots.filter(({ brief, compilation }) =>
          compilation !== null &&
          (this.#compilations.get(brief.id)?.length ?? 0) === 0
        ).length,
        archivedLegacyCalls: 0,
        recompileRequiredCalls: 0,
        unavailableLegacyCalls: visibleSnapshots.filter(({ brief, compilation }) =>
          compilation === null &&
          (this.#compilations.get(brief.id)?.length ?? 0) === 0
        ).length,
        executableLegacyCalls: 0,
        historicalAttemptsWithoutCompilation: attempts.filter((attempt) =>
          attempt.endedAt !== null && attempt.compilationId === null
        ).length,
        historicalAttemptsWithoutExecutionSnapshot: attempts.filter((attempt) =>
          attempt.endedAt !== null && attempt.executionSnapshot === null
        ).length,
        activeLegacyAttempts: attempts.filter((attempt) =>
          attempt.endedAt === null &&
          (attempt.compilationId === null || attempt.executionSnapshot === null)
        ).length,
        activeRecompilations: [...this.#callPreparations.values()].filter(
          (preparation) =>
            preparation.targetCallBriefId !== null &&
            ["queued", "processing", "retrying"].includes(
              preparation.preparation.status
            )
        ).length
      },
      externalWorker: {
        healthyInstances: healthyWorkerHeartbeats.length,
        staleInstances: staleWorkerHeartbeats.length,
        activeJobs: healthyWorkerHeartbeats.reduce(
          (sum, { activeJobs }) => sum + activeJobs,
          0
        ),
        lastSeenAt: workerHeartbeats
          .map(({ seenAt }) => seenAt)
          .sort()
          .at(-1) ?? null
      },
      webhooks,
      jobs: {
        queued: queued.length,
        running: jobs.filter(({ status }) => status === "running").length,
        succeeded: jobs.filter(({ status }) => status === "succeeded").length,
        deadLetter: jobs.filter(({ status }) => status === "dead_letter").length,
        retryQueued: queued.filter(({ attemptCount }) => attemptCount > 0).length,
        briefCompilationQueued: queued.filter(
          ({ type }) => type === "brief_compilation"
        ).length,
        transcriptionQueued: queued.filter(
          ({ type }) => type === "final_transcription"
        ).length,
        retentionQueued: queued.filter(
          ({ type }) => type === "recording_retention"
        ).length,
        providerReconciliationQueued: queued.filter(({ type }) =>
          type === "answer_detection_timeout" || type === "provider_call_reconciliation" ||
          type === "provider_call_cost_reconciliation" ||
          type === "provider_recording_reconciliation"
        ).length,
        oldestDueAt: queued
          .map(({ runAfter }) => runAfter)
          .sort()[0] ?? null,
        recent: jobs
          .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            right.id.localeCompare(left.id)
          )
          .slice(0, 20)
          .map(toAdminDurableJob)
      }
    };
  }

  async publishCallChange(signal: CallChangeSignal) {
    for (const subscriber of this.#callChangeSubscribers) {
      subscriber(copy(signal));
    }
  }

  async subscribeCallChanges(
    subscriber: (signal: CallChangeSignal) => void
  ) {
    this.#callChangeSubscribers.add(subscriber);
    return async () => {
      this.#callChangeSubscribers.delete(subscriber);
    };
  }

  async reportDurableWorkerHeartbeat(input: DurableWorkerHeartbeatInput) {
    const cutoff = Date.parse(input.seenAt) - durableWorkerHeartbeatRetentionMs;
    for (const [workerId, heartbeat] of this.#workerHeartbeats) {
      if (Date.parse(heartbeat.seenAt) < cutoff) {
        this.#workerHeartbeats.delete(workerId);
      }
    }
    this.#workerHeartbeats.set(input.workerId, {
      ...copy(input),
      stoppedAt: null
    });
  }

  async stopDurableWorkerHeartbeat(workerId: string, stoppedAt: string) {
    const heartbeat = this.#workerHeartbeats.get(workerId);
    if (!heartbeat) return;
    heartbeat.seenAt = stoppedAt;
    heartbeat.stoppedAt = stoppedAt;
    heartbeat.activeJobs = 0;
  }

  async recordProviderWebhookDelivery(input: ProviderWebhookDeliveryInput) {
    const receivedAt = new Date(input.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) {
      throw new Error("WEBHOOK_RECEIVED_AT_INVALID");
    }
    const bucketStartedAt = startOfUtcHour(receivedAt).toISOString();
    const cutoff = startOfUtcHour(new Date(
      receivedAt.getTime() - 30 * 24 * 60 * 60 * 1_000
    )).toISOString();
    for (const [key, bucket] of this.#providerWebhookBuckets) {
      if (bucket.bucketStartedAt < cutoff) {
        this.#providerWebhookBuckets.delete(key);
      }
    }
    const key = `${input.kind}:${input.outcome}:${bucketStartedAt}`;
    const errorCode = input.outcome === "accepted"
      ? null
      : safeProviderWebhookErrorCode(input.errorCode);
    const existing = this.#providerWebhookBuckets.get(key);
    if (existing) {
      existing.deliveryCount += 1;
      if (input.receivedAt >= existing.lastReceivedAt) {
        existing.lastReceivedAt = input.receivedAt;
        existing.lastErrorCode = errorCode;
      }
      return;
    }
    this.#providerWebhookBuckets.set(key, {
      kind: input.kind,
      outcome: input.outcome,
      bucketStartedAt,
      deliveryCount: 1,
      lastReceivedAt: input.receivedAt,
      lastErrorCode: errorCode
    });
  }

  async getCallOutcome(id: string) {
    return copy(this.#buildOutcomeView(id));
  }

  async recordSystemCallOutcome(id: string) {
    const view = this.#buildOutcomeView(id);
    if (
      view.technical.terminalStatus === null &&
      view.technical.failureStage === null
    ) {
      return copy(view);
    }
    const stored = this.#callOutcomeRevisions.get(id) ?? [];
    const latestSystem = [...stored]
      .reverse()
      .find(({ revision }) => revision.provenance === "system");
    if (
      latestSystem &&
      sameTechnicalOutcome(latestSystem.revision.technical, view.technical)
    ) {
      return copy(view);
    }
    const idempotencyKey = systemOutcomeIdempotencyKey(view.technical);
    const existing = stored.find(
      (candidate) => candidate.idempotencyKey === idempotencyKey
    );
    if (!existing) {
      const revision = callOutcomeRevisionSchema.parse({
        id: randomUUID(),
        callBriefId: id,
        revision: stored.length + 1,
        schemaVersion: CALL_OUTCOME_SCHEMA_VERSION,
        outcome: null,
        provenance: "system",
        actorUserId: null,
        reason: "technical_state_changed",
        technical: view.technical,
        createdAt: new Date().toISOString()
      });
      stored.push({ revision, idempotencyKey });
      this.#callOutcomeRevisions.set(id, stored);
    }
    return copy(this.#buildOutcomeView(id));
  }

  async submitOwnerCallFeedback(
    id: string,
    userId: string,
    input: OwnerCallFeedbackInput
  ) {
    const snapshot = this.#require(id);
    if (this.#owners.get(id) !== userId) {
      throw new CallRepositoryError("CALL_NOT_FOUND");
    }
    if (!(["completed", "stopped", "failed"] as CallBrief["status"][])
      .includes(snapshot.brief.status)) {
      throw new CallRepositoryError("CALL_FEEDBACK_NOT_AVAILABLE");
    }
    const parsed = ownerCallFeedbackInputSchema.parse(input);
    const normalized = {
      ...parsed,
      comment: parsed.comment?.trim() || null
    };
    const replay = [...this.#callFeedbackRevisions.values()]
      .flat()
      .find(({ idempotencyKey, revision }) =>
        revision.userId === userId &&
        idempotencyKey === parsed.idempotencyKey
      );
    if (replay) {
      if (
        replay.revision.callBriefId !== id ||
        replay.revision.userId !== userId ||
        !sameFeedback(replay.revision, normalized)
      ) {
        throw new CallRepositoryError(
          "CALL_FEEDBACK_IDEMPOTENCY_CONFLICT"
        );
      }
      return copy(this.#buildOutcomeView(id));
    }

    const feedbackStored = this.#callFeedbackRevisions.get(id) ?? [];
    const feedback = callFeedbackRevisionSchema.parse({
      id: randomUUID(),
      callBriefId: id,
      userId,
      revision: feedbackStored.length + 1,
      schemaVersion: CALL_OUTCOME_SCHEMA_VERSION,
      goalResult: normalized.goalResult,
      transcriptQuality: normalized.transcriptQuality,
      comment: normalized.comment,
      createdAt: new Date().toISOString()
    });
    feedbackStored.push({
      revision: feedback,
      idempotencyKey: normalized.idempotencyKey
    });
    this.#callFeedbackRevisions.set(id, feedbackStored);

    const outcomeStored = this.#callOutcomeRevisions.get(id) ?? [];
    const outcome = callOutcomeRevisionSchema.parse({
      id: randomUUID(),
      callBriefId: id,
      revision: outcomeStored.length + 1,
      schemaVersion: CALL_OUTCOME_SCHEMA_VERSION,
      outcome: semanticOutcomeForGoalResult(normalized.goalResult),
      provenance: "user",
      actorUserId: userId,
      reason: "owner_feedback",
      technical: this.#buildOutcomeView(id).technical,
      createdAt: feedback.createdAt
    });
    outcomeStored.push({
      revision: outcome,
      idempotencyKey: `feedback:${feedback.id}:outcome`
    });
    this.#callOutcomeRevisions.set(id, outcomeStored);
    return copy(this.#buildOutcomeView(id));
  }

  async getCallOutcomeMetrics(): Promise<CallOutcomeMetrics> {
    const metrics = emptyOutcomeMetrics();
    for (const snapshot of this.#calls.values()) {
      if (
        (["completed", "stopped", "failed"] as CallBrief["status"][])
          .includes(snapshot.brief.status)
      ) {
        metrics.terminalCalls += 1;
      }
      const feedback = this.#callFeedbackRevisions
        .get(snapshot.brief.id)
        ?.at(-1)?.revision;
      if (feedback) {
        metrics.feedbackResponses += 1;
        metrics.goalResults[feedback.goalResult] += 1;
        if (feedback.transcriptQuality === "some_errors") {
          metrics.transcriptQuality.someErrors += 1;
        } else if (feedback.transcriptQuality) {
          metrics.transcriptQuality[feedback.transcriptQuality] += 1;
        }
      }
      const semantic = [...(this.#callOutcomeRevisions.get(
        snapshot.brief.id
      ) ?? [])].reverse().find(({ revision }) => revision.outcome !== null)
        ?.revision.outcome;
      incrementSemanticOutcome(metrics, semantic ?? null);
      const stage = this.#buildOutcomeView(snapshot.brief.id).technical
        .failureStage;
      if (stage) metrics.technicalFailures[stage] += 1;
    }
    return callOutcomeMetricsSchema.parse(metrics);
  }

  async refreshAnsweringApproval(id: string) {
    const snapshot = this.#require(id);
    if (snapshot.brief.status !== "ready" || !snapshot.compilation || (this.#attempts.get(id)?.length ?? 0) > 0) return false;
    if (this.#currentCompilation(id).executionSnapshot?.version === 3) return false;
    const compilation = { ...copy(snapshot.compilation), revision: snapshot.compilation.revision + 1,
      approvedAt: null, compiledAt: new Date().toISOString() };
    compilation.snapshotHash = createCompilationSnapshotHash(compilation);
    const readers = this.#callText.listTextArtifacts(id).filter(a => a.kind === "plan_review" && a.status === "ready" && a.sourceHash === snapshot.compilation!.snapshotHash);
    await this.recompile(id, compilation.rawBrief, compilation);
    for (const reader of readers) {
      const readerId = randomUUID();
      this.#callText.artifacts.set(readerId, { ...copy(reader), id: readerId, compilationId: this.#currentCompilation(id).id,
        sourceHash: compilation.snapshotHash, createdAt: compilation.compiledAt, updatedAt: compilation.compiledAt, retryable: false });
    }
    return true;
  }

  async approveCompilation(
    id: string,
    expected?: CompilationReviewApprovalInput
  ) {
    const snapshot = this.#require(id);
    if (
      !["review_required","ready"].includes(snapshot.brief.status) ||
      snapshot.compilation?.policyDecision.status !== "ready_for_review" ||
      !snapshot.compilation.compiledBrief
    ) {
      throw new CallRepositoryError("CALL_BRIEF_NOT_REVIEWABLE");
    }
    assertCompilationIntegrity(snapshot.compilation);
    if (
      expected &&
      (snapshot.compilation.revision !== expected.revision ||
        snapshot.compilation.snapshotHash !== expected.snapshotHash)
    ) {
      throw new CallRepositoryError("CALL_COMPILATION_STALE");
    }
    const now = new Date().toISOString();
    this.#callText.saveReviewReceipt(id,expected);
    if(snapshot.brief.status==="ready") return copy(snapshot);
    snapshot.compilation.approvedAt = now;
    const storedCompilation = this.#currentCompilation(id);
    storedCompilation.approvedAt = now;
    storedCompilation.executionSnapshot = createApprovedExecutionSnapshot(
      snapshot
    );
    snapshot.brief.status = "ready";
    snapshot.brief.updatedAt = now;
    this.#appendTelemetry(id, {
      idempotencyKey: `compilation:${snapshot.compilation.revision}:approved`,
      occurredAt: now,
      payload: {
        name: "compilation.approved",
        metadata: { revision: snapshot.compilation.revision }
      }
    });
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
    if ([...this.#callPreparations.values()].some(
      (stored) =>
        stored.targetCallBriefId === id &&
        ["queued", "processing", "retrying"].includes(
          stored.preparation.status
        )
    )) {
      throw new CallRepositoryError("CALL_RECOMPILATION_IN_PROGRESS");
    }
    if (snapshot.brief.status !== "ready") {
      throw new CallRepositoryError("CALL_NOT_READY");
    }
    if (!snapshot.compilation) {
      throw new CallRepositoryError("CALL_COMPILATION_INTEGRITY_FAILED");
    }
    assertCompilationIntegrity(snapshot.compilation);
    if (appointmentPlanExpired(snapshot.compilation)) throw new CallRepositoryError("CALL_APPOINTMENT_EXPIRED");
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
    const currentCompilation = this.#currentCompilation(id);
    const receipt=this.#callText.getCurrentReviewReceipt(id);
    if(!receipt) throw new CallRepositoryError("CALL_REVIEW_REQUIRED");
    if (!currentCompilation.executionSnapshot) {
      throw new CallRepositoryError("CALL_COMPILATION_INTEGRITY_FAILED");
    }
    const attempt: CallAttemptRecord = {
      recipientContactHash: this.recipientOptOut.hash(snapshot.brief.phoneNumber),
      id: randomUUID(),
      callBriefId: id,
      compilationId: currentCompilation.id,
      reviewReceiptId: receipt.id,
      contentLanguage: snapshot.languageContext?.taskContentLanguage??null,
      provider: input.provider,
      providerCallId: null,
      status: "dialing",
      providerStatus: null,
      startedAt: now,
      endedAt: null,
      failureReason: null,
      compilationRevision: snapshot.compilation!.revision,
      compilationSnapshotHash: snapshot.compilation!.snapshotHash,
      executionSnapshot: copy(currentCompilation.executionSnapshot)
    };
    const attempts = this.#attempts.get(id) ?? [];
    attempts.push(attempt);
    this.#consentRuntimePolicies.set(attempt.id, copy(this.#voiceConsentSettings.policy));
    this.#attempts.set(id, attempts);
    if (userId !== null) {
      const period = this.#ensureBetaCredits(userId);
      const useBeta = (this.#buildCreditUsage(userId).funding?.allowance?.available ?? 0) > 0;
      this.#creditTransactions.push({
        id: randomUUID(),
        userId,
        amount: -1,
        type: "call_reservation",
        betaPeriodId: useBeta ? period!.id : null,
        expiresAt: useBeta ? period!.endsAt : null,
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
    this.#appendTelemetry(id, {
      callAttemptId: attempt.id,
      idempotencyKey: `attempt:${attempt.id}:started`,
      occurredAt: now,
      payload: {
        name: "attempt.started",
        metadata: { provider: attempt.provider }
      }
    });
    if (userId !== null) {
      this.#appendTelemetry(id, {
        callAttemptId: attempt.id,
        idempotencyKey: `attempt:${attempt.id}:credit:reserved`,
        occurredAt: now,
        payload: {
          name: "credit.reserved",
          metadata: { credits: 1 }
        }
      });
    }
    return { attempt: copy(attempt), snapshot: copy(snapshot) };
  }

  async attachProviderCall(
    attemptId: string,
    providerCallId: string,
    providerStatus: string,
    reconciliationRunAfter?: string
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
      const providerWasAttached = !attempt.providerCallId;
      if (attempt.recipientContactHash && provesRecipientContact(attempt.provider, providerCallId, providerStatus)) {
        this.recipientOptOut.recordContact(attempt.recipientContactHash);
      }
      if (providerWasAttached) {
        attempt.providerCallId = providerCallId;
        attempt.providerStatus = providerStatus;
      }
      if (providerWasAttached) {
        const safeProviderStatus = safeTelemetryCode(
          providerStatus,
          "unknown_provider_status"
        );
        this.#appendTelemetry(callId, {
          callAttemptId: attempt.id,
          idempotencyKey: `attempt:${attempt.id}:provider:created`,
          payload: {
            name: "provider.call_created",
            metadata: {
              provider: attempt.provider,
              providerStatus: safeProviderStatus
            }
          }
        });
      }
      const settlement = this.#settleAttempt(
        callId,
        attempt,
        creditSettlementForStatus(attempt.status, providerStatus)
      );
      if (connectedProviderStatuses.has(providerStatus)) {
        this.#appendConnectionTelemetry(callId, attempt.id, providerStatus);
      }
      if (settlement) {
        this.#appendSettlementTelemetry(callId, attempt.id, settlement);
      }
      if (
        reconciliationRunAfter &&
        attempt.provider === "twilio" &&
        !terminalStatuses.has(this.#require(callId).brief.status)
      ) {
        await this.enqueueDurableJob({
          type: "provider_call_reconciliation",
          callAttemptId: attempt.id,
          runAfter: reconciliationRunAfter,
          maxAttempts: durableJobMaxAttempts.provider_call_reconciliation
        });
      }
      return copy(this.#require(callId));
    }
    throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
  }

  async applyProviderStatus(
    providerCallId: string,
    providerStatus: string,
    callStatus: CallBrief["status"],
    callBriefId?: string,
    lease?: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    for (const [callId, attempts] of this.#attempts) {
      const attempt = attempts.find(
        (candidate) =>
          candidate.providerCallId === providerCallId ||
          (candidate.providerCallId === null && callId === callBriefId)
      );
      if (!attempt) continue;
      const snapshot = this.#require(callId);
      const now = new Date().toISOString();
      const previousCallStatus = snapshot.brief.status;
      const applyCallStatus = attempts.at(-1)?.id === attempt.id && shouldApplyProviderCallStatus(
        previousCallStatus,
        callStatus
      );
      const safeProviderStatus = safeTelemetryCode(
        providerStatus,
        "unknown_provider_status"
      );
      attempt.providerCallId ??= providerCallId;
      if (attempt.recipientContactHash && provesRecipientContact(attempt.provider, providerCallId, providerStatus)) {
        this.recipientOptOut.recordContact(attempt.recipientContactHash);
      }
      attempt.providerStatus = providerStatus;
      if (terminalStatuses.has(callStatus)) attempt.endedAt ??= now;
      if (callStatus === "failed") attempt.failureReason ??= providerStatus;
      const settlement = this.#settleAttempt(
        callId,
        attempt,
        creditSettlementForStatus(callStatus, providerStatus)
      );
      this.#appendTelemetry(callId, {
        callAttemptId: attempt.id,
        idempotencyKey: `attempt:${attempt.id}:provider-status:${safeProviderStatus}:${callStatus}`,
        occurredAt: now,
        payload: {
          name: "provider.status_changed",
          metadata: {
            providerStatus: safeProviderStatus,
            callStatus,
            applied: applyCallStatus
          }
        }
      });
      if (
        !terminalStatuses.has(previousCallStatus) &&
        connectedProviderStatuses.has(providerStatus)
      ) {
        this.#appendConnectionTelemetry(callId, attempt.id, providerStatus, now);
      }
      if (settlement) {
        this.#appendSettlementTelemetry(callId, attempt.id, settlement, now);
      }
      if (shouldApplyProviderCallStatus(attempt.status,callStatus)) attempt.status = callStatus;
      if (applyCallStatus) {
        snapshot.brief.status = callStatus;
        snapshot.brief.updatedAt = now;
      }
      if (
        terminalStatuses.has(callStatus) && snapshot.recording && this.#recordingAttempts.get(snapshot.recording.id)===attempt.id &&
        (snapshot.recording?.status === "starting" ||
          snapshot.recording?.status === "recording")
      ) {
        snapshot.recording.status = "processing";
      }
      if (terminalStatuses.has(callStatus)) {
        this.#wakeDurableJob(
          "provider_call_reconciliation",
          attempt.id,
          now
        );
      }
      return { callId, attemptId: attempt.id, snapshot: copy(snapshot) };
    }
    return null;
  }

  async updateStatus(id: string, status: CallBrief["status"]) {
    const snapshot = this.#require(id);
    const previousStatus = snapshot.brief.status;
    snapshot.brief.status = status;
    snapshot.brief.updatedAt = new Date().toISOString();
    const attempts = this.#attempts.get(id) ?? [];
    const attempt = attempts[attempts.length - 1];
    if (attempt) {
      attempt.status = status;
      if (terminalStatuses.has(status)) attempt.endedAt = snapshot.brief.updatedAt;
      const settlement = this.#settleAttempt(
        id,
        attempt,
        creditSettlementForStatus(status)
      );
      if (status === "in_progress" && !terminalStatuses.has(previousStatus)) {
        this.#appendConnectionTelemetry(
          id,
          attempt.id,
          "in-progress",
          snapshot.brief.updatedAt
        );
      }
      if (settlement) {
        this.#appendSettlementTelemetry(
          id,
          attempt.id,
          settlement,
          snapshot.brief.updatedAt
        );
      }
      if (terminalStatuses.has(status)) {
        this.#wakeDurableJob(
          "provider_call_reconciliation",
          attempt.id,
          snapshot.brief.updatedAt
        );
      }
    }
    return copy(snapshot);
  }

  async addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string,
    locale: CallLocale,
    nativeTiming?: TranscriptSegment["nativeTiming"],
    applicationPlayback?: TranscriptSegment["applicationPlayback"]
  ) {
    const snapshot = this.#require(id);
    const existing=snapshot.transcript.find(s=>(nativeTiming && s.nativeTiming?.sessionId===nativeTiming.sessionId && s.nativeTiming.eventId===nativeTiming.eventId) ||
      (applicationPlayback && s.applicationPlayback?.sessionId===applicationPlayback.sessionId && s.applicationPlayback.markId===applicationPlayback.markId));
    if(existing) return {segment:copy(existing),snapshot:copy(snapshot)};
    const segment: TranscriptSegment = {
      ingestionSequence:snapshot.transcript.length+1,receivedAt:new Date().toISOString(),callAttemptId:this.#attempts.get(id)?.at(-1)?.id??null,
      id: randomUUID(),
      role,
      text,
      locale,
      final: true,
      createdAt: nativeTiming ? new Date(Date.parse(nativeTiming.sessionStartedAt) + nativeTiming.startMs).toISOString() : applicationPlayback?.sentAt ?? new Date().toISOString(),
      ...(nativeTiming ? { nativeTiming } : {}),
      ...(applicationPlayback ? { applicationPlayback } : {})
    };
    snapshot.transcript.push(segment);
    return { segment: copy(segment), snapshot: copy(snapshot) };
  }

  async qualifyConversationCredit(id: string, attemptId: string, input: ConversationCreditEvidence) {
    const evidence = conversationCreditEvidenceSchema.parse(input);
    const snapshot = this.#require(id);
    const attempt = (this.#attempts.get(id) ?? []).find(item => item.id === attemptId);
    const recording = snapshot.recording;
    const question = snapshot.transcript.find(item => item.id === evidence.questionSegmentId);
    const answer = snapshot.transcript.find(item => item.id === evidence.answerSegmentId);
    if (!attempt || attempt.endedAt || !recording?.startedAt || !recording.providerRecordingId ||
        this.#recordingAttempts.get(recording.id) !== attemptId ||
        question?.role !== "assistant" || answer?.role !== "recipient" || !question.final || !answer.final ||
        !question.text.trim() || !answer.text.trim() || question.createdAt < recording.consentGrantedAt ||
        question.createdAt < attempt.startedAt || answer.createdAt < question.createdAt) return false;
    return this.#settleAttempt(id, attempt, "call_charge", evidence) === "call_charge";
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
      const settlement = this.#settleAttempt(id, attempt, "call_refund");
      if (settlement) {
        this.#appendSettlementTelemetry(
          id,
          attempt.id,
          settlement,
          snapshot.brief.updatedAt
        );
      }
      this.#wakeDurableJob(
        "provider_call_reconciliation",
        attempt.id,
        snapshot.brief.updatedAt
      );
    }
    if (
      snapshot.recording?.status === "starting" ||
      snapshot.recording?.status === "recording"
    ) {
      snapshot.recording.status = "processing";
    }
    return copy(snapshot);
  }

  async beginRecording(
    id: string,
    evidence?: import("@callassist/contracts").ConsentEvidence
  ) {
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
    const events = (this.#callTelemetryEvents.get(id) ?? []).map(e => e.event).filter(e => e.callAttemptId === attempt.id);
    const answeringEvent = events.findLast(e => e.payload.name === "answering.updated");
    const answering = answeringEvent?.payload.name === "answering.updated" ? answeringEvent.payload.metadata : undefined;
    if (answering?.execution === "async" && (answering.actionDispatched ||
        events.some(e => e.payload.name === "call.stop" && e.payload.metadata.phase === "requested"))) {
      throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    }
    if (evidence) {
      evidence = consentEvidenceSchema.parse(evidence);
      if (evidence.consentDecision) {
        const decision = evidence.consentDecision;
        if (evidence.callAttemptId !== attempt.id || decision.callAttemptId !== attempt.id ||
            decision.disclosureReceiptId !== evidence.disclosureReceiptId || decision.decision !== "affirmative" ||
            decision.decisionMethod !== evidence.decisionMethod || decision.locale !== evidence.locale ||
            (evidence.method === "dtmf") !== (decision.decisionMethod === "dtmf")) throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
        evidence = { ...evidence, decisionId: this.#recordConsentDecision(id, decision) };
      }
    }
    const consentEvents = (this.#callTelemetryEvents.get(id) ?? []).map(e => e.event).filter(e => e.callAttemptId === attempt.id);
    evidence = validateConsentGrant(evidence, attempt.id, consentEvents,
      !!this.#runtimeDescriptors.get(attempt.id)?.consentPolicy || consentEvents.some(e => e.payload.name === "disclosure.completed"));
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
    this.#recordingAttempts.set(recording.id,attempt.id);
    this.#appendTelemetry(id, {
      callAttemptId: attempt.id,
      idempotencyKey: `attempt:${attempt.id}:consent:granted`,
      occurredAt: consentGrantedAt,
      payload: {
        name: "consent.granted",
        metadata: evidence ?? { method: "dtmf_1" }
      }
    });
    this.#appendTelemetry(id, { callAttemptId: attempt.id, idempotencyKey: `recording:${recording.id}:requested`,
      occurredAt: consentGrantedAt, payload: { name: "recording.requested", metadata: { recordingId: recording.id,
        ...(evidence?.decisionId ? { decisionId: evidence.decisionId, disclosureReceiptId: evidence.disclosureReceiptId } : {}) } } });
    return {
      providerCallId: attempt.providerCallId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  async attachProviderRecording(
    recordingId: string,
    providerRecordingId: string,
    _providerStatus: string,
    reconciliationRunAfter?: string
  ) {
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    if (!["starting", "recording", "processing", "available"].includes(recording.status) ||
        (recording.providerRecordingId && recording.providerRecordingId !== providerRecordingId))
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    recording.providerRecordingId = providerRecordingId;
    if (recording.status === "starting") recording.status = "recording";
    recording.startedAt ??= new Date().toISOString();
    if (recording.status !== "failed") recording.failureReason = null;
    const attempt = (this.#attempts.get(callId) ?? []).find(a=>a.id===this.#recordingAttempts.get(recordingId));
    if(attempt && recording.consentGrantedAt && recording.startedAt) this.#consentedRecordingAttempts.add(attempt.id);
    const providerStatus = safeTelemetryCode(
      _providerStatus,
      "unknown_provider_status"
    );
    this.#appendTelemetry(callId, {
      callAttemptId: attempt?.id ?? null,
      idempotencyKey: `recording:${recordingId}:started`,
      occurredAt: recording.startedAt,
      payload: {
        name: "recording.started",
        metadata: { providerStatus, recordingId, providerRecordingId }
      }
    });
    if (
      reconciliationRunAfter &&
      ["recording", "processing"].includes(recording.status)
    ) {
      await this.enqueueDurableJob({
        type: "provider_recording_reconciliation",
        recordingId,
        runAfter: reconciliationRunAfter,
        maxAttempts: durableJobMaxAttempts.provider_recording_reconciliation
      });
    }
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
    const attempt = (this.#attempts.get(callId) ?? []).at(-1);
    const failureCode = safeTelemetryCode(
      failureReason,
      "recording_failed"
    );
    this.#appendTelemetry(callId, {
      callAttemptId: attempt?.id ?? null,
      idempotencyKey: `recording:${recordingId}:failed:${failureCode}`,
      payload: {
        name: "recording.failed",
        metadata: { failureCode }
      }
    });
    return {
      callId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  async applyRecordingStatus(
    input: RecordingStatusInput,
    lease?: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
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
    if (input.providerStatus === "in-progress") recording.startedAt ??= input.startedAt ?? new Date().toISOString();
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
    if(recording.consentGrantedAt && recording.startedAt) this.#consentedRecordingAttempts.add(attempt.id);
    if (recording.status !== "deleted" && input.providerStatus === "in-progress") {
      this.#appendTelemetry(input.callBriefId, {
        callAttemptId: attempt.id,
        idempotencyKey: `recording:${input.recordingId}:started`,
        occurredAt: recording.startedAt ?? undefined,
        payload: {
          name: "recording.started",
          metadata: { providerStatus: "in-progress", recordingId: input.recordingId, providerRecordingId: input.providerRecordingId,
            ...(input.startedAt ? { providerReportedAt: input.startedAt } : {}) }
        }
      });
    } else if (input.providerStatus === "completed") {
      this.#appendTelemetry(input.callBriefId, {
        callAttemptId: attempt.id,
        idempotencyKey: `recording:${input.recordingId}:completed`,
        occurredAt: recording.completedAt ?? undefined,
        payload: {
          name: "recording.completed",
          metadata: {
            durationSeconds: recording.durationSeconds,
            channels: recording.channels
          }
        }
      });
      recording.deleteAfter ??= new Date(Date.parse(recording.completedAt??new Date().toISOString())+snapshot.brief.audioRetentionDays*86_400_000).toISOString();
      await this.enqueueDurableJob({type:'recording_retention',recordingId:input.recordingId,runAfter:recording.deleteAfter,maxAttempts:durableJobMaxAttempts.recording_retention});
    } else if (input.providerStatus === "absent") {
      const failureCode = safeTelemetryCode(
        recording.failureReason,
        "recording_absent"
      );
      this.#appendTelemetry(input.callBriefId, {
        callAttemptId: attempt.id,
        idempotencyKey: `recording:${input.recordingId}:failed:${failureCode}`,
        payload: {
          name: "recording.failed",
          metadata: { failureCode }
        }
      });
    }
    if (["completed", "absent"].includes(input.providerStatus)) {
      this.#wakeDurableJob(
        "provider_recording_reconciliation",
        input.recordingId,
        new Date().toISOString()
      );
    }
    return {
      callId: input.callBriefId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  readonly #nativeCaptures = new Map<string, NativeTranscriptCapture>();
  async setNativeTranscriptCapture(callId: string, attemptId: string, capture: NativeTranscriptCapture) {
    const snapshot = this.#require(callId);
    if (!snapshot || !(this.#attempts.get(callId) ?? []).some(a => a.id === attemptId)) return;
    const previous=this.#nativeCaptures.get(attemptId);
    if(!previous || (previous.sessionId===capture.sessionId && previous.status==="collecting")) this.#nativeCaptures.set(attemptId,copy(capture));
  }
  async getNativeTranscriptWork(recordingId: string) {
    const {callId,snapshot}=this.#requireRecording(recordingId);
    const attempt=(this.#attempts.get(callId)??[]).at(-1);
    return {capture:copy(this.#nativeCaptures.get(attempt?.id??"")??null),snapshot:copy(snapshot)};
  }

  async getNativeTranscriptAttemptWork(callId: string, attemptId: string) {
    const attempt=this.#attempts.get(callId)?.at(-1);
    if(!attempt || attempt.id!==attemptId) throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    return {capture:copy(this.#nativeCaptures.get(attemptId)??null),snapshot:(await this.get(callId))!,ended:["completed","failed","stopped"].includes(attempt.status)};
  }
  async publishNativeTranscript(callId: string, attemptId: string, result: NativeTranscriptResult, lease?: DurableJobLease, summaryGeneratorVersion?: string) {
    this.#assertDurableJobLease(lease);
    const snapshot=this.#require(callId);
    if(this.#attempts.get(callId)?.at(-1)?.id!==attemptId) throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    const previous=snapshot.finalTranscript?.source?.startsWith("live_") ? snapshot.finalTranscript : null;
    if(previous?.status==='completed' && !previous.quality) {
      previous.quality=copy(result.quality);
      return {callId,finalTranscript:copy(previous),snapshot:(await this.get(callId))!};
    }
    if(previous?.text===result.text && JSON.stringify(previous.segments)===JSON.stringify(result.segments)) {
      previous.quality=copy(result.quality);
      return {callId,finalTranscript:copy(previous),snapshot:(await this.get(callId))!};
    }
    const now=new Date().toISOString();
    snapshot.finalTranscript={id:previous?.id??randomUUID(),...copy(result),status:"completed",failureReason:null,
      createdAt:previous?.createdAt??now,updatedAt:now,completedAt:now};
    await this.#callText.persistRevision(callId,snapshot.finalTranscript.id,result.text,result.segments,now,
      result.quality.coverage==='unavailable'||(previous && !previous.quality)||(snapshot.recordingTranscript?.status==='completed'&&!snapshot.recordingTranscriptRequest) ? undefined : summaryGeneratorVersion,result.source);
    return {callId,finalTranscript:copy(snapshot.finalTranscript),snapshot:(await this.get(callId))!};
  }
  async requestRecordingTranscript(callId: string, userId: string, model: string) {
    const snapshot=this.#require(callId),recording=snapshot.recording;
    if(this.#owners.get(callId)!==userId) throw new CallRepositoryError("CALL_NOT_FOUND");
    if(!this.#callText.hooks.textAllowed(callId)) throw new CallRepositoryError("CALL_NOT_FOUND");
    if(snapshot.recordingTranscript?.status==='completed') return;
    if(!recording || recording.status!=='available' || (recording.deleteAfter && Date.parse(recording.deleteAfter)<=Date.now())) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    const job=this.#durableJobs.get(durableJobKey("final_transcription",recording.id));
    if(snapshot.recordingTranscriptRequest && job && ['queued','running'].includes(job.status)) return;
    const now=new Date().toISOString();
    snapshot.recordingTranscriptRequest ??= {id:randomUUID(),requestedAt:now,status:'queued'};
    snapshot.recordingTranscript={id:snapshot.recordingTranscript?.id??randomUUID(),source:'recording_asr',status:'processing',text:null,segments:[],model,
      failureReason:null,createdAt:snapshot.recordingTranscript?.createdAt??now,updatedAt:now,completedAt:null};
    await this.enqueueDurableJob({type:'final_transcription',recordingId:recording.id,runAfter:now,maxAttempts:durableJobMaxAttempts.final_transcription,force:true,restartTerminal:true});
  }

  async claimFinalTranscript(
    recordingId: string,
    model: string,
    force = false,
    lease?: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    const native = await this.getNativeTranscriptWork(recordingId);
    if (recording.status !== "available" && !(model.startsWith("live-native:") && native.capture?.status === "complete")) return null;
    if (snapshot.recordingTranscript?.status === "completed" && !force) return null;
    if (snapshot.recordingTranscript?.status === "processing" && !lease) return null;
    const retry = Boolean(snapshot.recordingTranscript);
    const now = new Date(Math.max(
      Date.now(),
      snapshot.recordingTranscript
        ? Date.parse(snapshot.recordingTranscript.updatedAt) + 1
        : 0
    )).toISOString();
    const finalTranscript: FinalTranscript = snapshot.recordingTranscript
      ? {
          ...snapshot.recordingTranscript,
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
    finalTranscript.source = model.startsWith("live-native:") ? "live_native" : "recording_asr";
    snapshot.recordingTranscript = finalTranscript;
    if(!native.capture) snapshot.finalTranscript = finalTranscript;
    const attempt = (this.#attempts.get(callId) ?? []).at(-1);
    this.#appendTelemetry(callId, {
      callAttemptId: attempt?.id ?? null,
      idempotencyKey: `transcription:${finalTranscript.id}:started:${now}`,
      occurredAt: now,
      payload: {
        name: "transcription.started",
        metadata: {
          model: safeTelemetryCode(model, "unknown_model"),
          retry
        }
      }
    });
    return {
      callId,
      finalTranscript: copy(finalTranscript),
      snapshot: copy(snapshot)
    };
  }

  async completeFinalTranscript(
    recordingId: string,
    text: string,
    segments: FinalTranscriptSegment[],
    lease?: DurableJobLease,
    options?: {summaryGeneratorVersion?:string; source?: "recording_asr" | "live_native" | "live_composed"}
  ) {
    this.#assertDurableJobLease(lease);
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    const finalTranscript = snapshot.recordingTranscript;
    if (!finalTranscript) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    if(lease && (recording.status!=='available' || (recording.deleteAfter && Date.parse(recording.deleteAfter)<=Date.now()) || !this.#callText.hooks.textAllowed(callId))) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    const now = new Date();
    finalTranscript.status = "completed";
    finalTranscript.source = options?.source ?? "recording_asr";
    finalTranscript.model = finalTranscript.model.replace(/^live-native:/, "");
    finalTranscript.text = text;
    finalTranscript.segments = copy(segments);
    finalTranscript.failureReason = null;
    finalTranscript.updatedAt = now.toISOString();
    finalTranscript.completedAt = now.toISOString();
    await this.#callText.persistRevision(callId,finalTranscript.id,text,segments,now.toISOString(),options?.summaryGeneratorVersion,"recording_asr");
    const attempt = (this.#attempts.get(callId) ?? []).at(-1);
    this.#appendTelemetry(callId, {
      callAttemptId: attempt?.id ?? null,
      idempotencyKey: `transcription:${finalTranscript.id}:completed:${finalTranscript.updatedAt}`,
      occurredAt: finalTranscript.completedAt,
      payload: {
        name: "transcription.completed",
        metadata: {
          model: safeTelemetryCode(finalTranscript.model, "unknown_model"),
          segmentCount: segments.length
        }
      }
    });
    return {
      callId,
      finalTranscript: copy(finalTranscript),
      snapshot: copy(snapshot)
    };
  }

  async failFinalTranscript(
    recordingId: string,
    failureReason: string,
    lease?: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    const { callId, snapshot } = this.#requireRecording(recordingId);
    const finalTranscript = snapshot.recordingTranscript;
    if (!finalTranscript) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    finalTranscript.status = "failed";
    finalTranscript.text = null;
    finalTranscript.segments = [];
    finalTranscript.failureReason = failureReason;
    finalTranscript.updatedAt = new Date().toISOString();
    const attempt = (this.#attempts.get(callId) ?? []).at(-1);
    const failureCode = safeTelemetryCode(
      failureReason,
      "transcription_failed"
    );
    this.#appendTelemetry(callId, {
      callAttemptId: attempt?.id ?? null,
      idempotencyKey: `transcription:${finalTranscript.id}:failed:${finalTranscript.updatedAt}`,
      occurredAt: finalTranscript.updatedAt,
      payload: {
        name: "transcription.failed",
        metadata: {
          model: safeTelemetryCode(finalTranscript.model, "unknown_model"),
          failureCode
        }
      }
    });
    return {
      callId,
      finalTranscript: copy(finalTranscript),
      snapshot: copy(snapshot)
    };
  }

  async requestRecordingDeletion(id: string) {
    const recording=this.#require(id).recording;
    if(!recording || recording.status!=='available') throw new CallRepositoryError('RECORDING_NOT_FOUND');
    recording.deleteAfter=new Date(Math.min(Date.now(),recording.deleteAfter?Date.parse(recording.deleteAfter):Infinity)).toISOString();
    await this.enqueueDurableJob({type:'recording_retention',recordingId:recording.id,runAfter:recording.deleteAfter,maxAttempts:durableJobMaxAttempts.recording_retention});
  }
  async markRecordingDeleted(id: string, lease?: DurableJobLease) {
    this.#assertDurableJobLease(lease);
    const snapshot = this.#require(id);
    const recording = snapshot.recording;
    if (!recording) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    for (const [key, chunk] of this.#postCallTranscriptionChunks) {
      if (chunk.recordingId === recording.id) {
        this.#postCallTranscriptionChunks.delete(key);
      }
    }
    const job=this.#durableJobs.get(durableJobKey('final_transcription',recording.id));
    if(job && ['queued','running'].includes(job.status)) Object.assign(job,{status:'cancelled',leaseOwner:null,leasedAt:null,leaseExpiresAt:null,lastErrorCode:'RECORDING_NOT_AVAILABLE',completedAt:new Date().toISOString()});
    recording.status = "deleted";
    recording.deletedAt = new Date().toISOString();
    return { callId: id, recording: copy(recording), snapshot: copy(snapshot) };
  }

  async enqueueDurableJob(input: EnqueueDurableJobInput) {
    const target = this.#resolveDurableJobTarget(input);
    const key = durableJobKey(input.type, target.targetId);
    const existing = this.#durableJobs.get(key);
    if(input.type==="text_artifact_generation" && (input.maxAttempts>3 || (input.restartTerminal && existing && existing.generation>=3))) {
      throw new CallRepositoryError("TEXT_ARTIFACT_LIMIT_REACHED");
    }
    const now = new Date().toISOString();
    if (!existing) {
      const job: DurableJob = {
        id: randomUUID(),
        type: input.type,
        recordingId: input.recordingId ?? null,
        callAttemptId: input.callAttemptId ?? null,
        callPreparationId: input.callPreparationId ?? null,
        textArtifactId: input.textArtifactId ?? null,
        callId: target.callId,
        status: "queued",
        generation: 1,
        attemptCount: 0,
        maxAttempts: input.maxAttempts,
        runAfter: input.runAfter,
        forceRequested: input.force ?? false,
        leaseOwner: null,
        leasedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      };
      this.#durableJobs.set(key, job);
      return copy(job);
    }
    if (
      input.restartTerminal &&
      ["succeeded", "dead_letter", "cancelled"].includes(existing.status)
    ) {
      Object.assign(existing, {
        status: "queued" as const,
        generation: existing.generation + 1,
        attemptCount: 0,
        maxAttempts: input.maxAttempts,
        runAfter: input.runAfter,
        forceRequested: input.force ?? false,
        leaseOwner: null,
        leasedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        updatedAt: now,
        completedAt: null
      });
    } else if (existing.status === "queued") {
      existing.runAfter = existing.runAfter < input.runAfter
        ? existing.runAfter
        : input.runAfter;
      existing.forceRequested ||= input.force ?? false;
      existing.updatedAt = now;
    }
    return copy(existing);
  }

  async seedDurableJobs(now: string) {
    const before = this.#durableJobs.size;
    for (const snapshot of this.#calls.values()) {
      const attempts = this.#attempts.get(snapshot.brief.id) ?? [];
      const attempt = attempts.at(-1);
      if (
        interruptedStatuses.has(snapshot.brief.status) &&
        attempt?.provider === "twilio" &&
        attempt.providerCallId
      ) {
        await this.enqueueDurableJob({
          type: "provider_call_reconciliation",
          callAttemptId: attempt.id,
          runAfter: now,
          maxAttempts: durableJobMaxAttempts.provider_call_reconciliation
        });
      }
      for (const terminalAttempt of attempts) {
        if (
          terminalStatuses.has(terminalAttempt.status) &&
          terminalAttempt.provider === "twilio" &&
          terminalAttempt.providerCallId
        ) {
          await this.enqueueDurableJob({
            type: "provider_call_cost_reconciliation",
            callAttemptId: terminalAttempt.id,
            runAfter: now,
            maxAttempts: durableJobMaxAttempts.provider_call_cost_reconciliation
          });
        }
      }
      const recording = snapshot.recording;
      if (
        recording?.providerRecordingId &&
        ["recording", "processing"].includes(recording.status)
      ) {
        await this.enqueueDurableJob({
          type: "provider_recording_reconciliation",
          recordingId: recording.id,
          runAfter: now,
          maxAttempts: durableJobMaxAttempts.provider_recording_reconciliation
        });
      }
      const capture=attempt ? this.#nativeCaptures.get(attempt.id) : null;
      if(capture && !snapshot.finalTranscript?.quality && attempt) await this.enqueueDurableJob({type:'live_transcript_finalization',callAttemptId:attempt.id,runAfter:now,maxAttempts:durableJobMaxAttempts.live_transcript_finalization});
      if (recording?.status !== "available") continue;
      if (
        snapshot.recordingTranscriptRequest && snapshot.recordingTranscript?.status !== "completed" && (!recording.deleteAfter || recording.deleteAfter>now)
      ) {
        await this.enqueueDurableJob({
          type: "final_transcription",
          recordingId: recording.id,
          runAfter: now,
          maxAttempts: durableJobMaxAttempts.final_transcription
        });
      }
      if (
        recording.deleteAfter
      ) {
        await this.enqueueDurableJob({
          type: "recording_retention",
          recordingId: recording.id,
          runAfter: recording.deleteAfter,
          maxAttempts: durableJobMaxAttempts.recording_retention
        });
      }
    }
    return this.#durableJobs.size - before;
  }

  async expireCallAssessments(now: string) {
    for (const [id, assessment] of this.#assessments) {
      if (assessment.summary.status !== "pending" || !assessment.summary.deadlineAt || assessment.summary.deadlineAt > now) continue;
      for (const [callId, attempts] of this.#attempts) {
        const attempt = attempts.find(a=>a.id===id);
        if (attempt) {
          const settled = this.#settleAttempt(callId,attempt,"call_refund",undefined,true);
          if (settled) this.#appendSettlementTelemetry(callId,id,settled,now);
        }
      }
      assessment.summary = {...assessment.summary,status:"unavailable",reason:"deadline",updatedAt:now};
    }
  }

  async claimDueDurableJob(input: ClaimDurableJobInput) {
    await this.expireCallAssessments(input.now);
    for (const job of this.#durableJobs.values()) {
      if (
        job.status === "running" &&
        input.types.includes(job.type) &&
        job.leaseExpiresAt &&
        job.leaseExpiresAt <= input.now
      ) {
        const deadLetter = job.attemptCount >= job.maxAttempts;
        this.#durableJobAttempts.push({
          id: randomUUID(),
          jobId: job.id,
          generation: job.generation,
          attemptNumber: job.attemptCount,
          workerId: job.leaseOwner!,
          startedAt: job.leasedAt!,
          completedAt: input.now,
          outcome: deadLetter ? "dead_letter" : "lease_expired",
          errorCode: "worker_lease_expired"
        });
        job.status = deadLetter ? "dead_letter" : "queued";
        job.runAfter = input.now;
        job.leaseOwner = null;
        job.leasedAt = null;
        job.leaseExpiresAt = null;
        job.lastErrorCode = "worker_lease_expired";
        job.updatedAt = input.now;
        job.completedAt = deadLetter ? input.now : null;
        this.#settleCallPreparationFailure(
          job,
          deadLetter,
          "worker_lease_expired",
          input.now
        );
      }
    }
    const active = [...this.#durableJobs.values()].filter(j => j.status === "running");
    const workClass = (job: DurableJob) => job.workClass ?? this.#workClass(job);
    const owner = (job: DurableJob) => job.callPreparationId ? this.#callPreparations.get(job.callPreparationId)?.userId ?? "" : "";
    const job = [...this.#durableJobs.values()]
      .filter((candidate) =>
        candidate.status === "queued" &&
        candidate.runAfter <= input.now &&
        input.types.includes(candidate.type) &&
        (!input.workClasses || input.workClasses.includes(workClass(candidate))) &&
        (workClass(candidate) !== "preparation" || (active.filter(j => workClass(j) === "preparation").length < this.#preparationSettings.capacity.generationSlots &&
          !active.some(j => workClass(j) === "preparation" && owner(j) === owner(candidate)))) &&
        (workClass(candidate) !== "review" || active.filter(j => workClass(j) === "review").length < this.#preparationSettings.capacity.reviewSlots)
      )
      .sort((left, right) =>
        (this.#preparationDispatch.get(owner(left)) ?? "").localeCompare(this.#preparationDispatch.get(owner(right)) ?? "") ||
        left.runAfter.localeCompare(right.runAfter) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      )[0];
    if (!job) return null;
    if (job.callPreparationId) this.#preparationDispatch.set(owner(job),input.now);
    const forceRequested = job.forceRequested;
    job.status = "running";
    job.attemptCount += 1;
    job.forceRequested = false;
    job.leaseOwner = input.workerId;
    job.leasedAt = input.now;
    job.leaseExpiresAt = input.leaseExpiresAt;
    job.updatedAt = input.now;
    return copy({ ...job, forceRequested });
  }

  async renewDurableJobLease(
    jobId: string,
    workerId: string,
    now: string,
    leaseExpiresAt: string,
    fence?: DurableJobLease
  ) {
    const job = this.#findDurableJob(jobId);
    if (!job || !durableJobLeaseIsValid(job, workerId, now) || (fence?.generation !== undefined && job.generation !== fence.generation) || (fence?.attemptNumber !== undefined && job.attemptCount !== fence.attemptNumber)) return false;
    job.leaseExpiresAt = leaseExpiresAt;
    job.updatedAt = now;
    return true;
  }

  async completeDurableJob(jobId: string, workerId: string, now: string, fence?: DurableJobLease) {
    const job = this.#findDurableJob(jobId);
    if (!job || !durableJobLeaseIsValid(job, workerId, now) || (fence?.generation !== undefined && job.generation !== fence.generation) || (fence?.attemptNumber !== undefined && job.attemptCount !== fence.attemptNumber)) return false;
    if (job.callPreparationId) {
      const preparation = this.#callPreparations.get(job.callPreparationId);
      if (preparation?.preparation.status !== "succeeded") {
        throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
      }
    }
    this.#durableJobAttempts.push({
      id: randomUUID(),
      jobId,
      generation: job.generation,
      attemptNumber: job.attemptCount,
      workerId,
      startedAt: job.leasedAt!,
      completedAt: now,
      outcome: "succeeded",
      errorCode: null
    });
    job.status = "succeeded";
    job.leaseOwner = null;
    job.leasedAt = null;
    job.leaseExpiresAt = null;
    job.lastErrorCode = null;
    job.updatedAt = now;
    job.completedAt = now;
    return true;
  }

  async failDurableJob(
    jobId: string,
    workerId: string,
    errorCode: string,
    now: string,
    retryAt: string,
    retryable = true,
    defer = false,
    fence?: DurableJobLease
  ) {
    const job = this.#findDurableJob(jobId);
    if (!job || !durableJobLeaseIsValid(job, workerId, now) || (fence?.generation !== undefined && job.generation !== fence.generation) || (fence?.attemptNumber !== undefined && job.attemptCount !== fence.attemptNumber)) return null;
    if (defer && ((job.type === "final_transcription" && /^BETA_(BUDGET_EXHAUSTED|BUDGET_UNCONFIGURED|SPENDING_PAUSED)$/.test(errorCode)) || errorCode === "PREPARATION_PROVIDER_BUSY")) {
      job.attemptCount = Math.max(0, job.attemptCount - 1);
      job.status = "queued"; job.runAfter = retryAt; job.lastErrorCode = errorCode;
      job.leaseOwner = null; job.leasedAt = null; job.leaseExpiresAt = null;
      job.updatedAt = now; job.completedAt = null;
      const preparation=job.callPreparationId ? this.#callPreparations.get(job.callPreparationId) : undefined;
      if (preparation?.preparation.status==='processing') { preparation.preparation.status='retrying'; preparation.preparation.updatedAt=now; }
      const artifact=job.textArtifactId ? this.#callText.artifacts.get(job.textArtifactId) : undefined;
      if (artifact?.status==='processing') { artifact.status='queued'; artifact.updatedAt=now; }
      return copy(job);
    }
    const deadLetter = !retryable || job.attemptCount >= job.maxAttempts;
    const cancelled = job.type === "text_artifact_generation" && errorCode === "TEXT_ARTIFACT_STALE";
    this.#durableJobAttempts.push({
      id: randomUUID(),
      jobId,
      generation: job.generation,
      attemptNumber: job.attemptCount,
      workerId,
      startedAt: job.leasedAt!,
      completedAt: now,
      outcome: cancelled ? "cancelled" : deadLetter ? "dead_letter" : "retry_scheduled",
      errorCode
    });
    job.status = cancelled ? "cancelled" : deadLetter ? "dead_letter" : "queued";
    job.runAfter = deadLetter ? job.runAfter : retryAt;
    job.leaseOwner = null;
    job.leasedAt = null;
    job.leaseExpiresAt = null;
    job.lastErrorCode = errorCode;
    job.updatedAt = now;
    job.completedAt = cancelled || deadLetter ? now : null;
    this.#settleCallPreparationFailure(job, deadLetter, errorCode, now);
    return copy(job);
  }

  async listDurableJobs() {
    return [...this.#durableJobs.values()].map(copy);
  }

  async listDurableJobAttempts(jobId: string) {
    return this.#durableJobAttempts
      .filter((attempt) => attempt.jobId === jobId)
      .map(copy);
  }

  async retryDurableJob(
    jobId: string,
    actorUserId: string,
    reason: string,
    now: string
  ) {
    const job = this.#findDurableJob(jobId);
    if (!job) throw new CallRepositoryError("DURABLE_JOB_NOT_FOUND");
    if (job.status !== "dead_letter" || job.type === "brief_compilation" || job.type === "text_artifact_generation") {
      throw new CallRepositoryError("DURABLE_JOB_NOT_RETRYABLE");
    }
    const boundedReason = requireAdminJobReason(reason);
    job.status = "queued";
    job.generation += 1;
    job.attemptCount = 0;
    job.runAfter = now;
    job.forceRequested = job.type === "final_transcription";
    job.leaseOwner = null;
    job.leasedAt = null;
    job.leaseExpiresAt = null;
    job.lastErrorCode = null;
    job.updatedAt = now;
    job.completedAt = null;
    this.#durableJobAdminEvents.push({
      jobId,
      actorUserId,
      reason: boundedReason,
      createdAt: now
    });
    return copy(job);
  }

  durableJobAdminEventsForTest() {
    return copy(this.#durableJobAdminEvents);
  }

  async recoverInterruptedCalls() {
    let recovered = 0;
    for (const snapshot of this.#calls.values()) {
      if (!interruptedStatuses.has(snapshot.brief.status)) continue;
      if (snapshot.pendingApproval) snapshot.pendingApproval.status = "expired";
      snapshot.pendingApproval = null;
      const attempts = this.#attempts.get(snapshot.brief.id) ?? [];
      const attempt = attempts[attempts.length - 1];
      const now = new Date().toISOString();
      const reconcileProvider =
        attempt?.provider === "twilio" && attempt.providerCallId;
      if (reconcileProvider) {
        await this.enqueueDurableJob({
          type: "provider_call_reconciliation",
          callAttemptId: attempt.id,
          runAfter: now,
          maxAttempts: durableJobMaxAttempts.provider_call_reconciliation
        });
      } else {
        snapshot.brief.status = "failed";
        snapshot.brief.updatedAt = now;
      }
      if (attempt && !reconcileProvider) {
        attempt.status = "failed";
        attempt.endedAt = now;
        attempt.failureReason = "server_restarted";
        const settlement = this.#settleAttempt(
          snapshot.brief.id,
          attempt,
          "call_refund"
        );
        if (settlement) {
          this.#appendSettlementTelemetry(
            snapshot.brief.id,
            attempt.id,
            settlement,
            now
          );
        }
      }
      if (!reconcileProvider) {
        this.#appendTelemetry(snapshot.brief.id, {
          callAttemptId: attempt?.id ?? null,
          idempotencyKey: "call:recovered:server-restarted",
          occurredAt: now,
          payload: {
            name: "call.recovered",
            metadata: { reason: "server_restarted" }
          }
        });
      }
      recovered += 1;
    }
    return recovered;
  }

  async ping() {}

  async close() {}

  #buildOutcomeView(callBriefId: string): CallOutcomeView {
    const snapshot = this.#require(callBriefId);
    const events = (this.#callTelemetryEvents.get(callBriefId) ?? [])
      .map(({ event }) => event);
    const latestOutcome = [...(this.#callOutcomeRevisions.get(callBriefId) ?? [])]
      .reverse()
      .find(({ revision }) => revision.outcome !== null)?.revision ?? null;
    const latestFeedback = this.#callFeedbackRevisions.get(callBriefId)
      ?.at(-1)?.revision ?? null;
    return callOutcomeViewSchema.parse({
      technical: deriveTechnicalCallOutcome(snapshot.brief.status, events),
      latestOutcome,
      latestFeedback,
      feedbackScope: latestFeedback ? callFeedbackScope(latestFeedback.createdAt,
        (this.#attempts.get(callBriefId) ?? []).map(attempt => attempt.startedAt)) : "call"
    });
  }

  #buildAdminCallSummary(callBriefId: string): AdminCallSummary {
    const snapshot = this.#require(callBriefId);
    const outcomeView = this.#buildOutcomeView(callBriefId);
    const feedback = outcomeView.latestFeedback;
    return adminCallSummarySchema.parse({
      id: callBriefId,
      ownerUserId: this.#owners.get(callBriefId) ?? null,
      status: snapshot.brief.status,
      locale: snapshot.brief.locale,
      createdAt: snapshot.brief.createdAt,
      updatedAt: snapshot.brief.updatedAt,
      technical: outcomeView.technical,
      lifecycle: this.#lifecycle(snapshot.brief),
      semanticOutcome: outcomeView.latestOutcome?.outcome ?? null,
      outcomeProvenance: outcomeView.latestOutcome?.provenance ?? null,
      feedback: feedback ? {
        revision: feedback.revision,
        goalResult: feedback.goalResult,
        transcriptQuality: feedback.transcriptQuality,
        scope: outcomeView.feedbackScope,
        createdAt: feedback.createdAt
      } : null,
      durationSeconds: snapshot.recording?.durationSeconds ?? null,
      eventCount: (this.#callTelemetryEvents.get(callBriefId) ?? []).length
    });
  }

  #lifecycle(brief: CallBrief) {
    const attemptIds = new Set((this.#attempts.get(brief.id) ?? []).map(({ id }) => id));
    return deriveCallLifecycle(brief.status, (this.#callTelemetryEvents.get(brief.id) ?? []).map(({ event }) => event), this.#creditTransactions.flatMap((entry) =>
      entry.callAttemptId && attemptIds.has(entry.callAttemptId) && (entry.type === "call_charge" || entry.type === "call_refund")
        ? [{ callAttemptId: entry.callAttemptId, settlement: entry.type === "call_charge" ? "charge" as const : "refund" as const, qualified: this.#qualifiedCreditAttempts.has(entry.callAttemptId) }] : []), [...attemptIds].flatMap(id => this.#displayAssessment(id) ?? []));
  }

  #appendConnectionTelemetry(
    callBriefId: string,
    callAttemptId: string,
    providerStatus: string,
    occurredAt?: string
  ) {
    if (providerStatus !== "in-progress" && providerStatus !== "completed") {
      return;
    }
    this.#appendTelemetry(callBriefId, {
      callAttemptId,
      idempotencyKey: `attempt:${callAttemptId}:connection`,
      occurredAt,
      payload: {
        name: "connection.confirmed",
        metadata: { providerStatus }
      }
    });
  }

  #appendSettlementTelemetry(
    callBriefId: string,
    callAttemptId: string,
    settlement: "call_charge" | "call_refund",
    occurredAt?: string
  ) {
    const normalized = settlement === "call_charge" ? "charge" : "refund";
    this.#appendTelemetry(callBriefId, {
      callAttemptId,
      idempotencyKey: `attempt:${callAttemptId}:credit:${normalized}`,
      occurredAt,
      payload: {
        name: "credit.settled",
        metadata: {
          settlement: normalized,
          connected: settlement === "call_charge" || (this.#callTelemetryEvents.get(callBriefId) ?? []).some(({ event }) =>
            event.callAttemptId === callAttemptId && event.payload.name === "connection.confirmed")
        }
      }
    });
  }

  #appendCompilationTelemetry(
    callBriefId: string,
    compilation: CallCompilation,
    occurredAt: string
  ) {
    this.#appendTelemetry(callBriefId, {
      idempotencyKey: `compilation:${compilation.revision}:completed`,
      occurredAt,
      payload: {
        name: "compilation.completed",
        metadata: {
          revision: compilation.revision,
          compilerModel: compilation.compilerModel,
          compilerVersion: compilation.compilerVersion,
          policyStatus: compilation.policyDecision.status
        }
      }
    });
    this.#appendTelemetry(callBriefId, {
      idempotencyKey: `policy:${compilation.revision}:evaluated`,
      occurredAt,
      payload: {
        name: "policy.evaluated",
        metadata: {
          policyVersion: compilation.policyDecision.policyVersion,
          status: compilation.policyDecision.status,
          riskLevel: compilation.policyDecision.riskLevel,
          reasonCodes: compilation.policyDecision.reasonCodes
        }
      }
    });
  }

  #appendTelemetry(
    callBriefId: string,
    input: CallTelemetryEventInput
  ): DurableCallEvent {
    const snapshot = this.#require(callBriefId);
    const parsed = callTelemetryEventInputSchema.parse(input);
    const stored = this.#callTelemetryEvents.get(callBriefId) ?? [];
    const existing = stored.find(
      ({ idempotencyKey }) => idempotencyKey === parsed.idempotencyKey
    );
    if (existing) return existing.event;
    if (
      parsed.callAttemptId &&
      !(this.#attempts.get(callBriefId) ?? []).some(
        ({ id }) => id === parsed.callAttemptId
      )
    ) {
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    const descriptor = describeCallTelemetryEvent(parsed.payload.name);
    const event = durableCallEventSchema.parse({
      id: randomUUID(),
      callBriefId,
      callAttemptId: parsed.callAttemptId,
      userId: this.#owners.get(snapshot.brief.id) ?? null,
      sequence: stored.length + 1,
      schemaVersion: CALL_TELEMETRY_SCHEMA_VERSION,
      ...descriptor,
      occurredAt: parsed.occurredAt ?? new Date().toISOString(),
      payload: parsed.payload
    });
    stored.push({ event, idempotencyKey: parsed.idempotencyKey });
    this.#callTelemetryEvents.set(callBriefId, stored);
    return event;
  }

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

  #failAssessment(artifact: CallTextArtifact) {
    if (artifact.kind !== "call_summary" || !supportsSummaryAssessment(artifact.generatorVersion) || !artifact.generatorVersion.includes(":openai:")) return;
    const revision=this.#callText.revisions.get(artifact.transcriptRevisionId??"")?.revision;
    const attempt=this.#attempts.get(artifact.callId)?.find(a=>a.id===revision?.callAttemptId);
    if (!attempt || attempt.compilationId !== artifact.compilationId || revision?.sourceHash !== artifact.sourceHash ||
      artifact.targetLanguage !== (attempt.contentLanguage ?? this.#require(artifact.callId).languageContext?.taskContentLanguage)) return;
    if (!this.#consentedRecordingAttempts.has(attempt.id)) return;
    const prior=this.#assessments.get(attempt.id) ?? {callAttemptId:attempt.id,compilationId:attempt.compilationId!,sourceHash:null,decision:null,
      summary:{status:"pending" as const,conversation:null,goal:null,reason:null,updatedAt:new Date().toISOString(),deadlineAt:null,transcriptRevisionId:null,evaluatorVersion:null}};
    if (prior?.summary.status !== "pending") return;
    prior.summary={...prior.summary,status:"unavailable",reason:"generation_failed",updatedAt:new Date().toISOString()};
    this.#assessments.set(attempt.id,prior);
    if (attempt.endedAt) {
      const settled=this.#settleAttempt(artifact.callId,attempt,"call_refund",undefined,true);
      if(settled) this.#appendSettlementTelemetry(artifact.callId,attempt.id,settled);
    }
  }

  #completeAssessment(artifact: CallTextArtifact) {
    if (artifact.kind !== "call_summary" || !artifact.payload || !("assessment" in artifact.payload) || !artifact.payload.assessment ||
      !supportsSummaryAssessment(artifact.generatorVersion) || !artifact.generatorVersion.includes(":openai:")) return;
    const revision=this.#callText.revisions.get(artifact.transcriptRevisionId??"")?.revision;
    const attempt=this.#attempts.get(artifact.callId)?.find(a=>a.id===revision?.callAttemptId);
    const compilation=this.#callText.getTextArtifactSourceCompilation(artifact.callId,artifact.compilationId??"");
    const snapshot=this.#require(artifact.callId);
    if (artifact.targetLanguage !== (attempt?.contentLanguage ?? snapshot.languageContext?.taskContentLanguage)) return;
    if (!revision || !attempt || attempt.compilationId !== artifact.compilationId || !compilation?.compiledBrief ||
      revision.sourceHash !== artifact.sourceHash || !this.#consentedRecordingAttempts.has(attempt.id)) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    let decision;
    try { decision=validateFinalAssessment(artifact.payload.assessment,revision.segments,compilation.compiledBrief.successCriteria.map((_,i)=>`criterion.${i}`)); }
    catch {throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");}
    const prior=this.#assessments.get(attempt.id);
    if (artifact.contextHash) this.#assessmentRevisions.set(artifact.id, { callAttemptId: attempt.id, compilationId: artifact.compilationId!,
      artifactId: artifact.id, contextHash: artifact.contextHash, sourceHash: revision.sourceHash, decision,
      summary: { status: "ready", conversation: decision.conversation.status, goal: decision.goal.status,
        reason: decision.conversation.status === "uncertain" ? "evidence_uncertain" : null, updatedAt: new Date().toISOString(),
        deadlineAt: null, transcriptRevisionId: revision.id, evaluatorVersion: `${assessmentVersion}:${artifact.generatorVersion}` } });
    if (prior?.summary.status==="ready" && prior.summary.transcriptRevisionId===revision.id) return;
    if (prior?.summary.deadlineAt && prior.summary.deadlineAt <= new Date().toISOString()) {
      const settled=this.#settleAttempt(artifact.callId,attempt,"call_refund",undefined,true);
      if(settled) this.#appendSettlementTelemetry(artifact.callId,attempt.id,settled);
    }
    const evaluatorVersion=`${assessmentVersion}:${artifact.generatorVersion}`;
    this.#assessments.set(attempt.id,{callAttemptId:attempt.id,compilationId:artifact.compilationId!,sourceHash:revision.sourceHash,decision,
      summary:{status:"ready",conversation:decision.conversation.status,goal:decision.goal.status,
        reason:decision.conversation.status==="uncertain"?"evidence_uncertain":null,updatedAt:new Date().toISOString(),
        deadlineAt:prior?.summary.deadlineAt??null,transcriptRevisionId:revision.id,evaluatorVersion}});
    if(attempt.endedAt) {
      const settled=this.#settleAttempt(artifact.callId,attempt,decision.conversation.status==="confirmed"?"call_charge":"call_refund",
        decision.conversation.status==="confirmed"?{version:2,transcriptRevisionId:revision.id,sourceHash:revision.sourceHash,evaluatorVersion,category:decision.conversation.category}:undefined,true);
      if(settled) this.#appendSettlementTelemetry(artifact.callId,attempt.id,settled);
    }
  }

  #settleAttempt(
    callBriefId: string,
    attempt: CallAttemptRecord,
    type: "call_charge" | "call_refund" | null,
    qualification?: ConversationCreditEvidence | FinalCreditEvidence,
    finalSettlement = false
  ): "call_charge" | "call_refund" | null {
    if (!type) return null;
    if (type === "call_charge" && !qualification) return null;
    const userId = this.#owners.get(callBriefId);
    if (!userId) return null;
    const hasReservation = this.#creditTransactions.some(
      (entry) =>
        entry.callAttemptId === attempt.id && entry.type === "call_reservation"
    );
    if (!hasReservation) return null;
    const alreadySettled = this.#creditTransactions.some(
      (entry) =>
        entry.callAttemptId === attempt.id &&
        (entry.type === "call_charge" || entry.type === "call_refund")
    );
    if (alreadySettled) return null;
    if (type === "call_refund" && !finalSettlement && this.#consentedRecordingAttempts.has(attempt.id) && attempt.compilationId && !this.#callDataDeletions.has(callBriefId)) {
      let assessment=this.#assessments.get(attempt.id);
      if (!assessment) {
        assessment={callAttemptId:attempt.id,compilationId:attempt.compilationId,sourceHash:null,decision:null,
          summary:{status:"pending",conversation:null,goal:null,reason:null,updatedAt:new Date().toISOString(),
            deadlineAt:new Date(Date.now()+assessmentDeadlineMs).toISOString(),transcriptRevisionId:null,evaluatorVersion:null}};
        this.#assessments.set(attempt.id,assessment);
      }
      if (assessment.summary.status === "pending") return null;
      if (assessment.summary.status === "ready" && assessment.decision?.conversation.status === "confirmed") {
        return this.#settleAttempt(callBriefId,attempt,"call_charge",{version:2,transcriptRevisionId:assessment.summary.transcriptRevisionId!,
          sourceHash:assessment.sourceHash!,evaluatorVersion:assessment.summary.evaluatorVersion!,category:assessment.decision.conversation.category},true);
      }
    }
    if (type === "call_charge" && qualification) this.#qualifiedCreditAttempts.add(attempt.id);
    this.#creditTransactions.push({
      id: randomUUID(),
      userId,
      amount: type === "call_refund" ? 1 : 0,
      betaPeriodId: this.#creditTransactions.find(t => t.callAttemptId === attempt.id && t.type === "call_reservation")?.betaPeriodId ?? null,
      expiresAt: this.#creditTransactions.find(t => t.callAttemptId === attempt.id && t.type === "call_reservation")?.expiresAt ?? null,
      type,
      callAttemptId: attempt.id,
      promoRedemptionId: null,
      adminId: null,
      reason:
        type === "call_refund"
          ? conversationCreditRefundReason
          : conversationCreditReason,
      idempotencyKey: `call:${attempt.id}:${type === "call_refund" ? "refund" : "charge"}`,
      createdAt: new Date().toISOString()
    });
    return type;
  }

  async getAttempt(id: string, attemptId: string) {
    this.#require(id);
    return copy((this.#attempts.get(id) ?? []).find(
      ({ id: candidateId }) => candidateId === attemptId
    ) ?? null);
  }

  #currentCompilation(id: string) {
    const current = this.#compilations.get(id)?.at(-1);
    if (!current?.compilation) {
      throw new CallRepositoryError("CALL_COMPILATION_INTEGRITY_FAILED");
    }
    return current;
  }

  #providerOperationMatchesScope(
    operation: ProviderOperationRecord | TextArtifactProviderOperationRecord | PostCallTranscriptionProviderOperationRecord |
      RealtimeProviderOperationRecord | TelephonyProviderOperationRecord,
    callId?: string,
    preparationId?: string
  ) {
    if (preparationId) {
      return "callPreparationId" in operation &&
        operation.callPreparationId === preparationId;
    }
    if (!callId) return true;
    if ("callBriefId" in operation && operation.callBriefId === callId) {
      return true;
    }
    if ("callPreparationId" in operation) {
      const preparation = this.#callPreparations.get(operation.callPreparationId);
      return (
        preparation?.preparation.callBriefId === callId ||
        preparation?.targetCallBriefId === callId
      );
    }
    return false;
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

  #findDurableJob(jobId: string) {
    return [...this.#durableJobs.values()].find(({ id }) => id === jobId);
  }

  #assertPostCallTranscriptionContext(
    input: PostCallTranscriptionChunkLookupInput,
    lease: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    const job = this.#findDurableJob(lease.jobId);
    const { callId, snapshot } = this.#requireRecording(input.recordingId);
    if (
      job?.type !== "final_transcription" ||
      job.recordingId !== input.recordingId ||
      job.generation !== input.durableJobGeneration ||
      callId !== input.callBriefId ||
      snapshot.recording?.status !== "available" ||
      snapshot.recordingTranscript?.status !== "processing" || !snapshot.recordingTranscriptRequest ||
      (snapshot.recording.deleteAfter!==null && Date.parse(snapshot.recording.deleteAfter)<=Date.now()) || !this.#callText.hooks.textAllowed(callId)
    ) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
  }

  #mapCallPreparation(stored: StoredCallPreparation): CallPreparation {
    const latest = [...this.#providerOperations.values()].filter((operation): operation is ProviderOperationRecord =>
      "callPreparationId" in operation && operation.callPreparationId === stored.preparation.id)
      .sort((a,b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0];
    const job = this.#durableJobs.get(
      durableJobKey("brief_compilation", stored.preparation.id)
    );
    return copy({
      ...stored.preparation,
      ...(latest ? { stage: latest.stage } : {}),
      attemptCount: job?.attemptCount ?? 0
    });
  }

  #settleCallPreparationFailure(
    job: DurableJob,
    deadLetter: boolean,
    errorCode: string,
    now: string
  ) {
    if(job.textArtifactId) {
      const artifact=this.#callText.artifacts.get(job.textArtifactId);
      if(artifact&&["queued","processing","failed"].includes(artifact.status)) Object.assign(artifact,{
        status:job.status==="cancelled"?"stale":deadLetter?"failed":"queued",
        failureCode:job.status==="cancelled"||deadLetter?errorCode:null,updatedAt:now
      });
    }
    if (!job.callPreparationId) return;
    const preparation = this.#callPreparations.get(job.callPreparationId);
    if (!preparation || preparation.preparation.status === "succeeded") return;
    preparation.preparation.status = deadLetter ? "failed" : "retrying";
    preparation.preparation.failureCode = deadLetter
      ? callPreparationFailureCode(errorCode)
      : null;
    preparation.preparation.updatedAt = now;
    preparation.preparation.completedAt = deadLetter ? now : null;
    if (deadLetter) preparation.input = null;
  }

  #resolveDurableJobTarget(input: EnqueueDurableJobInput) {
    if(input.type==="text_artifact_generation") {
      if(!input.textArtifactId||input.recordingId||input.callAttemptId||input.callPreparationId) throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
      const artifact=this.#callText.artifacts.get(input.textArtifactId);
      if(!artifact) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_FOUND");
      return {callId:artifact.callId,targetId:artifact.id};
    }
    if(input.textArtifactId) throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
    if (input.type === "brief_compilation") {
      if (input.recordingId || input.callAttemptId || !input.callPreparationId) {
        throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
      }
      return {
        callId: this.#callPreparations.get(input.callPreparationId)
          ?.targetCallBriefId ?? null,
        targetId: input.callPreparationId
      };
    }
    if (
      input.type === "live_transcript_finalization" || input.type === "answer_detection_timeout" || input.type === "provider_call_reconciliation" ||
      input.type === "provider_call_cost_reconciliation"
    ) {
      if (!input.callAttemptId || input.recordingId || input.callPreparationId) {
        throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
      }
      for (const [callId, attempts] of this.#attempts) {
        if (attempts.some(({ id }) => id === input.callAttemptId)) {
          return { callId, targetId: input.callAttemptId };
        }
      }
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    if (!input.recordingId || input.callAttemptId || input.callPreparationId) {
      throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
    }
    const { callId } = this.#requireRecording(input.recordingId);
    return { callId, targetId: input.recordingId };
  }

  #wakeDurableJob(
    type: DurableJob["type"],
    targetId: string,
    now: string
  ) {
    const job = this.#durableJobs.get(durableJobKey(type, targetId));
    if (job?.status !== "queued") return;
    job.runAfter = job.runAfter < now ? job.runAfter : now;
    job.updatedAt = now;
  }

  #workClass(job: Pick<DurableJob, "type" | "textArtifactId">): import("../jobs/durable-job").DurableWorkClass {
    if (job.type === "brief_compilation") return "preparation";
    if (job.type === "text_artifact_generation" && job.textArtifactId && ["plan_review","clarification_review"].includes(this.#callText.artifacts.get(job.textArtifactId)?.kind ?? "")) return "review";
    return ["answer_detection_timeout","provider_call_reconciliation","live_transcript_finalization"].includes(job.type) ? "operations" : "background";
  }
  #assertDurableJobLease(lease?: DurableJobLease) {
    if (!lease) return;
    lease.signal?.throwIfAborted();
    const job = this.#findDurableJob(lease.jobId);
    if (!job || !durableJobLeaseIsValid(
      job,
      lease.workerId,
      lease.checkedAt
    ) || (lease.generation !== undefined && job.generation !== lease.generation) || (lease.attemptNumber !== undefined && job.attemptCount !== lease.attemptNumber)) {
      throw new CallRepositoryError("DURABLE_JOB_LEASE_LOST");
    }
  }
}

function durableJobKey(type: DurableJob["type"], targetId: string) {
  return `${type}:${targetId}`;
}

function durableJobLeaseIsValid(
  job: DurableJob,
  workerId: string,
  now: string
) {
  return job.status === "running" &&
    job.leaseOwner === workerId &&
    job.leaseExpiresAt !== null &&
    job.leaseExpiresAt > now;
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

function requireSystemControlReason(value: string) {
  const reason = requireReason(value);
  if (reason.length > 500) {
    throw new Error("A safety-control reason must not exceed 500 characters");
  }
  return reason;
}

function requireAdminJobReason(value: string) {
  const reason = requireSystemControlReason(value);
  if (reason.length < 3) {
    throw new Error("A durable-job retry reason must have at least 3 characters");
  }
  return reason;
}

function safeTelemetryCode(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && /^[a-z0-9_.:/-]{1,160}$/i.test(normalized)
    ? normalized
    : fallback;
}

function sameTechnicalOutcome(
  left: CallOutcomeView["technical"],
  right: CallOutcomeView["technical"]
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function systemOutcomeIdempotencyKey(
  technical: CallOutcomeView["technical"]
) {
  return `system:${createHash("sha256")
    .update(JSON.stringify(technical))
    .digest("hex")}`;
}

function sameFeedback(
  revision: CallFeedbackRevision,
  input: OwnerCallFeedbackInput
) {
  return revision.goalResult === input.goalResult &&
    revision.transcriptQuality === input.transcriptQuality &&
    revision.comment === (input.comment?.trim() || null);
}

function emptyOutcomeMetrics(): CallOutcomeMetrics {
  return {
    terminalCalls: 0,
    feedbackResponses: 0,
    goalResults: { yes: 0, partly: 0, no: 0 },
    transcriptQuality: { good: 0, someErrors: 0, poor: 0 },
    semanticOutcomes: {
      resolved: 0,
      partiallyResolved: 0,
      unresolved: 0,
      wrongRecipient: 0,
      voicemail: 0,
      declined: 0,
      technicalFailure: 0
    },
    technicalFailures: {
      policy: 0,
      provider: 0,
      consent: 0,
      recording: 0,
      realtime: 0,
      transcription: 0,
      recovery: 0
    }
  };
}

function emptyAdminOperationsFacts(): AdminOperationsFacts {
  return {
    createdCalls: 0,
    attemptedCalls: 0,
    activeCalls: 0,
    terminalCalls: 0,
    connectedCalls: 0,
    consentGrantedCalls: 0,
    consentFailedCalls: 0,
    technicalFailureCalls: 0,
    feedbackResponses: 0,
    semanticOutcomes: {
      resolved: 0,
      partiallyResolved: 0,
      unresolved: 0,
      wrongRecipient: 0,
      voicemail: 0,
      declined: 0,
      technicalFailure: 0,
      unclassified: 0
    },
    recordedDurationSeconds: {
      samples: 0,
      total: 0,
      average: null,
      p95: null
    },
    firstAudioLatencyMs: {
      samples: 0,
      total: 0,
      average: null,
      p95: null
    },
    transcriptionRetries: 0,
    realtimeDisconnects: 0,
    recoveries: 0,
    usageSeconds: { telephony: 0, realtime: 0, transcription: 0 },
    providerUsage: {
      incurredFrom: "",
      incurredTo: "",
      operationCount: 0,
      usageRecordCount: 0,
      buckets: []
    },
    providerCosts: {
      incurredFrom: "",
      incurredTo: "",
      recordCount: 0,
      buckets: []
    }
  };
}

function emptyAdminProviderUsageBucket(identity: Pick<
  AdminProviderUsageBucket,
  "provider" | "operationType" | "stage" | "model"
>): AdminProviderUsageBucket {
  return {
    ...identity,
    usageRecords: 0,
    requestCount: 0,
    inputTextTokens: 0,
    inputTextTokenSamples: 0,
    cachedInputTextTokens: 0,
    cachedInputTextTokenSamples: 0,
    cacheWriteInputTextTokens: 0,
    cacheWriteInputTextTokenSamples: 0,
    outputTextTokens: 0,
    outputTextTokenSamples: 0,
    reasoningOutputTokens: 0,
    reasoningOutputTokenSamples: 0,
    inputAudioTokens: 0,
    inputAudioTokenSamples: 0,
    cachedInputAudioTokens: 0,
    cachedInputAudioTokenSamples: 0,
    outputAudioTokens: 0,
    outputAudioTokenSamples: 0,
    totalTokens: 0,
    totalTokenSamples: 0,
    durationSeconds: 0,
    durationSamples: 0,
    billableSeconds: 0,
    billableSamples: 0
  };
}

function addAdminProviderMetric<
  ValueKey extends keyof AdminProviderUsageBucket,
  SampleKey extends keyof AdminProviderUsageBucket
>(
  bucket: AdminProviderUsageBucket,
  valueKey: ValueKey,
  sampleKey: SampleKey,
  value: number | null | undefined
) {
  if (value === null || value === undefined) return;
  (bucket[valueKey] as number) += value;
  (bucket[sampleKey] as number) += 1;
}

function incrementAdminSemanticOutcome(
  facts: AdminOperationsFacts,
  outcome: CallOutcomeRevision["outcome"]
) {
  switch (outcome) {
    case "resolved":
      facts.semanticOutcomes.resolved += 1;
      break;
    case "partially_resolved":
      facts.semanticOutcomes.partiallyResolved += 1;
      break;
    case "unresolved":
      facts.semanticOutcomes.unresolved += 1;
      break;
    case "wrong_recipient":
      facts.semanticOutcomes.wrongRecipient += 1;
      break;
    case "voicemail":
      facts.semanticOutcomes.voicemail += 1;
      break;
    case "declined":
      facts.semanticOutcomes.declined += 1;
      break;
    case "technical_failure":
      facts.semanticOutcomes.technicalFailure += 1;
      break;
    case null:
      facts.semanticOutcomes.unclassified += 1;
      break;
  }
}

function aggregateFacts(values: number[]) {
  if (values.length === 0) {
    return { samples: 0, total: 0, average: null, p95: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const position = (sorted.length - 1) * 0.95;
  const lower = sorted[Math.floor(position)]!;
  const upper = sorted[Math.ceil(position)]!;
  const p95 = lower + (upper - lower) * (position - Math.floor(position));
  return {
    samples: sorted.length,
    total,
    average: total / sorted.length,
    p95
  };
}

function incrementSemanticOutcome(
  metrics: CallOutcomeMetrics,
  outcome: CallOutcomeRevision["outcome"]
) {
  switch (outcome) {
    case "resolved":
      metrics.semanticOutcomes.resolved += 1;
      break;
    case "partially_resolved":
      metrics.semanticOutcomes.partiallyResolved += 1;
      break;
    case "unresolved":
      metrics.semanticOutcomes.unresolved += 1;
      break;
    case "wrong_recipient":
      metrics.semanticOutcomes.wrongRecipient += 1;
      break;
    case "voicemail":
      metrics.semanticOutcomes.voicemail += 1;
      break;
    case "declined":
      metrics.semanticOutcomes.declined += 1;
      break;
    case "technical_failure":
      metrics.semanticOutcomes.technicalFailure += 1;
      break;
  }
}

function samePromoDefinition(
  stored: StoredPromoCode,
  input: CreatePromoCodeRepositoryInput
) {
  return stored.codeHash === input.codeHash &&
    stored.credits === input.credits &&
    stored.globalRedemptionLimit === input.globalRedemptionLimit &&
    stored.perUserLimit === input.perUserLimit &&
    stored.startsAt === input.startsAt &&
    stored.expiresAt === input.expiresAt &&
    stored.active === input.active &&
    stored.campaign === input.campaign &&
    stored.actorUserId === input.actorUserId &&
    stored.reason === input.reason;
}

function promoSummary(stored: StoredPromoCode): PromoCodeSummary {
  return {
    id: stored.id,
    credits: stored.credits,
    globalRedemptionLimit: stored.globalRedemptionLimit,
    perUserLimit: stored.perUserLimit,
    startsAt: stored.startsAt,
    expiresAt: stored.expiresAt,
    active: stored.active,
    campaign: stored.campaign,
    createdAt: stored.createdAt
  };
}

function storedBriefIdentity(parsed: NormalizedCallBriefInput) {
  return {
    recipientName: parsed.recipientName,
    phoneNumber: parsed.phoneNumber,
    assistantProfileId: parsed.assistantProfileId,
    agentName: parsed.agentName,
    representedPerson: parsed.representedPerson,
    representedPersonFirstName: parsed.representedPersonFirstName,
    representedPersonLastName: parsed.representedPersonLastName,
    assistanceReason: parsed.assistanceReason,
    assistanceDisclosure: parsed.assistanceDisclosure,
    locale: parsed.locale,
    voiceGender: parsed.voiceGender,
    audioRetentionDays: parsed.audioRetentionDays,
    allowLanguageSwitch: parsed.allowLanguageSwitch,
    ...(parsed.fallbackLocale ? { fallbackLocale: parsed.fallbackLocale } : {})
  };
}

function emptyAdminWebhookFacts(): Record<
  ProviderWebhookKind,
  AdminWebhookDeliveryFacts
> {
  return {
    voice: emptyAdminWebhookDeliveryFacts(),
    call_status: emptyAdminWebhookDeliveryFacts(),
    recording_status: emptyAdminWebhookDeliveryFacts()
  };
}

function emptyAdminWebhookDeliveryFacts(): AdminWebhookDeliveryFacts {
  return {
    accepted: 0,
    rejected: 0,
    unmatched: 0,
    failed: 0,
    lastAcceptedAt: null,
    lastProblemAt: null,
    lastProblemCode: null
  };
}

function startOfUtcHour(value: Date) {
  const result = new Date(value);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

function safeProviderWebhookErrorCode(value?: string | null) {
  return value && /^[a-z0-9_.:/-]{1,160}$/i.test(value)
    ? value
    : "WEBHOOK_DELIVERY_FAILED";
}

function postCallTranscriptionChunkKey(
  input: Pick<
    PostCallTranscriptionChunkLookupInput,
    "recordingId" | "stage" | "requestedModel" | "chunkKey" | "inputFingerprint"
  >
) {
  return [
    input.recordingId,
    input.stage,
    input.requestedModel,
    input.chunkKey,
    input.inputFingerprint
  ].join(":");
}
