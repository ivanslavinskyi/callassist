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
  getAssistanceDisclosure,
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
  type CallGoalResult,
  type CallOutcomeMetrics,
  type CallOutcomeProvenance,
  type CallOutcomeRevision,
  type CallOutcomeView,
  type CallTelemetryEventInput,
  type CallTelemetryEventName,
  type CallTelemetrySeverity,
  type CallTelemetrySource,
  type CallTelemetryStage,
  type CreditTransaction,
  type CreditUsage,
  type DurableCallEvent,
  type CallRecording,
  type CallLocale,
  type CallSnapshot,
  type CreateCallBriefInput,
  type AssistantProfileId,
  type AssistanceReason,
  type FinalTranscript,
  type FinalTranscriptSegment,
  type OwnerCallFeedbackInput,
  type SemanticCallOutcome,
  type TechnicalCallOutcome,
  type PromoCodeSummary,
  type TranscriptSegment
} from "@callassist/contracts";
import postgres from "postgres";
import {
  dataEncryptionActiveKeyId,
  decryptJson,
  encryptJson,
  type DataEncryptionMaterial
} from "../security/encryption";
import { createCallFeedbackFingerprint } from "../security/feedback-fingerprint";
import {
  durableJobMaxAttempts,
  type ClaimDurableJobInput,
  type DurableJob,
  type DurableJobAttempt,
  type DurableJobLease,
  type EnqueueDurableJobInput
} from "../jobs/durable-job";
import {
  CallRepositoryError,
  buildRuntimeBriefFields,
  connectedProviderStatuses,
  creditSettlementForStatus,
  defaultCallAdmissionPolicy,
  durableWorkerHeartbeatRetentionMs,
  durableWorkerHeartbeatStaleAfterMs,
  encodeAdminCallCursor,
  encodeCallBriefCursor,
  isUuid,
  shouldApplyProviderCallStatus,
  type AdminCreditGrantRepositoryInput,
  type AdminOperationsFacts,
  type AdminSystemFacts,
  type AdminWebhookDeliveryFacts,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallChangeSignal,
  type CallRepository,
  type CreatePromoCodeRepositoryInput,
  type PromoCodeCreationResult,
  type ListCallBriefsInput,
  type ListAdminCallsInput,
  type RecordingStatusInput,
  type RecipientSuppressionInput,
  type RedeemPromoRepositoryInput,
  type SafetyControlInput,
  type StartAttemptInput,
  type ProviderWebhookDeliveryInput,
  type ProviderWebhookKind,
  type ProviderWebhookOutcome,
  type DurableWorkerHeartbeatInput
} from "./call-repository";

type DatabaseDate = Date | string;

type CallBriefRow = {
  id: string;
  recipientName: string;
  phoneNumber: string;
  objective: string;
  assistantProfileId: AssistantProfileId | null;
  agentName: string;
  representedPerson: string;
  representedPersonFirstName: string;
  representedPersonLastName: string;
  assistanceReasonCiphertext: string | null;
  assistanceDisclosure: string | null;
  assistanceDisclosureCiphertext: string | null;
  compilationCiphertext: string | null;
  contextCiphertext: string | null;
  locale: CallBrief["locale"];
  voiceGender: CallBrief["voiceGender"];
  audioRetentionDays: CallBrief["audioRetentionDays"];
  allowLanguageSwitch: boolean;
  fallbackLocale: CallBrief["fallbackLocale"];
  allowedFactsCiphertext: string;
  status: CallBrief["status"];
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
};

type TranscriptRow = {
  id: string;
  role: TranscriptSegment["role"];
  text: string;
  locale: CallLocale;
  final: boolean;
  createdAt: DatabaseDate;
};

type ApprovalRow = {
  id: string;
  category: ApprovalRequest["category"];
  title: string;
  reason: string;
  proposedSpeech: string;
  status: ApprovalRequest["status"];
  createdAt: DatabaseDate;
};

type CallAttemptRow = {
  id: string;
  callBriefId: string;
  provider: CallAttemptRecord["provider"];
  providerCallId: string | null;
  status: CallBrief["status"];
  providerStatus: string | null;
  startedAt: DatabaseDate;
  endedAt: DatabaseDate | null;
  failureReason: string | null;
};

type CallRecordingRow = {
  id: string;
  status: CallRecording["status"];
  providerRecordingId: string | null;
  consentGrantedAt: DatabaseDate;
  startedAt: DatabaseDate | null;
  completedAt: DatabaseDate | null;
  durationSeconds: number | null;
  channels: number | null;
  deleteAfter: DatabaseDate | null;
  deletedAt: DatabaseDate | null;
  failureReason: string | null;
};

type FinalTranscriptRow = {
  id: string;
  status: FinalTranscript["status"];
  textCiphertext: string | null;
  segmentsCiphertext: string | null;
  model: string;
  failureReason: string | null;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  completedAt: DatabaseDate | null;
};

type CallTelemetryEventRow = {
  id: string;
  callBriefId: string;
  callAttemptId: string | null;
  userId: string | null;
  sequence: number;
  schemaVersion: number;
  eventName: CallTelemetryEventName;
  source: CallTelemetrySource;
  stage: CallTelemetryStage;
  severity: CallTelemetrySeverity;
  metadata: unknown | string;
  occurredAt: DatabaseDate;
};

type CallOutcomeRevisionRow = {
  id: string;
  callBriefId: string;
  revision: number;
  schemaVersion: number;
  outcome: SemanticCallOutcome | null;
  provenance: CallOutcomeProvenance;
  actorUserId: string | null;
  reason: CallOutcomeRevision["reason"];
  technical: unknown | string;
  createdAt: DatabaseDate;
};

type CallFeedbackRevisionRow = {
  id: string;
  callBriefId: string;
  userId: string;
  revision: number;
  schemaVersion: number;
  goalResult: CallGoalResult;
  transcriptQuality: CallFeedbackRevision["transcriptQuality"];
  commentCiphertext: string | null;
  payloadFingerprint: string;
  payloadFingerprintKeyId: string;
  idempotencyKey: string;
  createdAt: DatabaseDate;
};

type AdminCallReadRow = {
  id: string;
  ownerUserId: string | null;
  status: CallBrief["status"];
  locale: CallLocale;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  semanticOutcome: SemanticCallOutcome | null;
  outcomeProvenance: CallOutcomeProvenance | null;
  feedbackRevision: number | null;
  goalResult: CallGoalResult | null;
  transcriptQuality: CallFeedbackRevision["transcriptQuality"];
  feedbackCreatedAt: DatabaseDate | null;
  durationSeconds: number | null;
  eventCount: number;
};

type AdminOperationsFactsRow = {
  createdCalls: number;
  attemptedCalls: number;
  activeCalls: number;
  terminalCalls: number;
  connectedCalls: number;
  consentGrantedCalls: number;
  consentFailedCalls: number;
  technicalFailureCalls: number;
  feedbackResponses: number;
  resolved: number;
  partiallyResolved: number;
  unresolved: number;
  wrongRecipient: number;
  voicemail: number;
  declined: number;
  technicalFailure: number;
  unclassified: number;
  durationSamples: number;
  durationTotal: number;
  durationAverage: number | null;
  durationP95: number | null;
  firstAudioSamples: number;
  firstAudioTotal: number;
  firstAudioAverage: number | null;
  firstAudioP95: number | null;
  transcriptionRetries: number;
  realtimeDisconnects: number;
  recoveries: number;
  telephonyUsageSeconds: number;
  realtimeUsageSeconds: number;
  transcriptionUsageSeconds: number;
};

type AdminSystemFactsRow = {
  outboundCallsEnabled: boolean;
  outboundCallsReason: string;
  outboundCallsUpdatedAt: DatabaseDate | null;
  activeCalls: number;
  recordingsProcessing: number;
  transcriptionReady: number;
  transcriptionProcessing: number;
  transcriptionFailed: number;
  retentionScheduled: number;
  retentionOverdue: number;
  recentWarnings: number;
  recentErrors: number;
  jobsQueued: number;
  jobsRunning: number;
  jobsSucceeded: number;
  jobsDeadLetter: number;
  jobsRetryQueued: number;
  transcriptionQueued: number;
  retentionQueued: number;
  providerReconciliationQueued: number;
  oldestJobDueAt: DatabaseDate | null;
  workerHealthyInstances: number;
  workerStaleInstances: number;
  workerActiveJobs: number;
  workerLastSeenAt: DatabaseDate | null;
};

type DurableJobRow = {
  id: string;
  type: DurableJob["type"];
  recordingId: string | null;
  callAttemptId: string | null;
  callId: string;
  status: DurableJob["status"];
  generation: number;
  attemptCount: number;
  maxAttempts: number;
  runAfter: DatabaseDate;
  forceRequested: boolean;
  leaseOwner: string | null;
  leasedAt: DatabaseDate | null;
  leaseExpiresAt: DatabaseDate | null;
  lastErrorCode: string | null;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  completedAt: DatabaseDate | null;
};

type DurableJobAttemptRow = Omit<
  DurableJobAttempt,
  "startedAt" | "completedAt"
> & {
  startedAt: DatabaseDate;
  completedAt: DatabaseDate;
};

type ProviderWebhookBucketRow = {
  kind: ProviderWebhookKind;
  outcome: ProviderWebhookOutcome;
  deliveryCount: number;
  lastReceivedAt: DatabaseDate;
  lastErrorCode: string | null;
};

type CreditTransactionRow = Omit<CreditTransaction, "createdAt"> & {
  createdAt: DatabaseDate;
};

type PromoCodeRow = Omit<PromoCodeSummary, "createdAt"> & {
  codeHash: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  createdAt: DatabaseDate;
};

type PromoRedemptionIdempotencyRow = {
  userId: string;
  codeHash: string;
};

type AdminGrantRow = {
  userId: string;
  amount: number;
  adminId: string | null;
  reason: string | null;
};

type CreditAdminUserRow = {
  id: string;
  role: "user" | "admin" | "superadmin" | "content_editor" | "support";
  status: "active" | "suspended" | "deleted";
  phoneVerifiedAt: DatabaseDate | null;
};

const terminalStatuses = new Set<CallBrief["status"]>([
  "blocked",
  "completed",
  "stopped",
  "failed"
]);

const callChangeChannel = "callassist_call_changes_v1";

function toIso(value: DatabaseDate) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresCallRepository implements CallRepository {
  readonly mode = "postgres" as const;
  readonly #sql: postgres.Sql;
  readonly #encryptionKey: DataEncryptionMaterial;

  constructor(databaseUrl: string, encryptionKey: DataEncryptionMaterial) {
    this.#encryptionKey = encryptionKey;
    this.#sql = postgres(databaseUrl, {
      max: 10,
      onnotice: () => undefined
    });
  }

  async list(input: ListCallBriefsInput) {
    const searchPattern = input.search ? `%${input.search}%` : null;
    const cursorDate = input.cursor ? new Date(input.cursor.createdAt) : null;
    const cursorId = input.cursor?.id ?? null;
    const rows = await this.#sql<CallBriefRow[]>`
      ${this.#briefSelect()}
      WHERE user_id IS NOT DISTINCT FROM ${input.userId ?? null}::uuid
        AND (${searchPattern}::text IS NULL OR recipient_name ILIKE ${searchPattern})
        AND (${input.status ?? null}::text IS NULL OR status = ${input.status ?? null})
        AND (
          ${cursorDate}::timestamptz IS NULL
          OR (created_at, id) < (${cursorDate}, ${cursorId}::uuid)
        )
      ORDER BY created_at DESC, id DESC
      LIMIT ${input.limit + 1}
    `;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map((row) => this.#mapBrief(row));
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
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
    const id = randomUUID();
    const now = new Date();
    const encryptedFacts = encryptJson(runtime.allowedFacts, this.#encryptionKey);
    const encryptedContext = encryptJson(runtime.context, this.#encryptionKey);
    const encryptedCompilation = encryptJson(compilation, this.#encryptionKey);
    const encryptedReason = encryptJson(
      parsed.assistanceReason,
      this.#encryptionKey
    );
    const encryptedDisclosure = encryptJson(
      parsed.assistanceDisclosure,
      this.#encryptionKey
    );

    await this.#sql.begin(async (transaction) => {
      if (userId) await this.#lockActiveUser(transaction, userId);
      await transaction`
        INSERT INTO call_briefs (
          id,
          user_id,
          recipient_name,
          phone_number,
          objective,
          assistant_profile_id,
          agent_name,
          represented_person,
          represented_person_first_name,
          represented_person_last_name,
          assistance_reason_ciphertext,
          assistance_disclosure,
          assistance_disclosure_ciphertext,
          compilation_ciphertext,
          context_ciphertext,
          locale,
          voice_gender,
          audio_retention_days,
          allow_language_switch,
          fallback_locale,
          allowed_facts_ciphertext,
          status,
          created_at,
          updated_at
        ) VALUES (
          ${id},
          ${userId},
          ${parsed.recipientName},
          ${parsed.phoneNumber},
          ${runtime.objective},
          ${parsed.assistantProfileId},
          ${parsed.agentName},
          ${parsed.representedPerson},
          ${parsed.representedPersonFirstName},
          ${parsed.representedPersonLastName},
          ${encryptedReason},
          ${null},
          ${encryptedDisclosure},
          ${encryptedCompilation},
          ${encryptedContext},
          ${parsed.locale},
          ${parsed.voiceGender},
          ${parsed.audioRetentionDays},
          ${parsed.allowLanguageSwitch},
          ${parsed.fallbackLocale ?? null},
          ${encryptedFacts},
          ${runtime.status},
          ${now},
          ${now}
        )
      `;
      await this.#audit(transaction, id, "call.created", {
        locale: parsed.locale,
        status: runtime.status,
        policyDecision: compilation.policyDecision.status,
        snapshotHash: compilation.snapshotHash
      });
      await this.#appendTelemetry(transaction, id, {
        idempotencyKey: `brief:${compilation.revision}:created`,
        occurredAt: now.toISOString(),
        payload: {
          name: "brief.created",
          metadata: {
            locale: parsed.locale,
            compilationRevision: compilation.revision,
            status: runtime.status
          }
        }
      });
      await this.#appendCompilationTelemetry(
        transaction,
        id,
        compilation,
        now.toISOString()
      );
    });

    const snapshot = await this.#require(id);
    return snapshot.brief;
  }

  async isOwnedBy(id: string, userId: string | null) {
    const [row] = await this.#sql`
      SELECT 1
      FROM call_briefs
      WHERE id = ${id}
        AND user_id IS NOT DISTINCT FROM ${userId}::uuid
    `;
    return Boolean(row);
  }

  async grantSignupCredits(userId: string) {
    await this.#sql.begin(async (transaction) => {
      await this.#lockCreditAccount(transaction, userId);
      const user = await transaction`
        SELECT id FROM users WHERE id = ${userId} AND phone_verified_at IS NOT NULL
      `;
      if (user.count === 0) throw new CallRepositoryError("CALL_NOT_FOUND");
      await transaction`
        INSERT INTO credit_transactions (
          id, user_id, amount, type, reason, idempotency_key, created_at
        ) VALUES (
          ${randomUUID()}, ${userId}, 3, 'signup_grant',
          'Phone verification signup grant', ${`signup:${userId}`}, ${new Date()}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
    });
    return this.getCreditUsage(userId);
  }

  async getCreditUsage(userId: string): Promise<CreditUsage> {
    const [activeRows, transactionRows] = await Promise.all([
      this.#sql<{ callBriefId: string }[]>`
        SELECT call_brief_id AS "callBriefId"
        FROM call_attempts
        WHERE user_id = ${userId} AND ended_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      this.#sql<CreditTransactionRow[]>`
        SELECT
          id,
          amount,
          type,
          call_attempt_id AS "callAttemptId",
          promo_redemption_id AS "promoRedemptionId",
          admin_id AS "adminId",
          reason,
          created_at AS "createdAt"
        FROM credit_transactions
        WHERE user_id = ${userId}
        ORDER BY created_at DESC, id DESC
      `
    ]);
    return {
      balance: transactionRows.reduce((total, row) => total + row.amount, 0),
      activeCallBriefId: activeRows[0]?.callBriefId ?? null,
      transactions: transactionRows.map((row) => ({
        ...row,
        createdAt: toIso(row.createdAt)
      }))
    };
  }

  async createPromoCode(
    input: CreatePromoCodeRepositoryInput
  ): Promise<PromoCodeCreationResult> {
    let result: { created: boolean; promoCode: PromoCodeSummary } | null = null;
    await this.#sql.begin(async (transaction) => {
      await this.#lockOperation(
        transaction,
        `promo-create:${input.idempotencyKey}`
      );
      await this.#lockOperation(transaction, `promo-code:${input.codeHash}`);
      const [actor] = await transaction<CreditAdminUserRow[]>`
        SELECT
          id, role, status, phone_verified_at AS "phoneVerifiedAt"
        FROM users
        WHERE id = ${input.actorUserId}
        FOR SHARE
      `;
      if (
        !actor ||
        actor.status !== "active" ||
        (actor.role !== "admin" && actor.role !== "superadmin")
      ) {
        throw new CallRepositoryError("CREDIT_ADMIN_ACTION_FORBIDDEN");
      }
      const [previous] = await transaction<PromoCodeRow[]>`
        SELECT
          id,
          code_hash AS "codeHash",
          credits,
          global_redemption_limit AS "globalRedemptionLimit",
          per_user_limit AS "perUserLimit",
          starts_at AS "startsAt",
          expires_at AS "expiresAt",
          active,
          campaign,
          created_by_user_id AS "actorUserId",
          creation_reason AS reason,
          creation_idempotency_key AS "idempotencyKey",
          created_at AS "createdAt"
        FROM promo_codes
        WHERE creation_idempotency_key = ${input.idempotencyKey}
      `;
      if (previous) {
        if (!samePromoRow(previous, input)) {
          throw new CallRepositoryError("CREDIT_IDEMPOTENCY_CONFLICT");
        }
        result = { created: false, promoCode: mapPromoCode(previous) };
        return;
      }
      const duplicate = await transaction`
        SELECT 1 FROM promo_codes WHERE code_hash = ${input.codeHash}
      `;
      if (duplicate.count > 0) {
        throw new CallRepositoryError("PROMO_CODE_ALREADY_EXISTS");
      }
      const [created] = await transaction<PromoCodeRow[]>`
        INSERT INTO promo_codes (
          id, code_hash, credits, global_redemption_limit, per_user_limit,
          starts_at, expires_at, active, campaign, created_by_user_id,
          creation_reason, creation_idempotency_key, created_at
        ) VALUES (
          ${randomUUID()}, ${input.codeHash}, ${input.credits},
          ${input.globalRedemptionLimit}, ${input.perUserLimit},
          ${input.startsAt ? new Date(input.startsAt) : null},
          ${input.expiresAt ? new Date(input.expiresAt) : null},
          ${input.active}, ${input.campaign}, ${input.actorUserId},
          ${input.reason}, ${input.idempotencyKey}, ${new Date(input.now)}
        )
        RETURNING
          id,
          code_hash AS "codeHash",
          credits,
          global_redemption_limit AS "globalRedemptionLimit",
          per_user_limit AS "perUserLimit",
          starts_at AS "startsAt",
          expires_at AS "expiresAt",
          active,
          campaign,
          created_by_user_id AS "actorUserId",
          creation_reason AS reason,
          creation_idempotency_key AS "idempotencyKey",
          created_at AS "createdAt"
      `;
      if (!created) throw new CallRepositoryError("PROMO_CODE_UNAVAILABLE");
      result = { created: true, promoCode: mapPromoCode(created) };
    });
    if (!result) throw new CallRepositoryError("PROMO_CODE_UNAVAILABLE");
    return result as PromoCodeCreationResult;
  }

  async redeemPromo(input: RedeemPromoRepositoryInput) {
    let applied = false;
    await this.#sql.begin(async (transaction) => {
      await this.#lockOperation(
        transaction,
        `promo-redeem:${input.idempotencyKey}`
      );
      const [previous] = await transaction<PromoRedemptionIdempotencyRow[]>`
        SELECT
          promo_redemptions.user_id AS "userId",
          promo_codes.code_hash AS "codeHash"
        FROM promo_redemptions
        JOIN promo_codes ON promo_codes.id = promo_redemptions.promo_code_id
        WHERE promo_redemptions.idempotency_key = ${input.idempotencyKey}
      `;
      if (previous) {
        if (
          previous.userId !== input.userId ||
          previous.codeHash !== input.codeHash
        ) {
          throw new CallRepositoryError("CREDIT_IDEMPOTENCY_CONFLICT");
        }
        return;
      }
      const [promo] = await transaction<PromoCodeRow[]>`
        SELECT
          id,
          code_hash AS "codeHash",
          credits,
          global_redemption_limit AS "globalRedemptionLimit",
          per_user_limit AS "perUserLimit",
          starts_at AS "startsAt",
          expires_at AS "expiresAt",
          active,
          campaign,
          created_by_user_id AS "actorUserId",
          creation_reason AS reason,
          creation_idempotency_key AS "idempotencyKey",
          created_at AS "createdAt"
        FROM promo_codes
        WHERE code_hash = ${input.codeHash}
        FOR UPDATE
      `;
      const now = new Date(input.now);
      if (
        !promo ||
        !promo.active ||
        (promo.startsAt && new Date(promo.startsAt) > now) ||
        (promo.expiresAt && new Date(promo.expiresAt) <= now)
      ) {
        throw new CallRepositoryError("PROMO_CODE_UNAVAILABLE");
      }
      const [user] = await transaction<CreditAdminUserRow[]>`
        SELECT
          id, role, status, phone_verified_at AS "phoneVerifiedAt"
        FROM users
        WHERE id = ${input.userId}
        FOR SHARE
      `;
      if (
        !user ||
        user.status !== "active" ||
        !user.phoneVerifiedAt
      ) {
        throw new CallRepositoryError("CREDIT_USER_NOT_FOUND");
      }
      const [counts] = await transaction<{
        globalCount: number;
        userCount: number;
      }[]>`
        SELECT
          count(*)::int AS "globalCount",
          count(*) FILTER (WHERE user_id = ${input.userId})::int AS "userCount"
        FROM promo_redemptions
        WHERE promo_code_id = ${promo.id}
      `;
      const globalCount = counts?.globalCount ?? 0;
      const userCount = counts?.userCount ?? 0;
      if (
        promo.globalRedemptionLimit !== null &&
        globalCount >= promo.globalRedemptionLimit
      ) {
        throw new CallRepositoryError("PROMO_GLOBAL_LIMIT_REACHED");
      }
      if (userCount >= promo.perUserLimit) {
        throw new CallRepositoryError("PROMO_USER_LIMIT_REACHED");
      }
      await this.#lockCreditAccount(transaction, input.userId);
      const redemptionId = randomUUID();
      await transaction`
        INSERT INTO promo_redemptions (
          id, promo_code_id, user_id, redemption_number,
          credits, idempotency_key, redeemed_at
        ) VALUES (
          ${redemptionId}, ${promo.id}, ${input.userId}, ${userCount + 1},
          ${promo.credits}, ${input.idempotencyKey}, ${now}
        )
      `;
      await transaction`
        INSERT INTO credit_transactions (
          id, user_id, amount, type, promo_redemption_id,
          reason, idempotency_key, created_at
        ) VALUES (
          ${randomUUID()}, ${input.userId}, ${promo.credits}, 'promo_grant',
          ${redemptionId}, ${`Promo campaign: ${promo.campaign}`},
          ${`promo:${redemptionId}`}, ${now}
        )
      `;
      applied = true;
    });
    return { applied, usage: await this.getCreditUsage(input.userId) };
  }

  async grantAdminCredits(input: AdminCreditGrantRepositoryInput) {
    const transactionIdempotencyKey = `admin-grant:${input.idempotencyKey}`;
    let applied = false;
    await this.#sql.begin(async (transaction) => {
      await this.#lockOperation(
        transaction,
        `admin-grant:${input.idempotencyKey}`
      );
      const users = await transaction<CreditAdminUserRow[]>`
        SELECT
          id, role, status, phone_verified_at AS "phoneVerifiedAt"
        FROM users
        WHERE id = ${input.actorUserId} OR id = ${input.targetUserId}
        ORDER BY id
        FOR UPDATE
      `;
      const actor = users.find(({ id }) => id === input.actorUserId);
      const target = users.find(({ id }) => id === input.targetUserId);
      if (
        !actor ||
        actor.status !== "active" ||
        (actor.role !== "admin" && actor.role !== "superadmin")
      ) {
        throw new CallRepositoryError("CREDIT_ADMIN_ACTION_FORBIDDEN");
      }
      if (input.actorUserId === input.targetUserId) {
        throw new CallRepositoryError("CREDIT_SELF_GRANT_FORBIDDEN");
      }
      if (!target || target.status !== "active" || !target.phoneVerifiedAt) {
        throw new CallRepositoryError("CREDIT_USER_NOT_FOUND");
      }
      if (actor.role !== "superadmin" && target.role !== "user") {
        throw new CallRepositoryError("CREDIT_ADMIN_ACTION_FORBIDDEN");
      }
      const [previous] = await transaction<AdminGrantRow[]>`
        SELECT
          user_id AS "userId",
          amount,
          admin_id AS "adminId",
          reason
        FROM credit_transactions
        WHERE idempotency_key = ${transactionIdempotencyKey}
      `;
      if (previous) {
        if (
          previous.userId !== input.targetUserId ||
          previous.amount !== input.credits ||
          previous.adminId !== input.actorUserId ||
          previous.reason !== input.reason
        ) {
          throw new CallRepositoryError("CREDIT_IDEMPOTENCY_CONFLICT");
        }
        return;
      }
      await this.#lockCreditAccount(transaction, input.targetUserId);
      await transaction`
        INSERT INTO credit_transactions (
          id, user_id, amount, type, admin_id,
          reason, idempotency_key, created_at
        ) VALUES (
          ${randomUUID()}, ${input.targetUserId}, ${input.credits},
          'admin_grant', ${input.actorUserId}, ${input.reason},
          ${transactionIdempotencyKey}, ${new Date(input.now)}
        )
      `;
      applied = true;
    });
    return {
      applied,
      usage: await this.getCreditUsage(input.targetUserId)
    };
  }

  async suppressRecipient(input: RecipientSuppressionInput) {
    const phoneE164 = requireSwissPhone(input.phoneE164);
    const reason = requireReason(input.reason);
    const now = new Date();
    let created = false;
    await this.#sql.begin(async (transaction) => {
      await this.#lockRecipient(transaction, phoneE164);
      const inserted = await transaction`
        INSERT INTO recipient_suppressions (
          id, phone_e164, source, reason, created_by_user_id, created_at
        ) VALUES (
          ${randomUUID()}, ${phoneE164}, ${input.source}, ${reason},
          ${input.actorUserId ?? null}, ${now}
        )
        ON CONFLICT (phone_e164) WHERE lifted_at IS NULL DO NOTHING
        RETURNING id
      `;
      if (inserted.count === 0) return;
      created = true;
      await this.#safetyEvent(transaction, {
        eventType: "recipient.suppressed",
        actorUserId: input.actorUserId ?? null,
        phoneE164,
        reason,
        metadata: { source: input.source }
      });
    });
    return created;
  }

  async liftRecipientSuppression(
    phoneE164Input: string,
    input: SafetyControlInput
  ) {
    const phoneE164 = requireSwissPhone(phoneE164Input);
    const reason = requireReason(input.reason);
    const now = new Date();
    let changed = false;
    await this.#sql.begin(async (transaction) => {
      await this.#lockRecipient(transaction, phoneE164);
      const lifted = await transaction`
        UPDATE recipient_suppressions
        SET
          lifted_at = ${now},
          lifted_by_user_id = ${input.actorUserId ?? null},
          lift_reason = ${reason}
        WHERE phone_e164 = ${phoneE164} AND lifted_at IS NULL
        RETURNING id
      `;
      if (lifted.count === 0) return;
      changed = true;
      await this.#safetyEvent(transaction, {
        eventType: "recipient.suppression_lifted",
        actorUserId: input.actorUserId ?? null,
        phoneE164,
        reason
      });
    });
    return changed;
  }

  async setOutboundCallsEnabled(
    enabled: boolean,
    input: SafetyControlInput
  ) {
    const reason = requireSystemControlReason(input.reason);
    const now = new Date();
    await this.#sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO system_controls (
          key, enabled, reason, updated_by_user_id, updated_at
        ) VALUES (
          'outbound_calls', ${enabled}, ${reason},
          ${input.actorUserId ?? null}, ${now}
        )
        ON CONFLICT (key) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          reason = EXCLUDED.reason,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = EXCLUDED.updated_at
      `;
      await this.#safetyEvent(transaction, {
        eventType: enabled
          ? "outbound_calls.enabled"
          : "outbound_calls.disabled",
        actorUserId: input.actorUserId ?? null,
        phoneE164: null,
        reason
      });
    });
  }

  async recompile(
    id: string,
    input: CreateCallBriefInput,
    compilation: CallCompilation
  ) {
    const parsed = normalizeCreateCallBriefInput(input);
    const runtime = buildRuntimeBriefFields(compilation);
    const now = new Date();
    const encryptedFacts = encryptJson(runtime.allowedFacts, this.#encryptionKey);
    const encryptedContext = encryptJson(runtime.context, this.#encryptionKey);
    const encryptedCompilation = encryptJson(compilation, this.#encryptionKey);
    const encryptedReason = encryptJson(
      parsed.assistanceReason,
      this.#encryptionKey
    );
    const encryptedDisclosure = encryptJson(
      parsed.assistanceDisclosure,
      this.#encryptionKey
    );

    await this.#sql.begin(async (transaction) => {
      const [row] = await transaction<
        {
          status: CallBrief["status"];
          compilationCiphertext: string | null;
          attemptCount: number;
        }[]
      >`
        SELECT
          status,
          compilation_ciphertext AS "compilationCiphertext",
          (SELECT COUNT(*)::int FROM call_attempts WHERE call_brief_id = ${id}) AS "attemptCount"
        FROM call_briefs
        WHERE id = ${id}
        FOR UPDATE
      `;
      if (!row) throw new CallRepositoryError("CALL_NOT_FOUND");
      if (
        !["review_required", "needs_clarification", "blocked", "ready"].includes(
          row.status
        ) ||
        row.attemptCount > 0
      ) {
        throw new CallRepositoryError("CALL_BRIEF_NOT_EDITABLE");
      }
      const previousCompilation = row.compilationCiphertext
        ? decryptJson<CallCompilation>(
            row.compilationCiphertext,
            this.#encryptionKey
          )
        : null;

      await transaction`
        UPDATE call_briefs
        SET
          recipient_name = ${parsed.recipientName},
          phone_number = ${parsed.phoneNumber},
          objective = ${runtime.objective},
          assistant_profile_id = ${parsed.assistantProfileId},
          agent_name = ${parsed.agentName},
          represented_person = ${parsed.representedPerson},
          represented_person_first_name = ${parsed.representedPersonFirstName},
          represented_person_last_name = ${parsed.representedPersonLastName},
          assistance_reason_ciphertext = ${encryptedReason},
          assistance_disclosure = ${null},
          assistance_disclosure_ciphertext = ${encryptedDisclosure},
          compilation_ciphertext = ${encryptedCompilation},
          context_ciphertext = ${encryptedContext},
          locale = ${parsed.locale},
          voice_gender = ${parsed.voiceGender},
          audio_retention_days = ${parsed.audioRetentionDays},
          allow_language_switch = ${parsed.allowLanguageSwitch},
          fallback_locale = ${parsed.fallbackLocale ?? null},
          allowed_facts_ciphertext = ${encryptedFacts},
          status = ${runtime.status},
          updated_at = ${now}
        WHERE id = ${id}
      `;
      await this.#audit(transaction, id, "call.compilation_replaced", {
        previousSnapshotHash: previousCompilation?.snapshotHash ?? "none",
        snapshotHash: compilation.snapshotHash,
        revision: String(compilation.revision),
        status: runtime.status
      });
      await this.#appendCompilationTelemetry(
        transaction,
        id,
        compilation,
        now.toISOString()
      );
    });

    return this.#require(id);
  }

  async get(id: string) {
    const [briefRow] = await this.#sql<CallBriefRow[]>`
      ${this.#briefSelect()}
      WHERE id = ${id}
    `;
    if (!briefRow) return null;

    const [transcriptRows, approvalRows, recordingRows, finalTranscriptRows] =
      await Promise.all([
      this.#sql<TranscriptRow[]>`
        SELECT
          id,
          role,
          text,
          locale,
          final,
          created_at AS "createdAt"
        FROM transcript_segments
        WHERE call_brief_id = ${id}
        ORDER BY created_at ASC
      `,
        this.#sql<ApprovalRow[]>`
        SELECT
          id,
          category,
          title,
          reason,
          proposed_speech AS "proposedSpeech",
          status,
          created_at AS "createdAt"
        FROM approval_requests
        WHERE call_brief_id = ${id} AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
        `,
        this.#sql<CallRecordingRow[]>`
          ${this.#recordingSelect()}
          WHERE call_brief_id = ${id}
          LIMIT 1
        `,
        this.#sql<FinalTranscriptRow[]>`
          SELECT
            final_transcripts.id,
            final_transcripts.status,
            final_transcripts.text_ciphertext AS "textCiphertext",
            final_transcripts.segments_ciphertext AS "segmentsCiphertext",
            final_transcripts.model,
            final_transcripts.failure_reason AS "failureReason",
            final_transcripts.created_at AS "createdAt",
            final_transcripts.updated_at AS "updatedAt",
            final_transcripts.completed_at AS "completedAt"
          FROM final_transcripts
          JOIN call_recordings
            ON call_recordings.id = final_transcripts.call_recording_id
          WHERE call_recordings.call_brief_id = ${id}
          LIMIT 1
        `
      ]);

    return {
      brief: this.#mapBrief(briefRow),
      compilation: briefRow.compilationCiphertext
        ? decryptJson<CallCompilation>(
            briefRow.compilationCiphertext,
            this.#encryptionKey
          )
        : null,
      transcript: transcriptRows.map((row) => this.#mapTranscript(row)),
      pendingApproval: approvalRows[0]
        ? this.#mapApproval(approvalRows[0])
        : null,
      recording: recordingRows[0]
        ? this.#mapRecording(recordingRows[0])
        : null,
      finalTranscript: finalTranscriptRows[0]
        ? this.#mapFinalTranscript(finalTranscriptRows[0])
        : null
    };
  }

  async appendCallTelemetryEvent(
    id: string,
    input: CallTelemetryEventInput
  ) {
    return this.#sql.begin((transaction) =>
      this.#appendTelemetry(transaction, id, input)
    );
  }

  async listCallTelemetryEvents(id: string) {
    const call = await this.#sql`SELECT id FROM call_briefs WHERE id = ${id}`;
    if (call.count === 0) throw new CallRepositoryError("CALL_NOT_FOUND");
    const rows = await this.#sql<CallTelemetryEventRow[]>`
      SELECT
        id,
        call_brief_id AS "callBriefId",
        call_attempt_id AS "callAttemptId",
        user_id AS "userId",
        sequence,
        schema_version AS "schemaVersion",
        event_name AS "eventName",
        source,
        stage,
        severity,
        metadata,
        occurred_at AS "occurredAt"
      FROM call_events
      WHERE call_brief_id = ${id}
      ORDER BY sequence ASC
    `;
    return rows.map(mapCallTelemetryEvent);
  }

  async listAdminCalls(input: ListAdminCallsInput) {
    const batchSize = Math.min(Math.max(input.limit * 2, 50), 200);
    const matched: AdminCallSummary[] = [];
    let cursor = input.cursor;
    while (matched.length <= input.limit) {
      const rows = await this.#selectAdminCallRows(
        { ...input, cursor },
        undefined,
        batchSize
      );
      if (rows.length === 0) break;
      const events = await this.#selectTelemetryForCallIds(
        rows.map(({ id }) => id)
      );
      const byCall = groupTelemetryByCall(events);
      matched.push(...rows
        .map((row) => mapAdminCallSummary(row, byCall.get(row.id) ?? []))
        .filter((summary) =>
          !input.consent || summary.technical.consent === input.consent
        )
        .filter((summary) =>
          !input.failureStage ||
          summary.technical.failureStage === input.failureStage
        ));
      if (rows.length < batchSize) break;
      const lastScanned = rows.at(-1)!;
      cursor = {
        createdAt: toIso(lastScanned.createdAt),
        id: lastScanned.id
      };
    }
    const items = matched.slice(0, input.limit);
    const last = items.at(-1);
    return adminCallListSchema.parse({
      items,
      nextCursor: matched.length > input.limit && last
        ? encodeAdminCallCursor({ createdAt: last.createdAt, id: last.id })
        : null
    });
  }

  async getAdminCallInspector(id: string) {
    const rows = await this.#selectAdminCallRows({}, id, 1);
    const row = rows[0];
    if (!row) throw new CallRepositoryError("CALL_NOT_FOUND");
    const [timeline, outcomeRows] = await Promise.all([
      this.listCallTelemetryEvents(id),
      this.#sql<CallOutcomeRevisionRow[]>`
        SELECT
          id,
          call_brief_id AS "callBriefId",
          revision,
          schema_version AS "schemaVersion",
          outcome,
          provenance,
          actor_user_id AS "actorUserId",
          reason,
          technical,
          created_at AS "createdAt"
        FROM call_outcome_revisions
        WHERE call_brief_id = ${id}
        ORDER BY revision ASC
      `
    ]);
    return adminCallInspectorSchema.parse({
      summary: mapAdminCallSummary(row, timeline),
      timeline: timeline.map(
        ({ callBriefId: _callBriefId, userId: _userId, ...event }) => event
      ),
      outcomeHistory: outcomeRows.map(mapCallOutcomeRevision)
    });
  }

  async getAdminCallSensitiveContent(
    id: string,
    actorUserId: string,
    reason: string
  ) {
    const parsed = sensitiveCallAccessInputSchema.parse({ reason });
    await this.#sql.begin(async (transaction) => {
      const call = await transaction`
        SELECT id
        FROM call_briefs
        WHERE id = ${id}
        FOR SHARE
      `;
      if (call.count === 0) {
        throw new CallRepositoryError("CALL_NOT_FOUND");
      }
      await transaction`
        INSERT INTO call_sensitive_access_events (
          id,
          call_brief_id,
          actor_user_id,
          reason,
          created_at
        ) VALUES (
          ${randomUUID()},
          ${id},
          ${actorUserId},
          ${parsed.reason},
          ${new Date()}
        )
      `;
    });
    const [snapshot, outcome] = await Promise.all([
      this.#require(id),
      this.#buildOutcomeView(id)
    ]);
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
      feedbackComment: outcome.latestFeedback?.comment ?? null
    });
  }

  async getAdminOperationsFacts(
    from: string,
    to: string
  ): Promise<AdminOperationsFacts> {
    const [row] = await this.#sql<AdminOperationsFactsRow[]>`
      WITH scoped_calls AS (
        SELECT id, status
        FROM call_briefs
        WHERE created_at >= ${from}::timestamptz
          AND created_at <= ${to}::timestamptz
      ),
      signals AS (
        SELECT
          scoped_calls.id,
          scoped_calls.status,
          EXISTS (
            SELECT 1 FROM call_attempts
            WHERE call_attempts.call_brief_id = scoped_calls.id
          ) AS attempted,
          EXISTS (
            SELECT 1 FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'connection.confirmed'
          ) AS connected,
          EXISTS (
            SELECT 1 FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'consent.granted'
          ) AS consent_granted,
          EXISTS (
            SELECT 1 FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'consent.failed'
          ) AS consent_failed,
          EXISTS (
            SELECT 1 FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND (
                call_events.severity = 'error'
                OR call_events.event_name IN ('consent.failed', 'call.recovered')
                OR (
                  call_events.event_name = 'provider.status_changed'
                  AND call_events.metadata->>'callStatus' = 'failed'
                )
                OR (
                  call_events.event_name = 'conversation.ended'
                  AND call_events.metadata->>'reason' IN (
                    'openai_closed', 'openai_error'
                  )
                )
              )
          ) AS has_failure_signal,
          (
            SELECT call_outcome_revisions.outcome
            FROM call_outcome_revisions
            WHERE call_outcome_revisions.call_brief_id = scoped_calls.id
              AND call_outcome_revisions.outcome IS NOT NULL
            ORDER BY call_outcome_revisions.revision DESC
            LIMIT 1
          ) AS semantic_outcome,
          EXISTS (
            SELECT 1 FROM call_feedback_revisions
            WHERE call_feedback_revisions.call_brief_id = scoped_calls.id
          ) AS has_feedback,
          call_recordings.duration_seconds AS recording_duration_seconds,
          (
            SELECT min((call_events.metadata->>'latencyMs')::double precision)
            FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'conversation.first_audio'
          ) AS first_audio_latency_ms,
          (
            SELECT count(*)::int
            FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'transcription.started'
              AND call_events.metadata->>'retry' = 'true'
          ) AS transcription_retries,
          (
            SELECT count(*)::int
            FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'conversation.ended'
              AND call_events.metadata->>'reason' IN (
                'openai_closed', 'openai_error'
              )
          ) AS realtime_disconnects,
          (
            SELECT count(*)::int
            FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'call.recovered'
          ) AS recoveries,
          COALESCE((
            SELECT floor(sum(GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                call_attempts.ended_at - connection.occurred_at
              ))
            )))::int
            FROM call_attempts
            JOIN LATERAL (
              SELECT min(call_events.occurred_at) AS occurred_at
              FROM call_events
              WHERE call_events.call_attempt_id = call_attempts.id
                AND call_events.event_name = 'connection.confirmed'
            ) AS connection ON connection.occurred_at IS NOT NULL
            WHERE call_attempts.call_brief_id = scoped_calls.id
              AND call_attempts.ended_at IS NOT NULL
          ), 0) AS telephony_usage_seconds,
          CASE WHEN EXISTS (
            SELECT 1 FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'realtime.ready'
          ) THEN COALESCE(call_recordings.duration_seconds, 0) ELSE 0 END
            AS realtime_usage_seconds,
          CASE WHEN EXISTS (
            SELECT 1 FROM call_events
            WHERE call_events.call_brief_id = scoped_calls.id
              AND call_events.event_name = 'transcription.started'
          ) THEN COALESCE(call_recordings.duration_seconds, 0) ELSE 0 END
            AS transcription_usage_seconds
        FROM scoped_calls
        LEFT JOIN call_recordings
          ON call_recordings.call_brief_id = scoped_calls.id
      )
      SELECT
        count(*)::int AS "createdCalls",
        count(*) FILTER (WHERE attempted)::int AS "attemptedCalls",
        count(*) FILTER (
          WHERE status IN ('dialing', 'in_progress', 'awaiting_approval')
        )::int AS "activeCalls",
        count(*) FILTER (
          WHERE status IN ('blocked', 'completed', 'stopped', 'failed')
        )::int AS "terminalCalls",
        count(*) FILTER (WHERE connected)::int AS "connectedCalls",
        count(*) FILTER (WHERE consent_granted)::int AS "consentGrantedCalls",
        count(*) FILTER (WHERE consent_failed)::int AS "consentFailedCalls",
        count(*) FILTER (WHERE
          status = 'blocked'
          OR has_failure_signal
          OR (
            status IN ('completed', 'stopped', 'failed')
            AND NOT connected
          )
        )::int AS "technicalFailureCalls",
        count(*) FILTER (WHERE has_feedback)::int AS "feedbackResponses",
        count(*) FILTER (WHERE semantic_outcome = 'resolved')::int AS resolved,
        count(*) FILTER (
          WHERE semantic_outcome = 'partially_resolved'
        )::int AS "partiallyResolved",
        count(*) FILTER (WHERE semantic_outcome = 'unresolved')::int AS unresolved,
        count(*) FILTER (
          WHERE semantic_outcome = 'wrong_recipient'
        )::int AS "wrongRecipient",
        count(*) FILTER (WHERE semantic_outcome = 'voicemail')::int AS voicemail,
        count(*) FILTER (WHERE semantic_outcome = 'declined')::int AS declined,
        count(*) FILTER (
          WHERE semantic_outcome = 'technical_failure'
        )::int AS "technicalFailure",
        count(*) FILTER (WHERE semantic_outcome IS NULL)::int AS unclassified,
        count(recording_duration_seconds)::int AS "durationSamples",
        COALESCE(sum(recording_duration_seconds), 0)::int AS "durationTotal",
        avg(recording_duration_seconds)::double precision AS "durationAverage",
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY recording_duration_seconds
        )::double precision AS "durationP95",
        count(first_audio_latency_ms)::int AS "firstAudioSamples",
        COALESCE(sum(first_audio_latency_ms), 0)::int AS "firstAudioTotal",
        avg(first_audio_latency_ms)::double precision AS "firstAudioAverage",
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY first_audio_latency_ms
        )::double precision AS "firstAudioP95",
        COALESCE(sum(transcription_retries), 0)::int AS "transcriptionRetries",
        COALESCE(sum(realtime_disconnects), 0)::int AS "realtimeDisconnects",
        COALESCE(sum(recoveries), 0)::int AS recoveries,
        COALESCE(sum(telephony_usage_seconds), 0)::int AS "telephonyUsageSeconds",
        COALESCE(sum(realtime_usage_seconds), 0)::int AS "realtimeUsageSeconds",
        COALESCE(sum(transcription_usage_seconds), 0)::int
          AS "transcriptionUsageSeconds"
      FROM signals
    `;
    if (!row) throw new Error("Admin operations query returned no row");
    return {
      createdCalls: row.createdCalls,
      attemptedCalls: row.attemptedCalls,
      activeCalls: row.activeCalls,
      terminalCalls: row.terminalCalls,
      connectedCalls: row.connectedCalls,
      consentGrantedCalls: row.consentGrantedCalls,
      consentFailedCalls: row.consentFailedCalls,
      technicalFailureCalls: row.technicalFailureCalls,
      feedbackResponses: row.feedbackResponses,
      semanticOutcomes: {
        resolved: row.resolved,
        partiallyResolved: row.partiallyResolved,
        unresolved: row.unresolved,
        wrongRecipient: row.wrongRecipient,
        voicemail: row.voicemail,
        declined: row.declined,
        technicalFailure: row.technicalFailure,
        unclassified: row.unclassified
      },
      recordedDurationSeconds: {
        samples: row.durationSamples,
        total: row.durationTotal,
        average: row.durationAverage,
        p95: row.durationP95
      },
      firstAudioLatencyMs: {
        samples: row.firstAudioSamples,
        total: row.firstAudioTotal,
        average: row.firstAudioAverage,
        p95: row.firstAudioP95
      },
      transcriptionRetries: row.transcriptionRetries,
      realtimeDisconnects: row.realtimeDisconnects,
      recoveries: row.recoveries,
      usageSeconds: {
        telephony: row.telephonyUsageSeconds,
        realtime: row.realtimeUsageSeconds,
        transcription: row.transcriptionUsageSeconds
      }
    };
  }

  async getAdminSystemFacts(
    now: string,
    recentSince: string,
    webhookSince = recentSince
  ): Promise<AdminSystemFacts> {
    const workerFreshSince = new Date(
      Date.parse(now) - durableWorkerHeartbeatStaleAfterMs
    ).toISOString();
    const workerRetentionSince = new Date(
      Date.parse(now) - durableWorkerHeartbeatRetentionMs
    ).toISOString();
    const [row] = await this.#sql<AdminSystemFactsRow[]>`
      SELECT
        system_controls.enabled AS "outboundCallsEnabled",
        system_controls.reason AS "outboundCallsReason",
        system_controls.updated_at AS "outboundCallsUpdatedAt",
        (
          SELECT count(*)::int FROM call_briefs
          WHERE status IN ('dialing', 'in_progress', 'awaiting_approval')
        ) AS "activeCalls",
        (
          SELECT count(*)::int FROM call_recordings
          WHERE status IN ('starting', 'recording', 'processing')
        ) AS "recordingsProcessing",
        (
          SELECT count(*)::int
          FROM call_recordings
          LEFT JOIN final_transcripts
            ON final_transcripts.call_recording_id = call_recordings.id
          WHERE call_recordings.status = 'available'
            AND (
              final_transcripts.id IS NULL
              OR final_transcripts.status = 'failed'
            )
        ) AS "transcriptionReady",
        (
          SELECT count(*)::int FROM final_transcripts
          WHERE status = 'processing'
        ) AS "transcriptionProcessing",
        (
          SELECT count(*)::int FROM final_transcripts
          WHERE status = 'failed'
        ) AS "transcriptionFailed",
        (
          SELECT count(*)::int FROM call_recordings
          WHERE status = 'available' AND delete_after IS NOT NULL
        ) AS "retentionScheduled",
        (
          SELECT count(*)::int FROM call_recordings
          WHERE status = 'available'
            AND delete_after IS NOT NULL
            AND delete_after <= ${now}::timestamptz
        ) AS "retentionOverdue",
        (
          SELECT count(*)::int FROM call_events
          WHERE occurred_at >= ${recentSince}::timestamptz
            AND severity = 'warning'
        ) AS "recentWarnings",
        (
          SELECT count(*)::int FROM call_events
          WHERE occurred_at >= ${recentSince}::timestamptz
            AND severity = 'error'
        ) AS "recentErrors",
        (
          SELECT count(*)::int FROM durable_jobs WHERE status = 'queued'
        ) AS "jobsQueued",
        (
          SELECT count(*)::int FROM durable_jobs WHERE status = 'running'
        ) AS "jobsRunning",
        (
          SELECT count(*)::int FROM durable_jobs WHERE status = 'succeeded'
        ) AS "jobsSucceeded",
        (
          SELECT count(*)::int FROM durable_jobs WHERE status = 'dead_letter'
        ) AS "jobsDeadLetter",
        (
          SELECT count(*)::int FROM durable_jobs
          WHERE status = 'queued' AND attempt_count > 0
        ) AS "jobsRetryQueued",
        (
          SELECT count(*)::int FROM durable_jobs
          WHERE status = 'queued' AND job_type = 'final_transcription'
        ) AS "transcriptionQueued",
        (
          SELECT count(*)::int FROM durable_jobs
          WHERE status = 'queued' AND job_type = 'recording_retention'
        ) AS "retentionQueued",
        (
          SELECT count(*)::int FROM durable_jobs
          WHERE status = 'queued'
            AND job_type IN (
              'provider_call_reconciliation',
              'provider_recording_reconciliation'
            )
        ) AS "providerReconciliationQueued",
        (
          SELECT min(run_after) FROM durable_jobs WHERE status = 'queued'
        ) AS "oldestJobDueAt",
        (
          SELECT count(*)::int FROM durable_worker_heartbeats
          WHERE stopped_at IS NULL
            AND last_seen_at >= ${workerFreshSince}::timestamptz
        ) AS "workerHealthyInstances",
        (
          SELECT count(*)::int FROM durable_worker_heartbeats
          WHERE stopped_at IS NULL
            AND last_seen_at < ${workerFreshSince}::timestamptz
            AND last_seen_at >= ${workerRetentionSince}::timestamptz
        ) AS "workerStaleInstances",
        (
          SELECT coalesce(sum(active_jobs), 0)::int
          FROM durable_worker_heartbeats
          WHERE stopped_at IS NULL
            AND last_seen_at >= ${workerFreshSince}::timestamptz
        ) AS "workerActiveJobs",
        (
          SELECT max(last_seen_at) FROM durable_worker_heartbeats
          WHERE last_seen_at >= ${workerRetentionSince}::timestamptz
        ) AS "workerLastSeenAt"
      FROM system_controls
      WHERE key = 'outbound_calls'
    `;
    if (!row) throw new Error("Outbound-call system control is missing");
    const recentJobs = await this.#sql<DurableJobRow[]>`
      ${this.#durableJobSelect()}
      ORDER BY durable_jobs.updated_at DESC, durable_jobs.id DESC
      LIMIT 20
    `;
    const webhookRows = await this.#sql<ProviderWebhookBucketRow[]>`
      SELECT
        webhook_kind AS "kind",
        outcome,
        delivery_count AS "deliveryCount",
        last_received_at AS "lastReceivedAt",
        last_error_code AS "lastErrorCode"
      FROM provider_webhook_delivery_buckets
      WHERE provider = 'twilio'
        AND bucket_started_at >= ${webhookSince}::timestamptz
      ORDER BY
        last_received_at ASC,
        CASE outcome
          WHEN 'rejected' THEN 1
          WHEN 'unmatched' THEN 2
          WHEN 'failed' THEN 3
          ELSE 0
        END ASC
    `;
    return {
      outboundCalls: {
        enabled: row.outboundCallsEnabled,
        reason: row.outboundCallsReason,
        updatedAt: row.outboundCallsUpdatedAt
          ? toIso(row.outboundCallsUpdatedAt)
          : null
      },
      activeCalls: row.activeCalls,
      recordingsProcessing: row.recordingsProcessing,
      transcriptionReady: row.transcriptionReady,
      transcriptionProcessing: row.transcriptionProcessing,
      transcriptionFailed: row.transcriptionFailed,
      retentionScheduled: row.retentionScheduled,
      retentionOverdue: row.retentionOverdue,
      recentWarnings: row.recentWarnings,
      recentErrors: row.recentErrors,
      externalWorker: {
        healthyInstances: row.workerHealthyInstances,
        staleInstances: row.workerStaleInstances,
        activeJobs: row.workerActiveJobs,
        lastSeenAt: row.workerLastSeenAt ? toIso(row.workerLastSeenAt) : null
      },
      webhooks: aggregateProviderWebhookFacts(webhookRows),
      jobs: {
        queued: row.jobsQueued,
        running: row.jobsRunning,
        succeeded: row.jobsSucceeded,
        deadLetter: row.jobsDeadLetter,
        retryQueued: row.jobsRetryQueued,
        transcriptionQueued: row.transcriptionQueued,
        retentionQueued: row.retentionQueued,
        providerReconciliationQueued: row.providerReconciliationQueued,
        oldestDueAt: row.oldestJobDueAt ? toIso(row.oldestJobDueAt) : null,
        recent: recentJobs.map(mapDurableJobRow).map(({
          recordingId: _recordingId,
          callAttemptId: _callAttemptId,
          forceRequested: _force,
          leaseOwner: _owner,
          leasedAt: _leasedAt,
          createdAt: _createdAt,
          completedAt: _completedAt,
          ...job
        }) => job)
      }
    };
  }

  async publishCallChange(signal: CallChangeSignal) {
    if (!isUuid(signal.sourceId) || !isUuid(signal.callId)) {
      throw new Error("CALL_CHANGE_SIGNAL_INVALID");
    }
    await this.#sql.notify(callChangeChannel, JSON.stringify(signal));
  }

  async subscribeCallChanges(
    subscriber: (signal: CallChangeSignal) => void
  ) {
    const listener = await this.#sql.listen(callChangeChannel, (payload) => {
      const signal = parseCallChangeSignal(payload);
      if (signal) subscriber(signal);
    });
    return () => listener.unlisten();
  }

  async reportDurableWorkerHeartbeat(input: DurableWorkerHeartbeatInput) {
    const retentionCutoff = new Date(
      Date.parse(input.seenAt) - durableWorkerHeartbeatRetentionMs
    ).toISOString();
    await this.#sql.begin(async (transaction) => {
      await transaction`
        DELETE FROM durable_worker_heartbeats
        WHERE last_seen_at < ${retentionCutoff}::timestamptz
      `;
      await transaction`
        INSERT INTO durable_worker_heartbeats (
          worker_id,
          started_at,
          last_seen_at,
          stopped_at,
          active_jobs
        ) VALUES (
          ${input.workerId},
          ${input.startedAt}::timestamptz,
          ${input.seenAt}::timestamptz,
          NULL,
          ${input.activeJobs}
        )
        ON CONFLICT (worker_id) DO UPDATE SET
          started_at = EXCLUDED.started_at,
          last_seen_at = EXCLUDED.last_seen_at,
          stopped_at = NULL,
          active_jobs = EXCLUDED.active_jobs
      `;
    });
  }

  async stopDurableWorkerHeartbeat(workerId: string, stoppedAt: string) {
    await this.#sql`
      UPDATE durable_worker_heartbeats
      SET
        last_seen_at = GREATEST(last_seen_at, ${stoppedAt}::timestamptz),
        stopped_at = ${stoppedAt}::timestamptz,
        active_jobs = 0
      WHERE worker_id = ${workerId}
    `;
  }

  async recordProviderWebhookDelivery(input: ProviderWebhookDeliveryInput) {
    const receivedAt = new Date(input.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) {
      throw new Error("WEBHOOK_RECEIVED_AT_INVALID");
    }
    const bucketStartedAt = startOfUtcHour(receivedAt);
    const cutoff = startOfUtcHour(new Date(
      receivedAt.getTime() - 30 * 24 * 60 * 60 * 1_000
    ));
    const errorCode = input.outcome === "accepted"
      ? null
      : safeProviderWebhookErrorCode(input.errorCode);
    await this.#sql.begin(async (transaction) => {
      await transaction`
        DELETE FROM provider_webhook_delivery_buckets
        WHERE bucket_started_at < ${cutoff}
      `;
      await transaction`
        INSERT INTO provider_webhook_delivery_buckets (
          provider,
          webhook_kind,
          outcome,
          bucket_started_at,
          delivery_count,
          last_received_at,
          last_error_code
        ) VALUES (
          'twilio',
          ${input.kind},
          ${input.outcome},
          ${bucketStartedAt},
          1,
          ${receivedAt},
          ${errorCode}
        )
        ON CONFLICT (
          provider,
          webhook_kind,
          outcome,
          bucket_started_at
        ) DO UPDATE SET
          delivery_count =
            provider_webhook_delivery_buckets.delivery_count + 1,
          last_received_at = GREATEST(
            provider_webhook_delivery_buckets.last_received_at,
            EXCLUDED.last_received_at
          ),
          last_error_code = CASE
            WHEN EXCLUDED.last_received_at >=
              provider_webhook_delivery_buckets.last_received_at
              THEN EXCLUDED.last_error_code
            ELSE provider_webhook_delivery_buckets.last_error_code
          END
      `;
    });
  }

  async getCallOutcome(id: string) {
    return this.#buildOutcomeView(id);
  }

  async recordSystemCallOutcome(id: string) {
    await this.#sql.begin(async (transaction) => {
      const [call] = await transaction<{ status: CallBrief["status"] }[]>`
        SELECT status
        FROM call_briefs
        WHERE id = ${id}
        FOR SHARE
      `;
      if (!call) throw new CallRepositoryError("CALL_NOT_FOUND");
      const technical = await this.#deriveTechnicalOutcome(
        transaction,
        id,
        call.status
      );
      if (
        technical.terminalStatus === null &&
        technical.failureStage === null
      ) {
        return;
      }
      await this.#lockCallOutcome(transaction, id);
      const [latestSystem] = await transaction<CallOutcomeRevisionRow[]>`
        ${callOutcomeRevisionSelect(transaction)}
        WHERE call_brief_id = ${id} AND provenance = 'system'
        ORDER BY revision DESC
        LIMIT 1
      `;
      if (
        latestSystem &&
        sameTechnicalOutcome(
          mapCallOutcomeRevision(latestSystem).technical,
          technical
        )
      ) {
        return;
      }
      await this.#appendOutcomeRevision(transaction, id, {
        outcome: null,
        provenance: "system",
        actorUserId: null,
        reason: "technical_state_changed",
        technical,
        idempotencyKey: systemOutcomeIdempotencyKey(technical),
        createdAt: new Date()
      });
    });
    return this.#buildOutcomeView(id);
  }

  async submitOwnerCallFeedback(
    id: string,
    userId: string,
    input: OwnerCallFeedbackInput
  ) {
    const parsed = ownerCallFeedbackInputSchema.parse(input);
    const normalized = {
      ...parsed,
      comment: parsed.comment?.trim() || null
    };
    const activeKeyId = dataEncryptionActiveKeyId(this.#encryptionKey);
    const fingerprint = createCallFeedbackFingerprint(
      normalized,
      this.#encryptionKey,
      activeKeyId
    );
    await this.#sql.begin(async (transaction) => {
      await this.#lockOperation(
        transaction,
        `call-feedback:${userId}:${normalized.idempotencyKey}`
      );
      const [replay] = await transaction<CallFeedbackRevisionRow[]>`
        ${callFeedbackRevisionSelect(transaction)}
        WHERE user_id = ${userId}
          AND idempotency_key = ${normalized.idempotencyKey}
        LIMIT 1
      `;
      if (replay) {
        const replayFingerprint = createCallFeedbackFingerprint(
          normalized,
          this.#encryptionKey,
          replay.payloadFingerprintKeyId
        );
        if (
          replay.callBriefId !== id ||
          replay.payloadFingerprint !== replayFingerprint
        ) {
          throw new CallRepositoryError(
            "CALL_FEEDBACK_IDEMPOTENCY_CONFLICT"
          );
        }
        return;
      }

      const [call] = await transaction<
        { ownerUserId: string | null; status: CallBrief["status"] }[]
      >`
        SELECT user_id AS "ownerUserId", status
        FROM call_briefs
        WHERE id = ${id}
        FOR SHARE
      `;
      if (!call || call.ownerUserId !== userId) {
        throw new CallRepositoryError("CALL_NOT_FOUND");
      }
      if (!(["completed", "stopped", "failed"] as CallBrief["status"][])
        .includes(call.status)) {
        throw new CallRepositoryError("CALL_FEEDBACK_NOT_AVAILABLE");
      }
      await this.#lockCallOutcome(transaction, id);
      const [{ nextRevision }] = await transaction<
        { nextRevision: number }[]
      >`
        SELECT COALESCE(MAX(revision), 0)::int + 1 AS "nextRevision"
        FROM call_feedback_revisions
        WHERE call_brief_id = ${id}
      `;
      const feedbackId = randomUUID();
      const now = new Date();
      const commentCiphertext = normalized.comment
        ? encryptJson(normalized.comment, this.#encryptionKey)
        : null;
      await transaction`
        INSERT INTO call_feedback_revisions (
          id,
          call_brief_id,
          user_id,
          revision,
          schema_version,
          goal_result,
          transcript_quality,
          comment_ciphertext,
          payload_fingerprint,
          payload_fingerprint_key_id,
          idempotency_key,
          created_at
        ) VALUES (
          ${feedbackId},
          ${id},
          ${userId},
          ${nextRevision},
          ${CALL_OUTCOME_SCHEMA_VERSION},
          ${normalized.goalResult},
          ${normalized.transcriptQuality},
          ${commentCiphertext},
          ${fingerprint},
          ${activeKeyId},
          ${normalized.idempotencyKey},
          ${now}
        )
      `;
      const technical = await this.#deriveTechnicalOutcome(
        transaction,
        id,
        call.status
      );
      await this.#appendOutcomeRevision(transaction, id, {
        outcome: semanticOutcomeForGoalResult(normalized.goalResult),
        provenance: "user",
        actorUserId: userId,
        reason: "owner_feedback",
        technical,
        idempotencyKey: `feedback:${feedbackId}:outcome`,
        createdAt: now
      });
    });
    return this.#buildOutcomeView(id);
  }

  async getCallOutcomeMetrics(): Promise<CallOutcomeMetrics> {
    const [terminalRows, goalRows, qualityRows, semanticRows, failureRows] =
      await Promise.all([
        this.#sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM call_briefs
          WHERE status IN ('completed', 'stopped', 'failed')
        `,
        this.#sql<{ value: CallGoalResult; count: number }[]>`
          WITH latest AS (
            SELECT DISTINCT ON (call_brief_id) goal_result
            FROM call_feedback_revisions
            ORDER BY call_brief_id, revision DESC
          )
          SELECT goal_result AS value, count(*)::int AS count
          FROM latest
          GROUP BY goal_result
        `,
        this.#sql<{
          value: NonNullable<CallFeedbackRevision["transcriptQuality"]>;
          count: number;
        }[]>`
          WITH latest AS (
            SELECT DISTINCT ON (call_brief_id) transcript_quality
            FROM call_feedback_revisions
            ORDER BY call_brief_id, revision DESC
          )
          SELECT transcript_quality AS value, count(*)::int AS count
          FROM latest
          WHERE transcript_quality IS NOT NULL
          GROUP BY transcript_quality
        `,
        this.#sql<{ value: SemanticCallOutcome; count: number }[]>`
          WITH latest AS (
            SELECT DISTINCT ON (call_brief_id) outcome
            FROM call_outcome_revisions
            WHERE outcome IS NOT NULL
            ORDER BY call_brief_id, revision DESC
          )
          SELECT outcome AS value, count(*)::int AS count
          FROM latest
          GROUP BY outcome
        `,
        this.#sql<{ value: NonNullable<TechnicalCallOutcome["failureStage"]>; count: number }[]>`
          WITH latest AS (
            SELECT DISTINCT ON (call_brief_id) technical
            FROM call_outcome_revisions
            ORDER BY call_brief_id, revision DESC
          )
          SELECT technical->>'failureStage' AS value, count(*)::int AS count
          FROM latest
          WHERE technical->>'failureStage' IS NOT NULL
          GROUP BY technical->>'failureStage'
        `
      ]);
    const metrics = emptyOutcomeMetrics();
    metrics.terminalCalls = terminalRows[0]?.count ?? 0;
    metrics.feedbackResponses = goalRows.reduce(
      (total, row) => total + row.count,
      0
    );
    for (const row of goalRows) metrics.goalResults[row.value] = row.count;
    for (const row of qualityRows) {
      if (row.value === "some_errors") {
        metrics.transcriptQuality.someErrors = row.count;
      } else {
        metrics.transcriptQuality[row.value] = row.count;
      }
    }
    for (const row of semanticRows) {
      setSemanticOutcomeCount(metrics, row.value, row.count);
    }
    for (const row of failureRows) {
      metrics.technicalFailures[row.value] = row.count;
    }
    return callOutcomeMetricsSchema.parse(metrics);
  }

  async approveCompilation(id: string) {
    const now = new Date();
    await this.#sql.begin(async (transaction) => {
      const [row] = await transaction<
        { status: CallBrief["status"]; compilationCiphertext: string | null }[]
      >`
        SELECT
          status,
          compilation_ciphertext AS "compilationCiphertext"
        FROM call_briefs
        WHERE id = ${id}
        FOR UPDATE
      `;
      if (!row) throw new CallRepositoryError("CALL_NOT_FOUND");
      const compilation = row.compilationCiphertext
        ? decryptJson<CallCompilation>(
            row.compilationCiphertext,
            this.#encryptionKey
          )
        : null;
      if (
        row.status !== "review_required" ||
        compilation?.policyDecision.status !== "ready_for_review" ||
        !compilation.compiledBrief
      ) {
        throw new CallRepositoryError("CALL_BRIEF_NOT_REVIEWABLE");
      }
      compilation.approvedAt = now.toISOString();
      await transaction`
        UPDATE call_briefs
        SET
          status = 'ready',
          compilation_ciphertext = ${encryptJson(
            compilation,
            this.#encryptionKey
          )},
          updated_at = ${now}
        WHERE id = ${id}
      `;
      await this.#audit(transaction, id, "call.compilation_approved", {
        snapshotHash: compilation.snapshotHash,
        status: "ready"
      });
      await this.#appendTelemetry(transaction, id, {
        idempotencyKey: `compilation:${compilation.revision}:approved`,
        occurredAt: now.toISOString(),
        payload: {
          name: "compilation.approved",
          metadata: { revision: compilation.revision }
        }
      });
    });
    return this.#require(id);
  }

  async getLatestAttempt(id: string) {
    const [call] = await this.#sql`SELECT id FROM call_briefs WHERE id = ${id}`;
    if (!call) throw new CallRepositoryError("CALL_NOT_FOUND");
    const [row] = await this.#sql<CallAttemptRow[]>`
      SELECT
        id,
        call_brief_id AS "callBriefId",
        provider,
        provider_call_id AS "providerCallId",
        status,
        provider_status AS "providerStatus",
        started_at AS "startedAt",
        ended_at AS "endedAt",
        failure_reason AS "failureReason"
      FROM call_attempts
      WHERE call_brief_id = ${id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return row ? this.#mapAttempt(row) : null;
  }

  async startAttempt(id: string, input: StartAttemptInput) {
    const now = new Date();
    const attemptId = randomUUID();
    const userId = input.userId ?? null;
    await this.#sql.begin(async (transaction) => {
      if (userId) {
        await this.#lockCreditAccount(transaction, userId);
        await this.#lockActiveUser(transaction, userId);
      }
      const [call] = await transaction<
        { status: CallBrief["status"]; phoneE164: string }[]
      >`
        SELECT status, phone_number AS "phoneE164"
        FROM call_briefs
        WHERE id = ${id}
          AND (${userId}::uuid IS NULL OR user_id = ${userId})
        FOR UPDATE
      `;
      if (!call) throw new CallRepositoryError("CALL_NOT_FOUND");
      if (call.status !== "ready") {
        throw new CallRepositoryError("CALL_NOT_READY");
      }
      const [control] = await transaction<{ enabled: boolean }[]>`
        SELECT enabled
        FROM system_controls
        WHERE key = 'outbound_calls'
        FOR SHARE
      `;
      if (!control?.enabled) {
        throw new CallRepositoryError("OUTBOUND_CALLS_DISABLED");
      }
      await this.#lockRecipient(transaction, call.phoneE164);
      const suppression = await transaction`
        SELECT id
        FROM recipient_suppressions
        WHERE phone_e164 = ${call.phoneE164} AND lifted_at IS NULL
        LIMIT 1
      `;
      if (suppression.count > 0) {
        throw new CallRepositoryError("RECIPIENT_SUPPRESSED");
      }
      if (userId) {
        const policy = input.admissionPolicy ?? defaultCallAdmissionPolicy;
        const hourStart = new Date(now.getTime() - 60 * 60 * 1_000);
        const dayStart = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate()
        ));
        const [usage] = await transaction<
          {
            active: boolean;
            hourlyStarts: number;
            dailyStarts: number;
            recipientDailyStarts: number;
          }[]
        >`
          SELECT
            EXISTS(
              SELECT 1 FROM call_attempts
              WHERE user_id = ${userId} AND ended_at IS NULL
            ) AS active,
            count(*) FILTER (
              WHERE call_attempts.started_at >= ${hourStart}
            )::int AS "hourlyStarts",
            count(*) FILTER (
              WHERE call_attempts.started_at >= ${dayStart}
            )::int AS "dailyStarts",
            count(*) FILTER (
              WHERE call_attempts.started_at >= ${dayStart}
                AND call_briefs.phone_number = ${call.phoneE164}
            )::int AS "recipientDailyStarts"
          FROM call_attempts
          JOIN call_briefs ON call_briefs.id = call_attempts.call_brief_id
          WHERE call_attempts.user_id = ${userId}
        `;
        if (usage?.active) {
          throw new CallRepositoryError("CONCURRENT_CALL_LIMIT");
        }
        const [credits] = await transaction<{ balance: number }[]>`
          SELECT COALESCE(sum(amount), 0)::int AS balance
          FROM credit_transactions
          WHERE user_id = ${userId}
        `;
        if ((credits?.balance ?? 0) < 1) {
          throw new CallRepositoryError("INSUFFICIENT_CREDITS");
        }
        if ((usage?.hourlyStarts ?? 0) >= policy.maxStartsPerHour) {
          throw new CallRepositoryError("HOURLY_CALL_LIMIT");
        }
        if ((usage?.dailyStarts ?? 0) >= policy.maxStartsPerDay) {
          throw new CallRepositoryError("DAILY_CALL_LIMIT");
        }
        if (
          (usage?.recipientDailyStarts ?? 0) >=
          policy.maxStartsPerRecipientPerDay
        ) {
          throw new CallRepositoryError("RECIPIENT_REPEAT_LIMIT");
        }
      }
      const updated = await transaction`
        UPDATE call_briefs
        SET status = 'dialing', updated_at = ${now}
        WHERE id = ${id}
          AND status = 'ready'
          AND (${userId}::uuid IS NULL OR user_id = ${userId})
        RETURNING id
      `;
      if (updated.count === 0) {
        const existing = await transaction`
          SELECT id FROM call_briefs WHERE id = ${id}
        `;
        if (existing.count === 0) throw new CallRepositoryError("CALL_NOT_FOUND");
        throw new CallRepositoryError("CALL_NOT_READY");
      }

      await transaction`
        INSERT INTO call_attempts (
          id,
          call_brief_id,
          user_id,
          provider,
          provider_call_id,
          status,
          provider_status,
          started_at,
          created_at
        ) VALUES (
          ${attemptId},
          ${id},
          ${userId},
          ${input.provider},
          ${null},
          'dialing',
          ${null},
          ${now},
          ${now}
        )
      `;
      if (userId) {
        await transaction`
          INSERT INTO credit_transactions (
            id, user_id, amount, type, call_attempt_id, reason,
            idempotency_key, created_at
          ) VALUES (
            ${randomUUID()}, ${userId}, -1, 'call_reservation', ${attemptId},
            'Outbound call credit reservation',
            ${`call:${attemptId}:reservation`}, ${now}
          )
        `;
      }
      await this.#audit(transaction, id, "call.attempt_started", {
        provider: input.provider
      });
      await this.#audit(transaction, id, "call.status_changed", {
        status: "dialing"
      });
      await this.#appendTelemetry(transaction, id, {
        callAttemptId: attemptId,
        idempotencyKey: `attempt:${attemptId}:started`,
        occurredAt: now.toISOString(),
        payload: {
          name: "attempt.started",
          metadata: { provider: input.provider }
        }
      });
      if (userId) {
        await this.#appendTelemetry(transaction, id, {
          callAttemptId: attemptId,
          idempotencyKey: `attempt:${attemptId}:credit:reserved`,
          occurredAt: now.toISOString(),
          payload: {
            name: "credit.reserved",
            metadata: { credits: 1 }
          }
        });
      }
    });
    const attempt = await this.getLatestAttempt(id);
    if (!attempt || attempt.id !== attemptId) {
      throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    }
    return { attempt, snapshot: await this.#require(id) };
  }

  async attachProviderCall(
    attemptId: string,
    providerCallId: string,
    providerStatus: string,
    reconciliationRunAfter?: string
  ) {
    const row = await this.#sql.begin(async (transaction) => {
      const [updated] = await transaction<
        {
          callId: string;
          provider: CallAttemptRecord["provider"];
        }[]
      >`
        UPDATE call_attempts
        SET
          provider_call_id = ${providerCallId},
          provider_status = CASE
            WHEN provider_call_id IS NULL THEN ${providerStatus}
            ELSE provider_status
          END
        WHERE id = ${attemptId}
          AND (provider_call_id IS NULL OR provider_call_id = ${providerCallId})
        RETURNING call_brief_id AS "callId", provider
      `;
      if (!updated) return null;
      const settlement = await this.#settleAttempt(
        transaction,
        attemptId,
        creditSettlementForStatus("dialing", providerStatus)
      );
      const safeProviderStatus = safeTelemetryCode(
        providerStatus,
        "unknown_provider_status"
      );
      await this.#appendTelemetry(transaction, updated.callId, {
        callAttemptId: attemptId,
        idempotencyKey: `attempt:${attemptId}:provider:created`,
        occurredAt: new Date().toISOString(),
        payload: {
          name: "provider.call_created",
          metadata: {
            provider: updated.provider,
            providerStatus: safeProviderStatus
          }
        }
      });
      await this.#appendConnectionTelemetry(
        transaction,
        updated.callId,
        attemptId,
        providerStatus
      );
      if (settlement) {
        await this.#appendSettlementTelemetry(
          transaction,
          updated.callId,
          attemptId,
          settlement
        );
      }
      const [call] = await transaction<{ status: CallBrief["status"] }[]>`
        SELECT status FROM call_briefs
        WHERE id = ${updated.callId}
        FOR UPDATE
      `;
      if (
        reconciliationRunAfter &&
        updated.provider === "twilio" &&
        call &&
        !terminalStatuses.has(call.status)
      ) {
        const jobNow = new Date();
        await transaction`
          INSERT INTO durable_jobs (
            id, job_type, call_attempt_id, status, max_attempts,
            run_after, created_at, updated_at
          ) VALUES (
            ${randomUUID()}, 'provider_call_reconciliation', ${attemptId},
            'queued', ${durableJobMaxAttempts.provider_call_reconciliation},
            ${reconciliationRunAfter}::timestamptz, ${jobNow}, ${jobNow}
          )
          ON CONFLICT (job_type, call_attempt_id)
            WHERE call_attempt_id IS NOT NULL
          DO UPDATE SET
            run_after = LEAST(durable_jobs.run_after, EXCLUDED.run_after),
            updated_at = EXCLUDED.updated_at
          WHERE durable_jobs.status = 'queued'
        `;
      }
      return updated;
    });
    if (!row) throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    return this.#require(row.callId);
  }

  async applyProviderStatus(
    providerCallId: string,
    providerStatus: string,
    callStatus: CallBrief["status"],
    callBriefId?: string,
    lease?: DurableJobLease
  ) {
    const now = new Date();
    const callId = await this.#sql.begin(async (transaction) => {
      if (lease) {
        await requirePostgresDurableJobLease(transaction, lease);
      }
      const [row] = await transaction<
        {
          attemptId: string;
          callId: string;
          currentStatus: CallBrief["status"];
        }[]
      >`
        SELECT
          call_attempts.id AS "attemptId",
          call_briefs.id AS "callId",
          call_briefs.status AS "currentStatus"
        FROM call_attempts
        JOIN call_briefs ON call_briefs.id = call_attempts.call_brief_id
        WHERE call_attempts.provider_call_id = ${providerCallId}
          OR (
            call_attempts.provider_call_id IS NULL
            AND call_attempts.call_brief_id::text = ${callBriefId ?? ""}
          )
        ORDER BY (call_attempts.provider_call_id = ${providerCallId}) DESC,
          call_attempts.created_at DESC
        LIMIT 1
        FOR UPDATE OF call_attempts, call_briefs
      `;
      if (!row) return null;

      const terminal = terminalStatuses.has(callStatus);
      const applyCallStatus = shouldApplyProviderCallStatus(
        row.currentStatus,
        callStatus
      );
      await transaction`
        UPDATE call_attempts
        SET
          provider_call_id = COALESCE(provider_call_id, ${providerCallId}),
          provider_status = ${providerStatus},
          status = CASE WHEN ${applyCallStatus} THEN ${callStatus} ELSE status END,
          ended_at = CASE
            WHEN ${terminal} THEN COALESCE(ended_at, ${now})
            ELSE ended_at
          END,
          failure_reason = CASE
            WHEN ${callStatus === "failed"}
              THEN COALESCE(failure_reason, ${providerStatus})
            ELSE failure_reason
          END
        WHERE id = ${row.attemptId}
      `;
      const settlement = await this.#settleAttempt(
        transaction,
        row.attemptId,
        creditSettlementForStatus(callStatus, providerStatus)
      );
      const occurredAt = now.toISOString();
      const safeProviderStatus = safeTelemetryCode(
        providerStatus,
        "unknown_provider_status"
      );
      await this.#appendTelemetry(transaction, row.callId, {
        callAttemptId: row.attemptId,
        idempotencyKey: `attempt:${row.attemptId}:provider-status:${safeProviderStatus}:${callStatus}`,
        occurredAt,
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
        !terminalStatuses.has(row.currentStatus) &&
        connectedProviderStatuses.has(providerStatus)
      ) {
        await this.#appendConnectionTelemetry(
          transaction,
          row.callId,
          row.attemptId,
          providerStatus,
          occurredAt
        );
      }
      if (settlement) {
        await this.#appendSettlementTelemetry(
          transaction,
          row.callId,
          row.attemptId,
          settlement,
          occurredAt
        );
      }

      if (applyCallStatus) {
        await transaction`
          UPDATE call_briefs
          SET status = ${callStatus}, updated_at = ${now}
          WHERE id = ${row.callId}
        `;
      }
      if (terminal) {
        await transaction`
          UPDATE call_recordings
          SET status = 'processing', updated_at = ${now}
          WHERE call_brief_id = ${row.callId}
            AND status IN ('starting', 'recording')
        `;
        await transaction`
          UPDATE durable_jobs
          SET run_after = LEAST(run_after, ${now}), updated_at = ${now}
          WHERE job_type = 'provider_call_reconciliation'
            AND call_attempt_id = ${row.attemptId}
            AND status = 'queued'
        `;
      }
      await this.#audit(transaction, row.callId, "call.provider_status", {
        providerCallId,
        providerStatus
      });
      if (row.currentStatus !== callStatus && applyCallStatus) {
        await this.#audit(transaction, row.callId, "call.status_changed", {
          status: callStatus
        });
      }
      return row.callId;
    });

    if (!callId) return null;
    return { callId, snapshot: await this.#require(callId) };
  }

  async updateStatus(id: string, status: CallBrief["status"]) {
    const now = new Date();
    await this.#sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE call_briefs
        SET status = ${status}, updated_at = ${now}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.count === 0) throw new CallRepositoryError("CALL_NOT_FOUND");
      await this.#syncAttempt(transaction, id, status, now);
      const settlement = await this.#settleLatestAttempt(
        transaction,
        id,
        creditSettlementForStatus(status)
      );
      const attemptId = settlement?.attemptId ?? await this.#latestAttemptId(
        transaction,
        id
      );
      if (attemptId && status === "in_progress") {
        await this.#appendConnectionTelemetry(
          transaction,
          id,
          attemptId,
          "in-progress",
          now.toISOString()
        );
      }
      if (settlement) {
        await this.#appendSettlementTelemetry(
          transaction,
          id,
          settlement.attemptId,
          settlement.settlement,
          now.toISOString()
        );
      }
      if (attemptId && terminalStatuses.has(status)) {
        await transaction`
          UPDATE durable_jobs
          SET run_after = LEAST(run_after, ${now}), updated_at = ${now}
          WHERE job_type = 'provider_call_reconciliation'
            AND call_attempt_id = ${attemptId}
            AND status = 'queued'
        `;
      }
      await this.#audit(transaction, id, "call.status_changed", { status });
    });
    return this.#require(id);
  }

  async addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string,
    locale: CallLocale
  ) {
    const segment: TranscriptSegment = {
      id: randomUUID(),
      role,
      text,
      locale,
      final: true,
      createdAt: new Date().toISOString()
    };

    await this.#sql.begin(async (transaction) => {
      const call = await transaction`
        SELECT id FROM call_briefs WHERE id = ${id} FOR UPDATE
      `;
      if (call.count === 0) throw new CallRepositoryError("CALL_NOT_FOUND");
      await transaction`
        INSERT INTO transcript_segments (
          id, call_brief_id, role, text, locale, final, created_at
        ) VALUES (
          ${segment.id}, ${id}, ${role}, ${text}, ${locale}, true,
          ${new Date(segment.createdAt)}
        )
      `;
      await this.#audit(transaction, id, "transcript.finalized", {
        role,
        locale,
        segmentId: segment.id
      });
    });

    return { segment, snapshot: await this.#require(id) };
  }

  async requestApproval(id: string, draft: ApprovalRequestDraft) {
    const approval: ApprovalRequest = {
      ...draft,
      id: randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString()
    };
    const now = new Date();

    await this.#sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE call_briefs
        SET status = 'awaiting_approval', updated_at = ${now}
        WHERE id = ${id}
        RETURNING id
      `;
      if (updated.count === 0) throw new CallRepositoryError("CALL_NOT_FOUND");
      await transaction`
        INSERT INTO approval_requests (
          id,
          call_brief_id,
          category,
          title,
          reason,
          proposed_speech,
          status,
          created_at
        ) VALUES (
          ${approval.id},
          ${id},
          ${approval.category},
          ${approval.title},
          ${approval.reason},
          ${approval.proposedSpeech},
          'pending',
          ${new Date(approval.createdAt)}
        )
      `;
      await this.#syncAttempt(transaction, id, "awaiting_approval", now);
      await this.#audit(transaction, id, "approval.requested", {
        approvalId: approval.id,
        category: approval.category
      });
      await this.#audit(transaction, id, "call.status_changed", {
        status: "awaiting_approval"
      });
    });

    return { approval, snapshot: await this.#require(id) };
  }

  async resolveApproval(
    id: string,
    approvalId: string,
    decision: ApprovalDecision["decision"]
  ) {
    const now = new Date();
    const approval = await this.#sql.begin(async (transaction) => {
      const rows = await transaction<ApprovalRow[]>`
        UPDATE approval_requests
        SET status = ${decision}, decided_at = ${now}
        WHERE id = ${approvalId}
          AND call_brief_id = ${id}
          AND status = 'pending'
        RETURNING
          id,
          category,
          title,
          reason,
          proposed_speech AS "proposedSpeech",
          status,
          created_at AS "createdAt"
      `;
      const row = rows[0];
      if (!row) throw new CallRepositoryError("APPROVAL_NOT_FOUND");

      await transaction`
        UPDATE call_briefs
        SET status = 'in_progress', updated_at = ${now}
        WHERE id = ${id}
      `;
      await this.#syncAttempt(transaction, id, "in_progress", now);
      await this.#audit(transaction, id, "approval.resolved", {
        approvalId,
        decision
      });
      await this.#audit(transaction, id, "call.status_changed", {
        status: "in_progress"
      });
      return this.#mapApproval(row);
    });

    return { approval, snapshot: await this.#require(id) };
  }

  async stop(id: string) {
    const now = new Date();
    await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ status: CallBrief["status"] }[]>`
        SELECT status FROM call_briefs WHERE id = ${id} FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new CallRepositoryError("CALL_NOT_FOUND");
      if (terminalStatuses.has(current.status)) return;

      await transaction`
        UPDATE approval_requests
        SET status = 'expired', decided_at = ${now}
        WHERE call_brief_id = ${id} AND status = 'pending'
      `;
      await transaction`
        UPDATE call_briefs
        SET status = 'stopped', updated_at = ${now}
        WHERE id = ${id}
      `;
      await this.#syncAttempt(transaction, id, "stopped", now);
      const settlement = await this.#settleLatestAttempt(
        transaction,
        id,
        "call_refund"
      );
      const attemptId = settlement?.attemptId ?? await this.#latestAttemptId(
        transaction,
        id
      );
      if (settlement) {
        await this.#appendSettlementTelemetry(
          transaction,
          id,
          settlement.attemptId,
          settlement.settlement,
          now.toISOString()
        );
      }
      await transaction`
        UPDATE call_recordings
        SET status = 'processing', updated_at = ${now}
        WHERE call_brief_id = ${id}
          AND status IN ('starting', 'recording')
      `;
      if (attemptId) {
        await transaction`
          UPDATE durable_jobs
          SET run_after = LEAST(run_after, ${now}), updated_at = ${now}
          WHERE job_type = 'provider_call_reconciliation'
            AND call_attempt_id = ${attemptId}
            AND status = 'queued'
        `;
      }
      await this.#audit(transaction, id, "call.status_changed", {
        status: "stopped"
      });
    });
    return this.#require(id);
  }

  async beginRecording(id: string) {
    const recordingId = randomUUID();
    const now = new Date();
    const providerCallId = await this.#sql.begin(async (transaction) => {
      const [attempt] = await transaction<
        {
          attemptId: string;
          provider: CallAttemptRecord["provider"];
          providerCallId: string | null;
          attemptStatus: CallBrief["status"];
        }[]
      >`
        SELECT
          id AS "attemptId",
          provider,
          provider_call_id AS "providerCallId",
          status AS "attemptStatus"
        FROM call_attempts
        WHERE call_brief_id = ${id}
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `;
      if (
        !attempt?.providerCallId ||
        attempt.provider !== "twilio" ||
        terminalStatuses.has(attempt.attemptStatus)
      ) {
        throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
      }

      const existing = await transaction`
        SELECT id FROM call_recordings WHERE call_brief_id = ${id}
      `;
      if (existing.count > 0) {
        throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
      }

      await transaction`
        INSERT INTO call_recordings (
          id,
          call_brief_id,
          call_attempt_id,
          provider,
          provider_call_id,
          status,
          consent_granted_at,
          created_at,
          updated_at
        ) VALUES (
          ${recordingId},
          ${id},
          ${attempt.attemptId},
          'twilio',
          ${attempt.providerCallId},
          'starting',
          ${now},
          ${now},
          ${now}
        )
      `;
      await this.#audit(transaction, id, "recording.consent_granted", {
        recordingId
      });
      await this.#appendTelemetry(transaction, id, {
        callAttemptId: attempt.attemptId,
        idempotencyKey: `attempt:${attempt.attemptId}:consent:granted`,
        occurredAt: now.toISOString(),
        payload: {
          name: "consent.granted",
          metadata: { method: "dtmf_1" }
        }
      });
      return attempt.providerCallId;
    });

    const snapshot = await this.#require(id);
    if (!snapshot.recording) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    return { providerCallId, recording: snapshot.recording, snapshot };
  }

  async attachProviderRecording(
    recordingId: string,
    providerRecordingId: string,
    providerStatus: string,
    reconciliationRunAfter?: string
  ) {
    const now = new Date();
    const [row] = await this.#sql.begin(async (transaction) => {
      const rows = await transaction<
        {
          callId: string;
          callAttemptId: string;
          status: CallRecording["status"];
        }[]
      >`
        UPDATE call_recordings
        SET
          provider_recording_id = COALESCE(
            provider_recording_id,
            ${providerRecordingId}
          ),
          status = CASE
            WHEN status = 'starting' THEN 'recording'
            ELSE status
          END,
          started_at = COALESCE(started_at, ${now}),
          failure_reason = CASE
            WHEN status = 'failed' THEN failure_reason
            ELSE NULL
          END,
          updated_at = ${now}
        WHERE id = ${recordingId}
          AND status IN ('starting', 'recording', 'processing', 'available')
          AND (
            provider_recording_id IS NULL
            OR provider_recording_id = ${providerRecordingId}
          )
        RETURNING
          call_brief_id AS "callId",
          call_attempt_id AS "callAttemptId",
          status
      `;
      const updated = rows[0];
      if (updated) {
        await this.#audit(transaction, updated.callId, "recording.started", {
          providerRecordingId,
          providerStatus,
          recordingId
        });
        await this.#appendTelemetry(transaction, updated.callId, {
          callAttemptId: updated.callAttemptId,
          idempotencyKey: `recording:${recordingId}:started`,
          occurredAt: now.toISOString(),
          payload: {
            name: "recording.started",
            metadata: {
              providerStatus: safeTelemetryCode(
                providerStatus,
                "unknown_provider_status"
              )
            }
          }
        });
        if (
          reconciliationRunAfter &&
          ["recording", "processing"].includes(updated.status)
        ) {
          await transaction`
            INSERT INTO durable_jobs (
              id, job_type, recording_id, status, max_attempts,
              run_after, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, 'provider_recording_reconciliation',
              ${recordingId}, 'queued',
              ${durableJobMaxAttempts.provider_recording_reconciliation},
              ${reconciliationRunAfter}::timestamptz, ${now}, ${now}
            )
            ON CONFLICT (job_type, recording_id) DO UPDATE SET
              run_after = LEAST(durable_jobs.run_after, EXCLUDED.run_after),
              updated_at = EXCLUDED.updated_at
            WHERE durable_jobs.status = 'queued'
          `;
        }
      }
      return rows;
    });
    if (!row) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    return this.#recordingMutation(row.callId);
  }

  async failRecording(recordingId: string, failureReason: string) {
    const now = new Date();
    const [row] = await this.#sql.begin(async (transaction) => {
      const rows = await transaction<
        { callId: string; callAttemptId: string }[]
      >`
        UPDATE call_recordings
        SET
          status = 'failed',
          failure_reason = ${failureReason},
          updated_at = ${now}
        WHERE id = ${recordingId} AND status IN ('starting', 'recording')
        RETURNING
          call_brief_id AS "callId",
          call_attempt_id AS "callAttemptId"
      `;
      const updated = rows[0];
      if (updated) {
        await this.#audit(transaction, updated.callId, "recording.failed", {
          failureReason,
          recordingId
        });
        const failureCode = safeTelemetryCode(
          failureReason,
          "recording_failed"
        );
        await this.#appendTelemetry(transaction, updated.callId, {
          callAttemptId: updated.callAttemptId,
          idempotencyKey: `recording:${recordingId}:failed:${failureCode}`,
          occurredAt: now.toISOString(),
          payload: {
            name: "recording.failed",
            metadata: { failureCode }
          }
        });
      }
      return rows;
    });
    if (!row) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    return this.#recordingMutation(row.callId);
  }

  async applyRecordingStatus(
    input: RecordingStatusInput,
    lease?: DurableJobLease
  ) {
    const now = new Date();
    const callId = await this.#sql.begin(async (transaction) => {
      if (lease) {
        await requirePostgresDurableJobLease(transaction, lease);
      }
      const [row] = await transaction<
        {
          callId: string;
          callAttemptId: string;
          providerRecordingId: string | null;
          recordingStatus: CallRecording["status"];
          durationSeconds: number | null;
          channels: number | null;
        }[]
      >`
        SELECT
          call_recordings.call_brief_id AS "callId",
          call_recordings.call_attempt_id AS "callAttemptId",
          call_recordings.provider_recording_id AS "providerRecordingId",
          call_recordings.status AS "recordingStatus",
          call_recordings.duration_seconds AS "durationSeconds",
          call_recordings.channels
        FROM call_recordings
        JOIN call_attempts
          ON call_attempts.id = call_recordings.call_attempt_id
        WHERE call_recordings.id = ${input.recordingId}
          AND call_recordings.call_brief_id = ${input.callBriefId}
          AND call_attempts.provider_call_id = ${input.providerCallId}
        FOR UPDATE OF call_recordings
      `;
      if (!row) return null;
      if (
        row.providerRecordingId &&
        row.providerRecordingId !== input.providerRecordingId
      ) {
        return null;
      }

      let status = row.recordingStatus;
      if (status !== "deleted" && input.providerStatus === "completed") {
        status = "available";
      } else if (
        status !== "deleted" &&
        status !== "available" &&
        input.providerStatus === "absent"
      ) {
        status = "failed";
      } else if (
        status !== "deleted" &&
        status !== "available" &&
        status !== "processing" &&
        input.providerStatus === "in-progress"
      ) {
        status = "recording";
      }
      const startedAt = input.startedAt ? new Date(input.startedAt) : now;
      await transaction`
        UPDATE call_recordings
        SET
          provider_recording_id = COALESCE(
            provider_recording_id,
            ${input.providerRecordingId}
          ),
          status = ${status},
          started_at = CASE
            WHEN ${input.providerStatus === "in-progress"}
              THEN COALESCE(started_at, ${startedAt})
            ELSE started_at
          END,
          completed_at = CASE
            WHEN ${input.providerStatus === "completed"}
              THEN COALESCE(completed_at, ${now})
            ELSE completed_at
          END,
          duration_seconds = COALESCE(
            ${input.durationSeconds ?? null},
            duration_seconds
          ),
          channels = COALESCE(${input.channels ?? null}, channels),
          failure_reason = CASE
            WHEN ${input.providerStatus === "absent" && status === "failed"}
              THEN ${input.failureReason ?? "recording_absent"}
            ELSE failure_reason
          END,
          updated_at = ${now}
        WHERE id = ${input.recordingId}
      `;
      await this.#audit(transaction, row.callId, "recording.provider_status", {
        providerRecordingId: input.providerRecordingId,
        providerStatus: input.providerStatus,
        recordingId: input.recordingId
      });
      if (status === "recording" && input.providerStatus === "in-progress") {
        await this.#appendTelemetry(transaction, row.callId, {
          callAttemptId: row.callAttemptId,
          idempotencyKey: `recording:${input.recordingId}:started`,
          occurredAt: startedAt.toISOString(),
          payload: {
            name: "recording.started",
            metadata: { providerStatus: "in-progress" }
          }
        });
      } else if (status === "available" && input.providerStatus === "completed") {
        await this.#appendTelemetry(transaction, row.callId, {
          callAttemptId: row.callAttemptId,
          idempotencyKey: `recording:${input.recordingId}:completed`,
          occurredAt: now.toISOString(),
          payload: {
            name: "recording.completed",
            metadata: {
              durationSeconds: input.durationSeconds ?? row.durationSeconds,
              channels: input.channels ?? row.channels
            }
          }
        });
        await transaction`
          INSERT INTO durable_jobs (
            id,
            job_type,
            recording_id,
            status,
            max_attempts,
            run_after
          ) VALUES (
            ${randomUUID()},
            'final_transcription',
            ${input.recordingId},
            'queued',
            ${durableJobMaxAttempts.final_transcription},
            ${now}
          )
          ON CONFLICT (job_type, recording_id) DO NOTHING
        `;
      } else if (status === "failed" && input.providerStatus === "absent") {
        const failureCode = safeTelemetryCode(
          input.failureReason,
          "recording_absent"
        );
        await this.#appendTelemetry(transaction, row.callId, {
          callAttemptId: row.callAttemptId,
          idempotencyKey: `recording:${input.recordingId}:failed:${failureCode}`,
          occurredAt: now.toISOString(),
          payload: {
            name: "recording.failed",
            metadata: { failureCode }
          }
        });
      }
      if (["completed", "absent"].includes(input.providerStatus)) {
        await transaction`
          UPDATE durable_jobs
          SET run_after = LEAST(run_after, ${now}), updated_at = ${now}
          WHERE job_type = 'provider_recording_reconciliation'
            AND recording_id = ${input.recordingId}
            AND status = 'queued'
        `;
      }
      return row.callId;
    });
    return callId ? this.#recordingMutation(callId) : null;
  }

  async claimFinalTranscript(
    recordingId: string,
    model: string,
    force = false,
    lease?: DurableJobLease
  ) {
    const now = new Date();
    const callId = await this.#sql.begin(async (transaction) => {
      if (lease) {
        await requirePostgresDurableJobLease(transaction, lease);
      }
      const [recording] = await transaction<
        {
          callId: string;
          callAttemptId: string;
          recordingStatus: CallRecording["status"];
        }[]
      >`
        SELECT
          call_recordings.call_brief_id AS "callId",
          call_recordings.call_attempt_id AS "callAttemptId",
          call_recordings.status AS "recordingStatus"
        FROM call_recordings
        WHERE call_recordings.id = ${recordingId}
        FOR UPDATE
      `;
      if (!recording) throw new CallRepositoryError("RECORDING_NOT_FOUND");
      const [transcript] = await transaction<
        {
          transcriptId: string;
          transcriptStatus: FinalTranscript["status"];
        }[]
      >`
        SELECT
          id AS "transcriptId",
          status AS "transcriptStatus"
        FROM final_transcripts
        WHERE call_recording_id = ${recordingId}
        FOR UPDATE
      `;
      if (
        recording.recordingStatus !== "available" ||
        (transcript?.transcriptStatus === "processing" && !lease) ||
        (transcript?.transcriptStatus === "completed" && !force)
      ) {
        return null;
      }
      const transcriptId = transcript?.transcriptId ?? randomUUID();

      if (transcript) {
        await transaction`
          UPDATE final_transcripts
          SET
            status = 'processing',
            model = ${model},
            text_ciphertext = NULL,
            segments_ciphertext = NULL,
            failure_reason = NULL,
            updated_at = ${now},
            completed_at = NULL
          WHERE id = ${transcript.transcriptId}
        `;
      } else {
        await transaction`
          INSERT INTO final_transcripts (
            id,
            call_recording_id,
            status,
            model,
            created_at,
            updated_at
          ) VALUES (
            ${transcriptId},
            ${recordingId},
            'processing',
            ${model},
            ${now},
            ${now}
          )
        `;
      }
      await this.#audit(transaction, recording.callId, "final_transcript.started", {
        model,
        recordingId
      });
      await this.#appendTelemetry(transaction, recording.callId, {
        callAttemptId: recording.callAttemptId,
        idempotencyKey: `transcription:${transcriptId}:started:${now.toISOString()}`,
        occurredAt: now.toISOString(),
        payload: {
          name: "transcription.started",
          metadata: {
            model: safeTelemetryCode(model, "unknown_model"),
            retry: Boolean(transcript)
          }
        }
      });
      return recording.callId;
    });
    return callId ? this.#finalTranscriptMutation(callId) : null;
  }

  async completeFinalTranscript(
    recordingId: string,
    text: string,
    segments: FinalTranscriptSegment[],
    lease?: DurableJobLease
  ) {
    const now = new Date();
    const ciphertext = encryptJson(text, this.#encryptionKey);
    const segmentsCiphertext = encryptJson(segments, this.#encryptionKey);
    const callId = await this.#sql.begin(async (transaction) => {
      if (lease) {
        await requirePostgresDurableJobLease(transaction, lease);
      }
      const [row] = await transaction<
        {
          callId: string;
          callAttemptId: string;
          retentionDays: number;
          transcriptId: string;
          model: string;
        }[]
      >`
        SELECT
          call_recordings.call_brief_id AS "callId",
          call_recordings.call_attempt_id AS "callAttemptId",
          call_briefs.audio_retention_days AS "retentionDays",
          final_transcripts.id AS "transcriptId",
          final_transcripts.model
        FROM call_recordings
        JOIN call_briefs ON call_briefs.id = call_recordings.call_brief_id
        JOIN final_transcripts
          ON final_transcripts.call_recording_id = call_recordings.id
        WHERE call_recordings.id = ${recordingId}
          AND final_transcripts.status = 'processing'
        FOR UPDATE OF call_recordings, final_transcripts
      `;
      if (!row) throw new CallRepositoryError("RECORDING_NOT_FOUND");
      await transaction`
        UPDATE final_transcripts
        SET
          status = 'completed',
          text_ciphertext = ${ciphertext},
          segments_ciphertext = ${segmentsCiphertext},
          failure_reason = NULL,
          updated_at = ${now},
          completed_at = ${now}
        WHERE call_recording_id = ${recordingId}
      `;
      await transaction`
        UPDATE call_recordings
        SET
          delete_after = ${new Date(
            now.getTime() + row.retentionDays * 86_400_000
          )},
          updated_at = ${now}
        WHERE id = ${recordingId}
      `;
      await transaction`
        INSERT INTO durable_jobs (
          id,
          job_type,
          recording_id,
          status,
          max_attempts,
          run_after
        ) VALUES (
          ${randomUUID()},
          'recording_retention',
          ${recordingId},
          'queued',
          ${durableJobMaxAttempts.recording_retention},
          ${new Date(now.getTime() + row.retentionDays * 86_400_000)}
        )
        ON CONFLICT (job_type, recording_id) DO NOTHING
      `;
      await this.#audit(transaction, row.callId, "final_transcript.completed", {
        recordingId
      });
      await this.#appendTelemetry(transaction, row.callId, {
        callAttemptId: row.callAttemptId,
        idempotencyKey: `transcription:${row.transcriptId}:completed:${now.toISOString()}`,
        occurredAt: now.toISOString(),
        payload: {
          name: "transcription.completed",
          metadata: {
            model: safeTelemetryCode(row.model, "unknown_model"),
            segmentCount: segments.length
          }
        }
      });
      return row.callId;
    });
    return this.#finalTranscriptMutation(callId);
  }

  async failFinalTranscript(
    recordingId: string,
    failureReason: string,
    lease?: DurableJobLease
  ) {
    const now = new Date();
    const row = await this.#sql.begin(async (transaction) => {
      if (lease) {
        await requirePostgresDurableJobLease(transaction, lease);
      }
      const [transcript] = await transaction<
        {
          callId: string;
          callAttemptId: string;
          transcriptId: string;
          model: string;
        }[]
      >`
        SELECT
          call_recordings.call_brief_id AS "callId",
          call_recordings.call_attempt_id AS "callAttemptId",
          final_transcripts.id AS "transcriptId",
          final_transcripts.model
        FROM final_transcripts
        JOIN call_recordings
          ON call_recordings.id = final_transcripts.call_recording_id
        WHERE call_recordings.id = ${recordingId}
        FOR UPDATE OF final_transcripts
      `;
      if (!transcript) return null;
      await transaction`
        UPDATE final_transcripts
        SET
          status = 'failed',
          text_ciphertext = NULL,
          segments_ciphertext = NULL,
          failure_reason = ${failureReason},
          updated_at = ${now},
          completed_at = NULL
        WHERE id = ${transcript.transcriptId}
      `;
      await this.#audit(transaction, transcript.callId, "final_transcript.failed", {
        failureReason,
        recordingId
      });
      const failureCode = safeTelemetryCode(
        failureReason,
        "transcription_failed"
      );
      await this.#appendTelemetry(transaction, transcript.callId, {
        callAttemptId: transcript.callAttemptId,
        idempotencyKey: `transcription:${transcript.transcriptId}:failed:${now.toISOString()}`,
        occurredAt: now.toISOString(),
        payload: {
          name: "transcription.failed",
          metadata: {
            model: safeTelemetryCode(transcript.model, "unknown_model"),
            failureCode
          }
        }
      });
      return transcript;
    });
    if (!row) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    return this.#finalTranscriptMutation(row.callId);
  }

  async markRecordingDeleted(id: string, lease?: DurableJobLease) {
    const now = new Date();
    await this.#sql.begin(async (transaction) => {
      if (lease) {
        await requirePostgresDurableJobLease(transaction, lease);
      }
      const updated = await transaction`
        UPDATE call_recordings
        SET status = 'deleted', deleted_at = ${now}, updated_at = ${now}
        WHERE call_brief_id = ${id} AND status <> 'deleted'
        RETURNING id
      `;
      if (updated.count === 0) {
        const existing = await transaction`
          SELECT id FROM call_recordings WHERE call_brief_id = ${id}
        `;
        if (existing.count === 0) {
          throw new CallRepositoryError("RECORDING_NOT_FOUND");
        }
        return;
      }
      await this.#audit(transaction, id, "recording.deleted", {});
    });
    return this.#recordingMutation(id);
  }

  async enqueueDurableJob(input: EnqueueDurableJobInput) {
    const now = new Date();
    const jobId = await this.#sql.begin(async (transaction) => {
      const callTarget = input.type === "provider_call_reconciliation";
      if (
        (callTarget && (!input.callAttemptId || input.recordingId)) ||
        (!callTarget && (!input.recordingId || input.callAttemptId))
      ) {
        throw new CallRepositoryError("DURABLE_JOB_TARGET_INVALID");
      }
      if (callTarget) {
        const attempts = await transaction`
          SELECT id FROM call_attempts
          WHERE id = ${input.callAttemptId!}
          FOR UPDATE
        `;
        if (attempts.count === 0) {
          throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
        }
      } else {
        const recordings = await transaction`
          SELECT id FROM call_recordings
          WHERE id = ${input.recordingId!}
          FOR UPDATE
        `;
        if (recordings.count === 0) {
          throw new CallRepositoryError("RECORDING_NOT_FOUND");
        }
      }
      const [existing] = await transaction<{
        id: string;
        status: DurableJob["status"];
      }[]>`
        SELECT id, status
        FROM durable_jobs
        WHERE job_type = ${input.type}
          AND (
            (${callTarget} AND call_attempt_id = ${input.callAttemptId ?? null})
            OR
            (${!callTarget} AND recording_id = ${input.recordingId ?? null})
          )
        FOR UPDATE
      `;
      if (!existing) {
        const id = randomUUID();
        await transaction`
          INSERT INTO durable_jobs (
            id,
            job_type,
            recording_id,
            call_attempt_id,
            status,
            max_attempts,
            run_after,
            force_requested,
            created_at,
            updated_at
          ) VALUES (
            ${id},
            ${input.type},
            ${input.recordingId ?? null},
            ${input.callAttemptId ?? null},
            'queued',
            ${input.maxAttempts},
            ${input.runAfter}::timestamptz,
            ${input.force ?? false},
            ${now},
            ${now}
          )
        `;
        return id;
      }
      if (
        input.restartTerminal &&
        ["succeeded", "dead_letter"].includes(existing.status)
      ) {
        await transaction`
          UPDATE durable_jobs
          SET
            status = 'queued',
            generation = generation + 1,
            attempt_count = 0,
            max_attempts = ${input.maxAttempts},
            run_after = ${input.runAfter}::timestamptz,
            force_requested = ${input.force ?? false},
            lease_owner = NULL,
            leased_at = NULL,
            lease_expires_at = NULL,
            last_error_code = NULL,
            updated_at = ${now},
            completed_at = NULL
          WHERE id = ${existing.id}
        `;
      } else if (existing.status === "queued") {
        await transaction`
          UPDATE durable_jobs
          SET
            run_after = LEAST(run_after, ${input.runAfter}::timestamptz),
            force_requested = force_requested OR ${input.force ?? false},
            updated_at = ${now}
          WHERE id = ${existing.id}
        `;
      }
      return existing.id;
    });
    return this.#getDurableJob(jobId);
  }

  async seedDurableJobs(now: string) {
    const [callReconciliations, recordingReconciliations,
      transcriptions, retention] = await this.#sql.begin(
      async (transaction) => {
        const callReconciliationRows = await transaction`
          INSERT INTO durable_jobs (
            id, job_type, call_attempt_id, status, max_attempts, run_after
          )
          SELECT
            gen_random_uuid(),
            'provider_call_reconciliation',
            call_attempts.id,
            'queued',
            ${durableJobMaxAttempts.provider_call_reconciliation},
            ${now}::timestamptz
          FROM call_attempts
          JOIN call_briefs ON call_briefs.id = call_attempts.call_brief_id
          WHERE call_attempts.provider = 'twilio'
            AND call_attempts.provider_call_id IS NOT NULL
            AND call_briefs.status IN (
              'dialing', 'in_progress', 'awaiting_approval'
            )
          ON CONFLICT (job_type, call_attempt_id)
            WHERE call_attempt_id IS NOT NULL
          DO NOTHING
          RETURNING id
        `;
        const recordingReconciliationRows = await transaction`
          INSERT INTO durable_jobs (
            id, job_type, recording_id, status, max_attempts, run_after
          )
          SELECT
            gen_random_uuid(),
            'provider_recording_reconciliation',
            call_recordings.id,
            'queued',
            ${durableJobMaxAttempts.provider_recording_reconciliation},
            ${now}::timestamptz
          FROM call_recordings
          WHERE call_recordings.provider_recording_id IS NOT NULL
            AND call_recordings.status IN ('recording', 'processing')
          ON CONFLICT (job_type, recording_id) DO UPDATE SET
            run_after = LEAST(durable_jobs.run_after, EXCLUDED.run_after),
            updated_at = now()
          WHERE durable_jobs.status = 'queued'
          RETURNING id
        `;
        const transcriptionRows = await transaction`
          INSERT INTO durable_jobs (
            id,
            job_type,
            recording_id,
            status,
            max_attempts,
            run_after
          )
          SELECT
            gen_random_uuid(),
            'final_transcription',
            call_recordings.id,
            'queued',
            ${durableJobMaxAttempts.final_transcription},
            ${now}::timestamptz
          FROM call_recordings
          LEFT JOIN final_transcripts
            ON final_transcripts.call_recording_id = call_recordings.id
          WHERE call_recordings.status = 'available'
            AND (
              final_transcripts.id IS NULL
              OR final_transcripts.status IN ('processing', 'failed')
            )
          ON CONFLICT (job_type, recording_id) DO NOTHING
          RETURNING id
        `;
        const retentionRows = await transaction`
          INSERT INTO durable_jobs (
            id,
            job_type,
            recording_id,
            status,
            max_attempts,
            run_after
          )
          SELECT
            gen_random_uuid(),
            'recording_retention',
            call_recordings.id,
            'queued',
            ${durableJobMaxAttempts.recording_retention},
            call_recordings.delete_after
          FROM call_recordings
          INNER JOIN final_transcripts
            ON final_transcripts.call_recording_id = call_recordings.id
            AND final_transcripts.status = 'completed'
          WHERE call_recordings.status = 'available'
            AND call_recordings.delete_after IS NOT NULL
          ON CONFLICT (job_type, recording_id) DO NOTHING
          RETURNING id
        `;
        return [
          callReconciliationRows,
          recordingReconciliationRows,
          transcriptionRows,
          retentionRows
        ] as const;
      }
    );
    return callReconciliations.count + recordingReconciliations.count +
      transcriptions.count + retention.count;
  }

  async claimDueDurableJob(input: ClaimDurableJobInput) {
    const claimed = await this.#sql.begin(async (transaction) => {
      const expired = await transaction<{
        id: string;
        generation: number;
        attemptCount: number;
        maxAttempts: number;
        leaseOwner: string;
        leasedAt: DatabaseDate;
      }[]>`
        SELECT
          id,
          generation,
          attempt_count AS "attemptCount",
          max_attempts AS "maxAttempts",
          lease_owner AS "leaseOwner",
          leased_at AS "leasedAt"
        FROM durable_jobs
        WHERE status = 'running'
          AND lease_expires_at <= ${input.now}::timestamptz
          AND job_type = ANY(${input.types}::text[])
        FOR UPDATE SKIP LOCKED
      `;
      for (const job of expired) {
        const deadLetter = job.attemptCount >= job.maxAttempts;
        await transaction`
          INSERT INTO durable_job_attempts (
            id,
            job_id,
            generation,
            attempt_number,
            worker_id,
            started_at,
            completed_at,
            outcome,
            error_code
          ) VALUES (
            ${randomUUID()},
            ${job.id},
            ${job.generation},
            ${job.attemptCount},
            ${job.leaseOwner},
            ${job.leasedAt},
            ${input.now}::timestamptz,
            ${deadLetter ? "dead_letter" : "lease_expired"},
            'worker_lease_expired'
          )
          ON CONFLICT (job_id, generation, attempt_number) DO NOTHING
        `;
        await transaction`
          UPDATE durable_jobs
          SET
            status = ${deadLetter ? "dead_letter" : "queued"},
            run_after = ${input.now}::timestamptz,
            lease_owner = NULL,
            leased_at = NULL,
            lease_expires_at = NULL,
            last_error_code = 'worker_lease_expired',
            updated_at = ${input.now}::timestamptz,
            completed_at = ${deadLetter ? input.now : null}::timestamptz
          WHERE id = ${job.id}
        `;
      }

      const [candidate] = await transaction<{
        id: string;
        forceRequested: boolean;
      }[]>`
        SELECT id, force_requested AS "forceRequested"
        FROM durable_jobs
        WHERE status = 'queued'
          AND run_after <= ${input.now}::timestamptz
          AND job_type = ANY(${input.types}::text[])
        ORDER BY run_after ASC, created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (!candidate) return null;
      await transaction`
        UPDATE durable_jobs
        SET
          status = 'running',
          attempt_count = attempt_count + 1,
          force_requested = false,
          lease_owner = ${input.workerId},
          leased_at = ${input.now}::timestamptz,
          lease_expires_at = ${input.leaseExpiresAt}::timestamptz,
          updated_at = ${input.now}::timestamptz
        WHERE id = ${candidate.id}
      `;
      return candidate;
    });
    if (!claimed) return null;
    const job = await this.#getDurableJob(claimed.id);
    return { ...job, forceRequested: claimed.forceRequested };
  }

  async renewDurableJobLease(
    jobId: string,
    workerId: string,
    now: string,
    leaseExpiresAt: string
  ) {
    const rows = await this.#sql`
      UPDATE durable_jobs
      SET
        lease_expires_at = ${leaseExpiresAt}::timestamptz,
        updated_at = ${now}::timestamptz
      WHERE id = ${jobId}
        AND status = 'running'
        AND lease_owner = ${workerId}
        AND lease_expires_at > ${now}::timestamptz
      RETURNING id
    `;
    return rows.count === 1;
  }

  async completeDurableJob(jobId: string, workerId: string, now: string) {
    return this.#sql.begin(async (transaction) => {
      const [job] = await transaction<{
        generation: number;
        attemptCount: number;
        leasedAt: DatabaseDate;
      }[]>`
        SELECT
          generation,
          attempt_count AS "attemptCount",
          leased_at AS "leasedAt"
        FROM durable_jobs
        WHERE id = ${jobId}
          AND status = 'running'
          AND lease_owner = ${workerId}
          AND lease_expires_at > ${now}::timestamptz
        FOR UPDATE
      `;
      if (!job) return false;
      await transaction`
        INSERT INTO durable_job_attempts (
          id, job_id, generation, attempt_number, worker_id,
          started_at, completed_at, outcome, error_code
        ) VALUES (
          ${randomUUID()}, ${jobId}, ${job.generation}, ${job.attemptCount},
          ${workerId}, ${job.leasedAt}, ${now}::timestamptz,
          'succeeded', NULL
        )
      `;
      await transaction`
        UPDATE durable_jobs
        SET
          status = 'succeeded',
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL,
          last_error_code = NULL,
          updated_at = ${now}::timestamptz,
          completed_at = ${now}::timestamptz
        WHERE id = ${jobId}
      `;
      return true;
    });
  }

  async failDurableJob(
    jobId: string,
    workerId: string,
    errorCode: string,
    now: string,
    retryAt: string
  ) {
    const found = await this.#sql.begin(async (transaction) => {
      const [job] = await transaction<{
        generation: number;
        attemptCount: number;
        maxAttempts: number;
        leasedAt: DatabaseDate;
      }[]>`
        SELECT
          generation,
          attempt_count AS "attemptCount",
          max_attempts AS "maxAttempts",
          leased_at AS "leasedAt"
        FROM durable_jobs
        WHERE id = ${jobId}
          AND status = 'running'
          AND lease_owner = ${workerId}
          AND lease_expires_at > ${now}::timestamptz
        FOR UPDATE
      `;
      if (!job) return false;
      const deadLetter = job.attemptCount >= job.maxAttempts;
      await transaction`
        INSERT INTO durable_job_attempts (
          id, job_id, generation, attempt_number, worker_id,
          started_at, completed_at, outcome, error_code
        ) VALUES (
          ${randomUUID()}, ${jobId}, ${job.generation}, ${job.attemptCount},
          ${workerId}, ${job.leasedAt}, ${now}::timestamptz,
          ${deadLetter ? "dead_letter" : "retry_scheduled"}, ${errorCode}
        )
      `;
      await transaction`
        UPDATE durable_jobs
        SET
          status = ${deadLetter ? "dead_letter" : "queued"},
          run_after = ${deadLetter ? now : retryAt}::timestamptz,
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL,
          last_error_code = ${errorCode},
          updated_at = ${now}::timestamptz,
          completed_at = ${deadLetter ? now : null}::timestamptz
        WHERE id = ${jobId}
      `;
      return true;
    });
    return found ? this.#getDurableJob(jobId) : null;
  }

  async listDurableJobs() {
    const rows = await this.#sql<DurableJobRow[]>`
      ${this.#durableJobSelect()}
      ORDER BY durable_jobs.created_at ASC, durable_jobs.id ASC
    `;
    return rows.map(mapDurableJobRow);
  }

  async listDurableJobAttempts(jobId: string) {
    const rows = await this.#sql<DurableJobAttemptRow[]>`
      SELECT
        id,
        job_id AS "jobId",
        generation,
        attempt_number AS "attemptNumber",
        worker_id AS "workerId",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        outcome,
        error_code AS "errorCode"
      FROM durable_job_attempts
      WHERE job_id = ${jobId}
      ORDER BY generation ASC, attempt_number ASC
    `;
    return rows.map((row) => ({
      ...row,
      startedAt: toIso(row.startedAt),
      completedAt: toIso(row.completedAt)
    }));
  }

  async retryDurableJob(
    jobId: string,
    actorUserId: string,
    reason: string,
    now: string
  ) {
    const boundedReason = requireAdminJobReason(reason);
    const found = await this.#sql.begin(async (transaction) => {
      const [job] = await transaction<{
        type: DurableJob["type"];
        status: DurableJob["status"];
      }[]>`
        SELECT job_type AS "type", status
        FROM durable_jobs
        WHERE id = ${jobId}
        FOR UPDATE
      `;
      if (!job) throw new CallRepositoryError("DURABLE_JOB_NOT_FOUND");
      if (job.status !== "dead_letter") {
        throw new CallRepositoryError("DURABLE_JOB_NOT_RETRYABLE");
      }
      await transaction`
        UPDATE durable_jobs
        SET
          status = 'queued',
          generation = generation + 1,
          attempt_count = 0,
          run_after = ${now}::timestamptz,
          force_requested = ${job.type === "final_transcription"},
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL,
          last_error_code = NULL,
          updated_at = ${now}::timestamptz,
          completed_at = NULL
        WHERE id = ${jobId}
      `;
      await transaction`
        INSERT INTO durable_job_admin_events (
          id,
          job_id,
          actor_user_id,
          action,
          reason,
          created_at
        ) VALUES (
          ${randomUUID()},
          ${jobId},
          ${actorUserId},
          'retry',
          ${boundedReason},
          ${now}::timestamptz
        )
      `;
      return true;
    });
    if (!found) throw new CallRepositoryError("DURABLE_JOB_NOT_FOUND");
    return this.#getDurableJob(jobId);
  }

  async recoverInterruptedCalls() {
    const now = new Date();
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<{
        id: string;
        attemptId: string | null;
        provider: CallAttemptRecord["provider"] | null;
        providerCallId: string | null;
      }[]>`
        SELECT
          call_briefs.id,
          latest_attempt.id AS "attemptId",
          latest_attempt.provider,
          latest_attempt.provider_call_id AS "providerCallId"
        FROM call_briefs
        LEFT JOIN LATERAL (
          SELECT id, provider, provider_call_id
          FROM call_attempts
          WHERE call_attempts.call_brief_id = call_briefs.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS latest_attempt ON true
        WHERE call_briefs.status IN (
          'dialing', 'in_progress', 'awaiting_approval'
        )
        FOR UPDATE OF call_briefs
      `;

      for (const { id, attemptId, provider, providerCallId } of rows) {
        await transaction`
          UPDATE approval_requests
          SET status = 'expired', decided_at = ${now}
          WHERE call_brief_id = ${id} AND status = 'pending'
        `;
        const reconcileProvider =
          provider === "twilio" && attemptId && providerCallId;
        let settlement: {
          attemptId: string;
          settlement: "call_charge" | "call_refund";
        } | null | undefined = null;
        if (reconcileProvider) {
          await transaction`
            INSERT INTO durable_jobs (
              id, job_type, call_attempt_id, status, max_attempts,
              run_after, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, 'provider_call_reconciliation', ${attemptId},
              'queued', ${durableJobMaxAttempts.provider_call_reconciliation},
              ${now}, ${now}, ${now}
            )
            ON CONFLICT (job_type, call_attempt_id)
              WHERE call_attempt_id IS NOT NULL
            DO UPDATE SET
              run_after = LEAST(durable_jobs.run_after, EXCLUDED.run_after),
              updated_at = EXCLUDED.updated_at
            WHERE durable_jobs.status = 'queued'
          `;
        } else {
          await transaction`
            UPDATE call_briefs
            SET status = 'failed', updated_at = ${now}
            WHERE id = ${id}
          `;
          await transaction`
            UPDATE call_attempts
            SET
              status = 'failed',
              ended_at = ${now},
              failure_reason = 'server_restarted'
            WHERE id = ${attemptId}
          `;
          settlement = await this.#settleLatestAttempt(
            transaction,
            id,
            "call_refund"
          );
        }
        await this.#audit(transaction, id, "call.recovered_after_restart", {
          status: reconcileProvider ? "reconciliation_scheduled" : "failed"
        });
        if (!reconcileProvider) {
          await this.#appendTelemetry(transaction, id, {
            callAttemptId: attemptId,
            idempotencyKey: "call:recovered:server-restarted",
            occurredAt: now.toISOString(),
            payload: {
              name: "call.recovered",
              metadata: { reason: "server_restarted" }
            }
          });
        }
        if (settlement) {
          await this.#appendSettlementTelemetry(
            transaction,
            id,
            settlement.attemptId,
            settlement.settlement,
            now.toISOString()
          );
        }
      }

      return rows.length;
    });
  }

  async ping() {
    await this.#sql`SELECT 1`;
  }

  async close() {
    await this.#sql.end({ timeout: 5 });
  }

  #briefSelect() {
    return this.#sql`
      SELECT
        id,
        recipient_name AS "recipientName",
        phone_number AS "phoneNumber",
        objective,
        assistant_profile_id AS "assistantProfileId",
        agent_name AS "agentName",
        represented_person AS "representedPerson",
        represented_person_first_name AS "representedPersonFirstName",
        represented_person_last_name AS "representedPersonLastName",
        assistance_reason_ciphertext AS "assistanceReasonCiphertext",
        assistance_disclosure AS "assistanceDisclosure",
        assistance_disclosure_ciphertext AS "assistanceDisclosureCiphertext",
        compilation_ciphertext AS "compilationCiphertext",
        context_ciphertext AS "contextCiphertext",
        locale,
        voice_gender AS "voiceGender",
        audio_retention_days AS "audioRetentionDays",
        allow_language_switch AS "allowLanguageSwitch",
        fallback_locale AS "fallbackLocale",
        allowed_facts_ciphertext AS "allowedFactsCiphertext",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM call_briefs
    `;
  }

  #mapBrief(row: CallBriefRow): CallBrief {
    const assistanceReason = row.assistanceReasonCiphertext
      ? decryptJson<AssistanceReason>(
          row.assistanceReasonCiphertext,
          this.#encryptionKey
        )
      : "speech_impairment";

    return {
      id: row.id,
      recipientName: row.recipientName,
      phoneNumber: row.phoneNumber,
      objective: row.objective,
      assistantProfileId: row.assistantProfileId,
      agentName: row.agentName,
      representedPerson: row.representedPerson,
      assistanceReason,
      assistanceDisclosure: row.assistanceDisclosureCiphertext
        ? decryptJson<string>(
            row.assistanceDisclosureCiphertext,
            this.#encryptionKey
          )
        : row.assistanceDisclosure ??
          getAssistanceDisclosure(
            row.locale,
            assistanceReason,
            row.representedPerson
          ),
      context: row.contextCiphertext
        ? decryptJson<string>(row.contextCiphertext, this.#encryptionKey)
        : "",
      locale: row.locale,
      voiceGender: row.voiceGender,
      audioRetentionDays: row.audioRetentionDays,
      allowLanguageSwitch: row.allowLanguageSwitch,
      ...(row.fallbackLocale ? { fallbackLocale: row.fallbackLocale } : {}),
      allowedFacts: decryptJson<string[]>(
        row.allowedFactsCiphertext,
        this.#encryptionKey
      ),
      status: row.status,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt)
    };
  }

  #mapTranscript(row: TranscriptRow): TranscriptSegment {
    return {
      ...row,
      createdAt: toIso(row.createdAt)
    };
  }

  #mapApproval(row: ApprovalRow): ApprovalRequest {
    return {
      ...row,
      createdAt: toIso(row.createdAt)
    };
  }

  #mapAttempt(row: CallAttemptRow): CallAttemptRecord {
    return {
      ...row,
      startedAt: toIso(row.startedAt),
      endedAt: row.endedAt ? toIso(row.endedAt) : null
    };
  }

  #recordingSelect() {
    return this.#sql`
      SELECT
        id,
        status,
        provider_recording_id AS "providerRecordingId",
        consent_granted_at AS "consentGrantedAt",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        duration_seconds AS "durationSeconds",
        channels,
        delete_after AS "deleteAfter",
        deleted_at AS "deletedAt",
        failure_reason AS "failureReason"
      FROM call_recordings
    `;
  }

  #mapRecording(row: CallRecordingRow): CallRecording {
    return {
      ...row,
      consentGrantedAt: toIso(row.consentGrantedAt),
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      completedAt: row.completedAt ? toIso(row.completedAt) : null,
      deleteAfter: row.deleteAfter ? toIso(row.deleteAfter) : null,
      deletedAt: row.deletedAt ? toIso(row.deletedAt) : null
    };
  }

  #mapFinalTranscript(row: FinalTranscriptRow): FinalTranscript {
    return {
      id: row.id,
      status: row.status,
      text: row.textCiphertext
        ? decryptJson<string>(row.textCiphertext, this.#encryptionKey)
        : null,
      segments: row.segmentsCiphertext
        ? decryptJson<FinalTranscriptSegment[]>(
            row.segmentsCiphertext,
            this.#encryptionKey
          )
        : [],
      model: row.model,
      failureReason: row.failureReason,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      completedAt: row.completedAt ? toIso(row.completedAt) : null
    };
  }

  async #require(id: string) {
    const snapshot = await this.get(id);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    return snapshot;
  }

  #durableJobSelect() {
    return this.#sql`
      SELECT
        durable_jobs.id,
        durable_jobs.job_type AS "type",
        durable_jobs.recording_id AS "recordingId",
        durable_jobs.call_attempt_id AS "callAttemptId",
        COALESCE(
          call_recordings.call_brief_id,
          reconciliation_attempt.call_brief_id
        ) AS "callId",
        durable_jobs.status,
        durable_jobs.generation,
        durable_jobs.attempt_count AS "attemptCount",
        durable_jobs.max_attempts AS "maxAttempts",
        durable_jobs.run_after AS "runAfter",
        durable_jobs.force_requested AS "forceRequested",
        durable_jobs.lease_owner AS "leaseOwner",
        durable_jobs.leased_at AS "leasedAt",
        durable_jobs.lease_expires_at AS "leaseExpiresAt",
        durable_jobs.last_error_code AS "lastErrorCode",
        durable_jobs.created_at AS "createdAt",
        durable_jobs.updated_at AS "updatedAt",
        durable_jobs.completed_at AS "completedAt"
      FROM durable_jobs
      LEFT JOIN call_recordings
        ON call_recordings.id = durable_jobs.recording_id
      LEFT JOIN call_attempts AS reconciliation_attempt
        ON reconciliation_attempt.id = durable_jobs.call_attempt_id
    `;
  }

  async #selectAdminCallRows(
    input: Partial<ListAdminCallsInput>,
    callBriefId?: string,
    limit = 200
  ) {
    const status = input.status ?? null;
    const outcome = input.outcome ?? null;
    const locale = input.locale ?? null;
    const dateFrom = input.dateFrom ?? null;
    const dateTo = input.dateTo ?? null;
    const cursorCreatedAt = input.cursor?.createdAt ?? null;
    const cursorId = input.cursor?.id ?? null;
    return this.#sql<AdminCallReadRow[]>`
      SELECT
        call_briefs.id,
        call_briefs.user_id AS "ownerUserId",
        call_briefs.status,
        call_briefs.locale,
        call_briefs.created_at AS "createdAt",
        call_briefs.updated_at AS "updatedAt",
        latest_outcome.outcome AS "semanticOutcome",
        latest_outcome.provenance AS "outcomeProvenance",
        latest_feedback.revision AS "feedbackRevision",
        latest_feedback.goal_result AS "goalResult",
        latest_feedback.transcript_quality AS "transcriptQuality",
        latest_feedback.created_at AS "feedbackCreatedAt",
        call_recordings.duration_seconds AS "durationSeconds",
        COALESCE(event_counts.event_count, 0)::int AS "eventCount"
      FROM call_briefs
      LEFT JOIN LATERAL (
        SELECT outcome, provenance
        FROM call_outcome_revisions
        WHERE call_brief_id = call_briefs.id
          AND outcome IS NOT NULL
        ORDER BY revision DESC
        LIMIT 1
      ) AS latest_outcome ON true
      LEFT JOIN LATERAL (
        SELECT revision, goal_result, transcript_quality, created_at
        FROM call_feedback_revisions
        WHERE call_brief_id = call_briefs.id
        ORDER BY revision DESC
        LIMIT 1
      ) AS latest_feedback ON true
      LEFT JOIN call_recordings
        ON call_recordings.call_brief_id = call_briefs.id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS event_count
        FROM call_events
        WHERE call_brief_id = call_briefs.id
      ) AS event_counts ON true
      WHERE (${callBriefId ?? null}::uuid IS NULL OR call_briefs.id = ${callBriefId ?? null})
        AND (${status}::text IS NULL OR call_briefs.status = ${status})
        AND (${outcome}::text IS NULL OR latest_outcome.outcome = ${outcome})
        AND (${locale}::text IS NULL OR call_briefs.locale = ${locale})
        AND (${dateFrom}::timestamptz IS NULL OR call_briefs.created_at >= ${dateFrom})
        AND (${dateTo}::timestamptz IS NULL OR call_briefs.created_at <= ${dateTo})
        AND (
          ${cursorCreatedAt}::timestamptz IS NULL
          OR call_briefs.created_at < ${cursorCreatedAt}
          OR (
            call_briefs.created_at = ${cursorCreatedAt}
            AND call_briefs.id < ${cursorId}::uuid
          )
      )
      ORDER BY call_briefs.created_at DESC, call_briefs.id DESC
      LIMIT ${limit}
    `;
  }

  async #selectTelemetryForCallIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.#sql<CallTelemetryEventRow[]>`
      SELECT
        id,
        call_brief_id AS "callBriefId",
        call_attempt_id AS "callAttemptId",
        user_id AS "userId",
        sequence,
        schema_version AS "schemaVersion",
        event_name AS "eventName",
        source,
        stage,
        severity,
        metadata,
        occurred_at AS "occurredAt"
      FROM call_events
      WHERE call_brief_id IN ${this.#sql(ids)}
      ORDER BY call_brief_id ASC, sequence ASC
    `;
    return rows.map(mapCallTelemetryEvent);
  }

  async #buildOutcomeView(id: string): Promise<CallOutcomeView> {
    const snapshot = await this.#require(id);
    const [events, outcomeRows, feedbackRows] = await Promise.all([
      this.listCallTelemetryEvents(id),
      this.#sql<CallOutcomeRevisionRow[]>`
        SELECT
          id,
          call_brief_id AS "callBriefId",
          revision,
          schema_version AS "schemaVersion",
          outcome,
          provenance,
          actor_user_id AS "actorUserId",
          reason,
          technical,
          created_at AS "createdAt"
        FROM call_outcome_revisions
        WHERE call_brief_id = ${id} AND outcome IS NOT NULL
        ORDER BY revision DESC
        LIMIT 1
      `,
      this.#sql<CallFeedbackRevisionRow[]>`
        SELECT
          id,
          call_brief_id AS "callBriefId",
          user_id AS "userId",
          revision,
          schema_version AS "schemaVersion",
          goal_result AS "goalResult",
          transcript_quality AS "transcriptQuality",
          comment_ciphertext AS "commentCiphertext",
          payload_fingerprint AS "payloadFingerprint",
          payload_fingerprint_key_id AS "payloadFingerprintKeyId",
          idempotency_key::text AS "idempotencyKey",
          created_at AS "createdAt"
        FROM call_feedback_revisions
        WHERE call_brief_id = ${id}
        ORDER BY revision DESC
        LIMIT 1
      `
    ]);
    return callOutcomeViewSchema.parse({
      technical: deriveTechnicalCallOutcome(snapshot.brief.status, events),
      latestOutcome: outcomeRows[0]
        ? mapCallOutcomeRevision(outcomeRows[0])
        : null,
      latestFeedback: feedbackRows[0]
        ? mapCallFeedbackRevision(feedbackRows[0], this.#encryptionKey)
        : null
    });
  }

  async #deriveTechnicalOutcome(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    status: CallBrief["status"]
  ) {
    const rows = await transaction<CallTelemetryEventRow[]>`
      SELECT
        id,
        call_brief_id AS "callBriefId",
        call_attempt_id AS "callAttemptId",
        user_id AS "userId",
        sequence,
        schema_version AS "schemaVersion",
        event_name AS "eventName",
        source,
        stage,
        severity,
        metadata,
        occurred_at AS "occurredAt"
      FROM call_events
      WHERE call_brief_id = ${callBriefId}
      ORDER BY sequence ASC
    `;
    return deriveTechnicalCallOutcome(
      status,
      rows.map(mapCallTelemetryEvent)
    );
  }

  async #lockCallOutcome(
    transaction: postgres.TransactionSql,
    callBriefId: string
  ) {
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`call-outcome:${callBriefId}`}, 0)
      )
    `;
  }

  async #appendOutcomeRevision(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    input: {
      outcome: SemanticCallOutcome | null;
      provenance: CallOutcomeProvenance;
      actorUserId: string | null;
      reason: CallOutcomeRevision["reason"];
      technical: TechnicalCallOutcome;
      idempotencyKey: string;
      createdAt: Date;
    }
  ) {
    const existing = await transaction`
      SELECT id
      FROM call_outcome_revisions
      WHERE call_brief_id = ${callBriefId}
        AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1
    `;
    if (existing.count > 0) return;
    const [{ nextRevision }] = await transaction<
      { nextRevision: number }[]
    >`
      SELECT COALESCE(MAX(revision), 0)::int + 1 AS "nextRevision"
      FROM call_outcome_revisions
      WHERE call_brief_id = ${callBriefId}
    `;
    await transaction`
      INSERT INTO call_outcome_revisions (
        id,
        call_brief_id,
        revision,
        schema_version,
        outcome,
        provenance,
        actor_user_id,
        reason,
        technical,
        idempotency_key,
        created_at
      ) VALUES (
        ${randomUUID()},
        ${callBriefId},
        ${nextRevision},
        ${CALL_OUTCOME_SCHEMA_VERSION},
        ${input.outcome},
        ${input.provenance},
        ${input.actorUserId},
        ${input.reason},
        ${transaction.json(input.technical)},
        ${input.idempotencyKey},
        ${input.createdAt}
      )
    `;
  }

  async #recordingMutation(callId: string) {
    const snapshot = await this.#require(callId);
    if (!snapshot.recording) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    return { callId, recording: snapshot.recording, snapshot };
  }

  async #finalTranscriptMutation(callId: string) {
    const snapshot = await this.#require(callId);
    if (!snapshot.finalTranscript) {
      throw new CallRepositoryError("RECORDING_NOT_FOUND");
    }
    return {
      callId,
      finalTranscript: snapshot.finalTranscript,
      snapshot
    };
  }

  async #syncAttempt(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    status: CallBrief["status"],
    now: Date
  ) {
    const endedAt = terminalStatuses.has(status) ? now : null;
    await transaction`
      UPDATE call_attempts
      SET status = ${status}, ended_at = COALESCE(${endedAt}, ended_at)
      WHERE id = (
        SELECT id FROM call_attempts
        WHERE call_brief_id = ${callBriefId}
        ORDER BY created_at DESC
        LIMIT 1
      )
    `;
  }

  async #getDurableJob(jobId: string) {
    const rows = await this.#sql<DurableJobRow[]>`
      ${this.#durableJobSelect()}
      WHERE durable_jobs.id = ${jobId}
    `;
    if (!rows[0]) throw new CallRepositoryError("DURABLE_JOB_NOT_FOUND");
    return mapDurableJobRow(rows[0]);
  }

  async #settleLatestAttempt(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    type: "call_charge" | "call_refund" | null
  ) {
    if (!type) return;
    const [attempt] = await transaction<{ id: string }[]>`
      SELECT id
      FROM call_attempts
      WHERE call_brief_id = ${callBriefId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!attempt) return null;
    const settlement = await this.#settleAttempt(transaction, attempt.id, type);
    return settlement ? { attemptId: attempt.id, settlement } : null;
  }

  async #latestAttemptId(
    transaction: postgres.TransactionSql,
    callBriefId: string
  ) {
    const [attempt] = await transaction<{ id: string }[]>`
      SELECT id
      FROM call_attempts
      WHERE call_brief_id = ${callBriefId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return attempt?.id ?? null;
  }

  async #settleAttempt(
    transaction: postgres.TransactionSql,
    attemptId: string,
    type: "call_charge" | "call_refund" | null
  ) {
    if (!type) return null;
    const [attempt] = await transaction<{ userId: string | null }[]>`
      SELECT user_id AS "userId"
      FROM call_attempts
      WHERE id = ${attemptId}
    `;
    if (!attempt?.userId) return null;
    await this.#lockCreditAccount(transaction, attempt.userId);
    const settled = await transaction<{ type: "call_charge" | "call_refund" }[]>`
      INSERT INTO credit_transactions (
        id, user_id, amount, type, call_attempt_id, reason,
        idempotency_key, created_at
      )
      SELECT
        ${randomUUID()},
        ${attempt.userId},
        ${type === "call_refund" ? 1 : 0},
        ${type},
        ${attemptId},
        ${type === "call_refund"
          ? "Call ended before successful connection"
          : "Provider connection confirmed"},
        ${`call:${attemptId}:${type === "call_refund" ? "refund" : "charge"}`},
        ${new Date()}
      WHERE NOT EXISTS (
        SELECT 1
        FROM credit_transactions
        WHERE call_attempt_id = ${attemptId}
          AND type IN ('call_charge', 'call_refund')
      )
        AND EXISTS (
          SELECT 1
          FROM credit_transactions
          WHERE call_attempt_id = ${attemptId}
            AND type = 'call_reservation'
        )
      ON CONFLICT DO NOTHING
      RETURNING type
    `;
    return settled[0]?.type ?? null;
  }

  async #lockCreditAccount(
    transaction: postgres.TransactionSql,
    userId: string
  ) {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
    `;
  }

  async #lockOperation(
    transaction: postgres.TransactionSql,
    identifier: string
  ) {
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`operation:${identifier}`}, 0)
      )
    `;
  }

  async #lockActiveUser(
    transaction: postgres.TransactionSql,
    userId: string
  ) {
    const user = await transaction`
      SELECT id
      FROM users
      WHERE id = ${userId}
        AND status = 'active'
        AND phone_verified_at IS NOT NULL
      FOR SHARE
    `;
    if (user.count === 0) throw new CallRepositoryError("CALL_NOT_FOUND");
  }

  async #lockRecipient(
    transaction: postgres.TransactionSql,
    phoneE164: string
  ) {
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`recipient:${phoneE164}`}, 0)
      )
    `;
  }

  async #safetyEvent(
    transaction: postgres.TransactionSql,
    input: {
      eventType:
        | "recipient.suppressed"
        | "recipient.suppression_lifted"
        | "outbound_calls.enabled"
        | "outbound_calls.disabled";
      actorUserId: string | null;
      phoneE164: string | null;
      reason: string;
      metadata?: Record<string, string>;
    }
  ) {
    await transaction`
      INSERT INTO safety_events (
        id, event_type, actor_user_id, phone_e164, reason, metadata, created_at
      ) VALUES (
        ${randomUUID()},
        ${input.eventType},
        ${input.actorUserId},
        ${input.phoneE164},
        ${input.reason},
        ${transaction.json(input.metadata ?? {})},
        ${new Date()}
      )
    `;
  }

  async #appendConnectionTelemetry(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    callAttemptId: string,
    providerStatus: string,
    occurredAt = new Date().toISOString()
  ) {
    if (providerStatus !== "in-progress" && providerStatus !== "completed") {
      return;
    }
    await this.#appendTelemetry(transaction, callBriefId, {
      callAttemptId,
      idempotencyKey: `attempt:${callAttemptId}:connection`,
      occurredAt,
      payload: {
        name: "connection.confirmed",
        metadata: { providerStatus }
      }
    });
  }

  async #appendSettlementTelemetry(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    callAttemptId: string,
    settlement: "call_charge" | "call_refund",
    occurredAt = new Date().toISOString()
  ) {
    const normalized = settlement === "call_charge" ? "charge" : "refund";
    await this.#appendTelemetry(transaction, callBriefId, {
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

  async #appendCompilationTelemetry(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    compilation: CallCompilation,
    occurredAt: string
  ) {
    await this.#appendTelemetry(transaction, callBriefId, {
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
    await this.#appendTelemetry(transaction, callBriefId, {
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

  async #appendTelemetry(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    input: CallTelemetryEventInput
  ): Promise<DurableCallEvent> {
    const parsed = callTelemetryEventInputSchema.parse(input);
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`call-event:${callBriefId}`}, 0)
      )
    `;
    const existingRows = await transaction<CallTelemetryEventRow[]>`
      SELECT
        id,
        call_brief_id AS "callBriefId",
        call_attempt_id AS "callAttemptId",
        user_id AS "userId",
        sequence,
        schema_version AS "schemaVersion",
        event_name AS "eventName",
        source,
        stage,
        severity,
        metadata,
        occurred_at AS "occurredAt"
      FROM call_events
      WHERE call_brief_id = ${callBriefId}
        AND idempotency_key = ${parsed.idempotencyKey}
      LIMIT 1
    `;
    if (existingRows[0]) return mapCallTelemetryEvent(existingRows[0]);

    const [call] = await transaction<{ userId: string | null }[]>`
      SELECT user_id AS "userId"
      FROM call_briefs
      WHERE id = ${callBriefId}
    `;
    if (!call) throw new CallRepositoryError("CALL_NOT_FOUND");
    if (parsed.callAttemptId) {
      const attempt = await transaction`
        SELECT id
        FROM call_attempts
        WHERE id = ${parsed.callAttemptId}
          AND call_brief_id = ${callBriefId}
      `;
      if (attempt.count === 0) {
        throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
      }
    }
    const [{ nextSequence }] = await transaction<{ nextSequence: number }[]>`
      SELECT COALESCE(MAX(sequence), 0)::int + 1 AS "nextSequence"
      FROM call_events
      WHERE call_brief_id = ${callBriefId}
    `;
    const descriptor = describeCallTelemetryEvent(parsed.payload.name);
    const rows = await transaction<CallTelemetryEventRow[]>`
      INSERT INTO call_events (
        id,
        call_brief_id,
        call_attempt_id,
        user_id,
        sequence,
        schema_version,
        event_name,
        source,
        stage,
        severity,
        metadata,
        idempotency_key,
        occurred_at,
        created_at
      ) VALUES (
        ${randomUUID()},
        ${callBriefId},
        ${parsed.callAttemptId},
        ${call.userId},
        ${nextSequence},
        ${CALL_TELEMETRY_SCHEMA_VERSION},
        ${parsed.payload.name},
        ${descriptor.source},
        ${descriptor.stage},
        ${descriptor.severity},
        ${transaction.json(parsed.payload.metadata)},
        ${parsed.idempotencyKey},
        ${new Date(parsed.occurredAt ?? Date.now())},
        ${new Date()}
      )
      RETURNING
        id,
        call_brief_id AS "callBriefId",
        call_attempt_id AS "callAttemptId",
        user_id AS "userId",
        sequence,
        schema_version AS "schemaVersion",
        event_name AS "eventName",
        source,
        stage,
        severity,
        metadata,
        occurred_at AS "occurredAt"
    `;
    return mapCallTelemetryEvent(rows[0]!);
  }

  async #audit(
    transaction: postgres.TransactionSql,
    callBriefId: string,
    eventType: string,
    metadata: Record<string, string>
  ) {
    await transaction`
      INSERT INTO audit_events (
        id, call_brief_id, event_type, metadata, created_at
      ) VALUES (
        ${randomUUID()},
        ${callBriefId},
        ${eventType},
        ${transaction.json(metadata)},
        ${new Date()}
      )
    `;
  }
}

async function requirePostgresDurableJobLease(
  transaction: postgres.TransactionSql,
  lease: DurableJobLease
) {
  const rows = await transaction`
    SELECT id
    FROM durable_jobs
    WHERE id = ${lease.jobId}
      AND status = 'running'
      AND lease_owner = ${lease.workerId}
      AND lease_expires_at > ${lease.checkedAt}::timestamptz
    FOR UPDATE
  `;
  if (rows.count !== 1) {
    throw new CallRepositoryError("DURABLE_JOB_LEASE_LOST");
  }
}

function mapDurableJobRow(row: DurableJobRow): DurableJob {
  return {
    ...row,
    runAfter: toIso(row.runAfter),
    leasedAt: row.leasedAt ? toIso(row.leasedAt) : null,
    leaseExpiresAt: row.leaseExpiresAt ? toIso(row.leaseExpiresAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null
  };
}

function aggregateProviderWebhookFacts(
  rows: ProviderWebhookBucketRow[]
): Record<ProviderWebhookKind, AdminWebhookDeliveryFacts> {
  const facts = emptyAdminWebhookFacts();
  for (const row of rows) {
    const kind = facts[row.kind];
    kind[row.outcome] += row.deliveryCount;
    const receivedAt = toIso(row.lastReceivedAt);
    if (row.outcome === "accepted") {
      if (!kind.lastAcceptedAt || receivedAt > kind.lastAcceptedAt) {
        kind.lastAcceptedAt = receivedAt;
      }
    } else if (!kind.lastProblemAt || receivedAt >= kind.lastProblemAt) {
      kind.lastProblemAt = receivedAt;
      kind.lastProblemCode = row.lastErrorCode;
    }
  }
  return facts;
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

function parseCallChangeSignal(payload: string): CallChangeSignal | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { sourceId, callId } = parsed as Record<string, unknown>;
    return typeof sourceId === "string" && isUuid(sourceId) &&
      typeof callId === "string" && isUuid(callId)
      ? { sourceId, callId }
      : null;
  } catch {
    return null;
  }
}

function mapCallTelemetryEvent(row: CallTelemetryEventRow): DurableCallEvent {
  return durableCallEventSchema.parse({
    id: row.id,
    callBriefId: row.callBriefId,
    callAttemptId: row.callAttemptId,
    userId: row.userId,
    sequence: row.sequence,
    schemaVersion: row.schemaVersion,
    source: row.source,
    stage: row.stage,
    severity: row.severity,
    occurredAt: toIso(row.occurredAt),
    payload: {
      name: row.eventName,
      metadata: typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata
    }
  });
}

function callOutcomeRevisionSelect(sql: postgres.TransactionSql) {
  return sql`
    SELECT
      id,
      call_brief_id AS "callBriefId",
      revision,
      schema_version AS "schemaVersion",
      outcome,
      provenance,
      actor_user_id AS "actorUserId",
      reason,
      technical,
      created_at AS "createdAt"
    FROM call_outcome_revisions
  `;
}

function callFeedbackRevisionSelect(sql: postgres.TransactionSql) {
  return sql`
    SELECT
      id,
      call_brief_id AS "callBriefId",
      user_id AS "userId",
      revision,
      schema_version AS "schemaVersion",
      goal_result AS "goalResult",
      transcript_quality AS "transcriptQuality",
      comment_ciphertext AS "commentCiphertext",
      payload_fingerprint AS "payloadFingerprint",
      payload_fingerprint_key_id AS "payloadFingerprintKeyId",
      idempotency_key::text AS "idempotencyKey",
      created_at AS "createdAt"
    FROM call_feedback_revisions
  `;
}

function mapCallOutcomeRevision(
  row: CallOutcomeRevisionRow
): CallOutcomeRevision {
  return callOutcomeRevisionSchema.parse({
    id: row.id,
    callBriefId: row.callBriefId,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    outcome: row.outcome,
    provenance: row.provenance,
    actorUserId: row.actorUserId,
    reason: row.reason,
    technical: typeof row.technical === "string"
      ? JSON.parse(row.technical)
      : row.technical,
    createdAt: toIso(row.createdAt)
  });
}

function mapCallFeedbackRevision(
  row: CallFeedbackRevisionRow,
  encryptionKey: DataEncryptionMaterial
): CallFeedbackRevision {
  return callFeedbackRevisionSchema.parse({
    id: row.id,
    callBriefId: row.callBriefId,
    userId: row.userId,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    goalResult: row.goalResult,
    transcriptQuality: row.transcriptQuality,
    comment: row.commentCiphertext
      ? decryptJson<string>(row.commentCiphertext, encryptionKey)
      : null,
    createdAt: toIso(row.createdAt)
  });
}

function groupTelemetryByCall(events: DurableCallEvent[]) {
  const grouped = new Map<string, DurableCallEvent[]>();
  for (const event of events) {
    const stored = grouped.get(event.callBriefId) ?? [];
    stored.push(event);
    grouped.set(event.callBriefId, stored);
  }
  return grouped;
}

function mapAdminCallSummary(
  row: AdminCallReadRow,
  events: DurableCallEvent[]
): AdminCallSummary {
  return adminCallSummarySchema.parse({
    id: row.id,
    ownerUserId: row.ownerUserId,
    status: row.status,
    locale: row.locale,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    technical: deriveTechnicalCallOutcome(row.status, events),
    semanticOutcome: row.semanticOutcome,
    outcomeProvenance: row.outcomeProvenance,
    feedback: row.feedbackRevision && row.goalResult && row.feedbackCreatedAt
      ? {
          revision: row.feedbackRevision,
          goalResult: row.goalResult,
          transcriptQuality: row.transcriptQuality,
          createdAt: toIso(row.feedbackCreatedAt)
        }
      : null,
    durationSeconds: row.durationSeconds,
    eventCount: row.eventCount
  });
}

function sameTechnicalOutcome(
  left: TechnicalCallOutcome,
  right: TechnicalCallOutcome
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function systemOutcomeIdempotencyKey(technical: TechnicalCallOutcome) {
  return `system:${createHash("sha256")
    .update(JSON.stringify(technical))
    .digest("hex")}`;
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

function setSemanticOutcomeCount(
  metrics: CallOutcomeMetrics,
  outcome: SemanticCallOutcome,
  count: number
) {
  switch (outcome) {
    case "resolved":
      metrics.semanticOutcomes.resolved = count;
      break;
    case "partially_resolved":
      metrics.semanticOutcomes.partiallyResolved = count;
      break;
    case "unresolved":
      metrics.semanticOutcomes.unresolved = count;
      break;
    case "wrong_recipient":
      metrics.semanticOutcomes.wrongRecipient = count;
      break;
    case "voicemail":
      metrics.semanticOutcomes.voicemail = count;
      break;
    case "declined":
      metrics.semanticOutcomes.declined = count;
      break;
    case "technical_failure":
      metrics.semanticOutcomes.technicalFailure = count;
      break;
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

function mapPromoCode(row: PromoCodeRow): PromoCodeSummary {
  return {
    id: row.id,
    credits: row.credits,
    globalRedemptionLimit: row.globalRedemptionLimit,
    perUserLimit: row.perUserLimit,
    startsAt: row.startsAt ? toIso(row.startsAt) : null,
    expiresAt: row.expiresAt ? toIso(row.expiresAt) : null,
    active: row.active,
    campaign: row.campaign,
    createdAt: toIso(row.createdAt)
  };
}

function samePromoRow(
  row: PromoCodeRow,
  input: CreatePromoCodeRepositoryInput
) {
  return (
    row.codeHash === input.codeHash &&
    row.credits === input.credits &&
    row.globalRedemptionLimit === input.globalRedemptionLimit &&
    row.perUserLimit === input.perUserLimit &&
    nullableIso(row.startsAt) === input.startsAt &&
    nullableIso(row.expiresAt) === input.expiresAt &&
    row.active === input.active &&
    row.campaign === input.campaign &&
    row.actorUserId === input.actorUserId &&
    row.reason === input.reason
  );
}

function nullableIso(value: DatabaseDate | null) {
  return value === null ? null : toIso(value);
}
