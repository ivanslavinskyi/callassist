import { createHash, randomUUID } from "node:crypto";
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
  deriveTechnicalCallOutcome,
  describeCallTelemetryEvent,
  durableCallEventSchema,
  normalizeCreateCallBriefInput,
  ownerCallFeedbackInputSchema,
  parseSwissDestinationPhone,
  semanticOutcomeForGoalResult,
  sensitiveCallAccessInputSchema,
  type AdminCallSummary,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallBrief,
  type CallCompilation,
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
  buildRuntimeBriefFields,
  connectedProviderStatuses,
  creditSettlementForStatus,
  defaultCallAdmissionPolicy,
  encodeCallBriefCursor,
  encodeAdminCallCursor,
  shouldApplyProviderCallStatus,
  type AdminCreditGrantRepositoryInput,
  type AdminOperationsFacts,
  type AdminSystemFacts,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallRepository,
  type CreatePromoCodeRepositoryInput,
  type ListCallBriefsInput,
  type ListAdminCallsInput,
  type RecordingStatusInput,
  type RecipientSuppressionInput,
  type RedeemPromoRepositoryInput,
  type SafetyControlInput,
  type StartAttemptInput
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
    this.#appendCompilationTelemetry(brief.id, compilation, now);

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
  }

  safetyEventsForTest() {
    return copy(this.#safetyEvents);
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
    this.#appendCompilationTelemetry(id, compilation, now);
    return copy(snapshot);
  }

  async get(id: string) {
    const snapshot = this.#calls.get(id);
    return snapshot ? copy(snapshot) : null;
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
    to: string
  ): Promise<AdminOperationsFacts> {
    const scoped = [...this.#calls.values()].filter(({ brief }) =>
      brief.createdAt >= from && brief.createdAt <= to
    );
    const facts = emptyAdminOperationsFacts();
    const durationValues: number[] = [];
    const firstAudioValues: number[] = [];
    for (const snapshot of scoped) {
      const id = snapshot.brief.id;
      const events = (this.#callTelemetryEvents.get(id) ?? [])
        .map(({ event }) => event);
      const attempts = this.#attempts.get(id) ?? [];
      const outcome = this.#buildOutcomeView(id);
      facts.createdCalls += 1;
      if (attempts.length > 0) facts.attemptedCalls += 1;
      if (interruptedStatuses.has(snapshot.brief.status)) {
        facts.activeCalls += 1;
      }
      if (terminalStatuses.has(snapshot.brief.status)) {
        facts.terminalCalls += 1;
      }
      if (outcome.technical.connection === "confirmed") {
        facts.connectedCalls += 1;
      }
      if (outcome.technical.consent === "granted") {
        facts.consentGrantedCalls += 1;
      } else if (outcome.technical.consent === "failed") {
        facts.consentFailedCalls += 1;
      }
      if (outcome.technical.failureStage !== null) {
        facts.technicalFailureCalls += 1;
      }
      if (outcome.latestFeedback) facts.feedbackResponses += 1;
      incrementAdminSemanticOutcome(
        facts,
        outcome.latestOutcome?.outcome ?? null
      );

      const duration = snapshot.recording?.durationSeconds;
      if (duration !== null && duration !== undefined) {
        durationValues.push(duration);
        if (events.some(({ payload }) => payload.name === "realtime.ready")) {
          facts.usageSeconds.realtime += duration;
        }
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
      for (const attempt of attempts) {
        if (!attempt.endedAt) continue;
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
    }
    facts.recordedDurationSeconds = aggregateFacts(durationValues);
    facts.firstAudioLatencyMs = aggregateFacts(firstAudioValues);
    return facts;
  }

  async getAdminSystemFacts(
    now: string,
    recentSince: string
  ): Promise<AdminSystemFacts> {
    const snapshots = [...this.#calls.values()];
    const events = [...this.#callTelemetryEvents.values()]
      .flatMap((stored) => stored.map(({ event }) => event))
      .filter(({ occurredAt }) => occurredAt >= recentSince);
    const jobs = [...this.#durableJobs.values()];
    const queued = jobs.filter(({ status }) => status === "queued");
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
      jobs: {
        queued: queued.length,
        running: jobs.filter(({ status }) => status === "running").length,
        succeeded: jobs.filter(({ status }) => status === "succeeded").length,
        deadLetter: jobs.filter(({ status }) => status === "dead_letter").length,
        retryQueued: queued.filter(({ attemptCount }) => attemptCount > 0).length,
        transcriptionQueued: queued.filter(
          ({ type }) => type === "final_transcription"
        ).length,
        retentionQueued: queued.filter(
          ({ type }) => type === "recording_retention"
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
          .map(({ recordingId: _recordingId, forceRequested: _force,
            leaseOwner: _owner, leasedAt: _leasedAt, createdAt: _createdAt,
            completedAt: _completedAt, ...job }) => copy(job))
      }
    };
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
      const providerWasAttached = !attempt.providerCallId;
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
      const previousCallStatus = snapshot.brief.status;
      const applyCallStatus = shouldApplyProviderCallStatus(
        previousCallStatus,
        callStatus
      );
      const safeProviderStatus = safeTelemetryCode(
        providerStatus,
        "unknown_provider_status"
      );
      attempt.providerCallId ??= providerCallId;
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
      if (applyCallStatus) {
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
      const settlement = this.#settleAttempt(id, attempt, "call_refund");
      if (settlement) {
        this.#appendSettlementTelemetry(
          id,
          attempt.id,
          settlement,
          snapshot.brief.updatedAt
        );
      }
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
    this.#appendTelemetry(id, {
      callAttemptId: attempt.id,
      idempotencyKey: `attempt:${attempt.id}:consent:granted`,
      occurredAt: consentGrantedAt,
      payload: {
        name: "consent.granted",
        metadata: { method: "dtmf_1" }
      }
    });
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
    const attempt = (this.#attempts.get(callId) ?? []).at(-1);
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
        metadata: { providerStatus }
      }
    });
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
    if (input.providerStatus === "in-progress") {
      this.#appendTelemetry(input.callBriefId, {
        callAttemptId: attempt.id,
        idempotencyKey: `recording:${input.recordingId}:started`,
        occurredAt: recording.startedAt ?? undefined,
        payload: {
          name: "recording.started",
          metadata: { providerStatus: "in-progress" }
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
      await this.enqueueDurableJob({
        type: "final_transcription",
        recordingId: input.recordingId,
        runAfter: recording.completedAt ?? new Date().toISOString(),
        maxAttempts: durableJobMaxAttempts.final_transcription
      });
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
    return {
      callId: input.callBriefId,
      recording: copy(recording),
      snapshot: copy(snapshot)
    };
  }

  async claimFinalTranscript(
    recordingId: string,
    model: string,
    force = false,
    lease?: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
    const { callId, snapshot, recording } = this.#requireRecording(recordingId);
    if (recording.status !== "available") return null;
    if (snapshot.finalTranscript?.status === "completed" && !force) return null;
    if (snapshot.finalTranscript?.status === "processing" && !lease) return null;
    const now = new Date().toISOString();
    const retry = Boolean(snapshot.finalTranscript);
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
    lease?: DurableJobLease
  ) {
    this.#assertDurableJobLease(lease);
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
    await this.enqueueDurableJob({
      type: "recording_retention",
      recordingId,
      runAfter: recording.deleteAfter,
      maxAttempts: durableJobMaxAttempts.recording_retention
    });
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
    const finalTranscript = snapshot.finalTranscript;
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

  async markRecordingDeleted(id: string, lease?: DurableJobLease) {
    this.#assertDurableJobLease(lease);
    const snapshot = this.#require(id);
    const recording = snapshot.recording;
    if (!recording) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    recording.status = "deleted";
    recording.deletedAt = new Date().toISOString();
    return { callId: id, recording: copy(recording), snapshot: copy(snapshot) };
  }

  async enqueueDurableJob(input: EnqueueDurableJobInput) {
    const { callId } = this.#requireRecording(input.recordingId);
    const key = durableJobKey(input.type, input.recordingId);
    const existing = this.#durableJobs.get(key);
    const now = new Date().toISOString();
    if (!existing) {
      const job: DurableJob = {
        id: randomUUID(),
        type: input.type,
        recordingId: input.recordingId,
        callId,
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
      ["succeeded", "dead_letter"].includes(existing.status)
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
      const recording = snapshot.recording;
      if (recording?.status !== "available") continue;
      if (
        snapshot.finalTranscript?.status !== "completed"
      ) {
        await this.enqueueDurableJob({
          type: "final_transcription",
          recordingId: recording.id,
          runAfter: now,
          maxAttempts: durableJobMaxAttempts.final_transcription
        });
      }
      if (
        recording.deleteAfter &&
        snapshot.finalTranscript?.status === "completed"
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

  async claimDueDurableJob(input: ClaimDurableJobInput) {
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
      }
    }
    const job = [...this.#durableJobs.values()]
      .filter((candidate) =>
        candidate.status === "queued" &&
        candidate.runAfter <= input.now &&
        input.types.includes(candidate.type)
      )
      .sort((left, right) =>
        left.runAfter.localeCompare(right.runAfter) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      )[0];
    if (!job) return null;
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
    leaseExpiresAt: string
  ) {
    const job = this.#findDurableJob(jobId);
    if (!job || !durableJobLeaseIsValid(job, workerId, now)) return false;
    job.leaseExpiresAt = leaseExpiresAt;
    job.updatedAt = now;
    return true;
  }

  async completeDurableJob(jobId: string, workerId: string, now: string) {
    const job = this.#findDurableJob(jobId);
    if (!job || !durableJobLeaseIsValid(job, workerId, now)) return false;
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
    retryAt: string
  ) {
    const job = this.#findDurableJob(jobId);
    if (!job || !durableJobLeaseIsValid(job, workerId, now)) return null;
    const deadLetter = job.attemptCount >= job.maxAttempts;
    this.#durableJobAttempts.push({
      id: randomUUID(),
      jobId,
      generation: job.generation,
      attemptNumber: job.attemptCount,
      workerId,
      startedAt: job.leasedAt!,
      completedAt: now,
      outcome: deadLetter ? "dead_letter" : "retry_scheduled",
      errorCode
    });
    job.status = deadLetter ? "dead_letter" : "queued";
    job.runAfter = deadLetter ? job.runAfter : retryAt;
    job.leaseOwner = null;
    job.leasedAt = null;
    job.leaseExpiresAt = null;
    job.lastErrorCode = errorCode;
    job.updatedAt = now;
    job.completedAt = deadLetter ? now : null;
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
    if (job.status !== "dead_letter") {
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
      snapshot.brief.status = "failed";
      snapshot.brief.updatedAt = new Date().toISOString();
      const attempts = this.#attempts.get(snapshot.brief.id) ?? [];
      const attempt = attempts[attempts.length - 1];
      if (attempt) {
        attempt.status = "failed";
        attempt.endedAt = snapshot.brief.updatedAt;
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
            snapshot.brief.updatedAt
          );
        }
      }
      this.#appendTelemetry(snapshot.brief.id, {
        callAttemptId: attempt?.id ?? null,
        idempotencyKey: "call:recovered:server-restarted",
        occurredAt: snapshot.brief.updatedAt,
        payload: {
          name: "call.recovered",
          metadata: { reason: "server_restarted" }
        }
      });
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
      latestFeedback
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
      semanticOutcome: outcomeView.latestOutcome?.outcome ?? null,
      outcomeProvenance: outcomeView.latestOutcome?.provenance ?? null,
      feedback: feedback ? {
        revision: feedback.revision,
        goalResult: feedback.goalResult,
        transcriptQuality: feedback.transcriptQuality,
        createdAt: feedback.createdAt
      } : null,
      durationSeconds: snapshot.recording?.durationSeconds ?? null,
      eventCount: (this.#callTelemetryEvents.get(callBriefId) ?? []).length
    });
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
          connected: settlement === "call_charge"
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

  #settleAttempt(
    callBriefId: string,
    attempt: CallAttemptRecord,
    type: "call_charge" | "call_refund" | null
  ): "call_charge" | "call_refund" | null {
    if (!type) return null;
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
    return type;
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

  #assertDurableJobLease(lease?: DurableJobLease) {
    if (!lease) return;
    const job = this.#findDurableJob(lease.jobId);
    if (!job || !durableJobLeaseIsValid(
      job,
      lease.workerId,
      lease.checkedAt
    )) {
      throw new CallRepositoryError("DURABLE_JOB_LEASE_LOST");
    }
  }
}

function durableJobKey(type: DurableJob["type"], recordingId: string) {
  return `${type}:${recordingId}`;
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
    usageSeconds: { telephony: 0, realtime: 0, transcription: 0 }
  };
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
    assistanceReason: parsed.assistanceReason,
    assistanceDisclosure: parsed.assistanceDisclosure,
    locale: parsed.locale,
    voiceGender: parsed.voiceGender,
    audioRetentionDays: parsed.audioRetentionDays,
    allowLanguageSwitch: parsed.allowLanguageSwitch,
    ...(parsed.fallbackLocale ? { fallbackLocale: parsed.fallbackLocale } : {})
  };
}
