import { randomUUID } from "node:crypto";
import {
  getAssistanceDisclosure,
  normalizeCreateCallBriefInput,
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
  type AssistantProfileId,
  type AssistanceReason,
  type FinalTranscript,
  type FinalTranscriptSegment,
  type TranscriptSegment
} from "@callassist/contracts";
import postgres from "postgres";
import { decryptJson, encryptJson } from "../security/encryption";
import {
  CallRepositoryError,
  buildRuntimeBriefFields,
  creditSettlementForStatus,
  encodeCallBriefCursor,
  shouldApplyProviderCallStatus,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallRepository,
  type ListCallBriefsInput,
  type RecordingStatusInput,
  type StartAttemptInput
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

type CreditTransactionRow = Omit<CreditTransaction, "createdAt"> & {
  createdAt: DatabaseDate;
};

const terminalStatuses = new Set<CallBrief["status"]>([
  "blocked",
  "completed",
  "stopped",
  "failed"
]);

function toIso(value: DatabaseDate) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresCallRepository implements CallRepository {
  readonly mode = "postgres" as const;
  readonly #sql: postgres.Sql;
  readonly #encryptionKey: Buffer;

  constructor(databaseUrl: string, encryptionKey: Buffer) {
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
        const [call] = await transaction<{ status: CallBrief["status"] }[]>`
          SELECT status
          FROM call_briefs
          WHERE id = ${id} AND user_id = ${userId}
          FOR UPDATE
        `;
        if (!call) throw new CallRepositoryError("CALL_NOT_FOUND");
        if (call.status !== "ready") {
          throw new CallRepositoryError("CALL_NOT_READY");
        }
        const [active] = await transaction<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1
            FROM call_attempts
            WHERE user_id = ${userId} AND ended_at IS NULL
          ) AS exists
        `;
        if (active?.exists) {
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
    providerStatus: string
  ) {
    const row = await this.#sql.begin(async (transaction) => {
      const [updated] = await transaction<{ callId: string }[]>`
        UPDATE call_attempts
        SET
          provider_call_id = ${providerCallId},
          provider_status = CASE
            WHEN provider_call_id IS NULL THEN ${providerStatus}
            ELSE provider_status
          END
        WHERE id = ${attemptId}
          AND (provider_call_id IS NULL OR provider_call_id = ${providerCallId})
        RETURNING call_brief_id AS "callId"
      `;
      if (!updated) return null;
      await this.#settleAttempt(
        transaction,
        attemptId,
        creditSettlementForStatus("dialing", providerStatus)
      );
      return updated;
    });
    if (!row) throw new CallRepositoryError("CALL_ATTEMPT_NOT_FOUND");
    return this.#require(row.callId);
  }

  async applyProviderStatus(
    providerCallId: string,
    providerStatus: string,
    callStatus: CallBrief["status"],
    callBriefId?: string
  ) {
    const now = new Date();
    const callId = await this.#sql.begin(async (transaction) => {
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
      await this.#settleAttempt(
        transaction,
        row.attemptId,
        creditSettlementForStatus(callStatus, providerStatus)
      );

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
      await this.#settleLatestAttempt(
        transaction,
        id,
        creditSettlementForStatus(status)
      );
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
      await this.#settleLatestAttempt(transaction, id, "call_refund");
      await transaction`
        UPDATE call_recordings
        SET status = 'processing', updated_at = ${now}
        WHERE call_brief_id = ${id}
          AND status IN ('starting', 'recording')
      `;
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
    providerStatus: string
  ) {
    const now = new Date();
    const [row] = await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ callId: string }[]>`
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
        RETURNING call_brief_id AS "callId"
      `;
      const updated = rows[0];
      if (updated) {
        await this.#audit(transaction, updated.callId, "recording.started", {
          providerRecordingId,
          providerStatus,
          recordingId
        });
      }
      return rows;
    });
    if (!row) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    return this.#recordingMutation(row.callId);
  }

  async failRecording(recordingId: string, failureReason: string) {
    const now = new Date();
    const [row] = await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ callId: string }[]>`
        UPDATE call_recordings
        SET
          status = 'failed',
          failure_reason = ${failureReason},
          updated_at = ${now}
        WHERE id = ${recordingId} AND status IN ('starting', 'recording')
        RETURNING call_brief_id AS "callId"
      `;
      const updated = rows[0];
      if (updated) {
        await this.#audit(transaction, updated.callId, "recording.failed", {
          failureReason,
          recordingId
        });
      }
      return rows;
    });
    if (!row) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    return this.#recordingMutation(row.callId);
  }

  async applyRecordingStatus(input: RecordingStatusInput) {
    const now = new Date();
    const callId = await this.#sql.begin(async (transaction) => {
      const [row] = await transaction<
        {
          callId: string;
          providerRecordingId: string | null;
          recordingStatus: CallRecording["status"];
        }[]
      >`
        SELECT
          call_recordings.call_brief_id AS "callId",
          call_recordings.provider_recording_id AS "providerRecordingId",
          call_recordings.status AS "recordingStatus"
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
      return row.callId;
    });
    return callId ? this.#recordingMutation(callId) : null;
  }

  async claimFinalTranscript(recordingId: string, model: string, force = false) {
    const now = new Date();
    const callId = await this.#sql.begin(async (transaction) => {
      const [recording] = await transaction<
        {
          callId: string;
          recordingStatus: CallRecording["status"];
        }[]
      >`
        SELECT
          call_recordings.call_brief_id AS "callId",
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
        transcript?.transcriptStatus === "processing" ||
        (transcript?.transcriptStatus === "completed" && !force)
      ) {
        return null;
      }

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
            ${randomUUID()},
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
      return recording.callId;
    });
    return callId ? this.#finalTranscriptMutation(callId) : null;
  }

  async completeFinalTranscript(
    recordingId: string,
    text: string,
    segments: FinalTranscriptSegment[]
  ) {
    const now = new Date();
    const ciphertext = encryptJson(text, this.#encryptionKey);
    const segmentsCiphertext = encryptJson(segments, this.#encryptionKey);
    const callId = await this.#sql.begin(async (transaction) => {
      const [row] = await transaction<
        { callId: string; retentionDays: number }[]
      >`
        SELECT
          call_recordings.call_brief_id AS "callId",
          call_briefs.audio_retention_days AS "retentionDays"
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
      await this.#audit(transaction, row.callId, "final_transcript.completed", {
        recordingId
      });
      return row.callId;
    });
    return this.#finalTranscriptMutation(callId);
  }

  async failFinalTranscript(recordingId: string, failureReason: string) {
    const now = new Date();
    const [row] = await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ callId: string }[]>`
        UPDATE final_transcripts
        SET
          status = 'failed',
          text_ciphertext = NULL,
          segments_ciphertext = NULL,
          failure_reason = ${failureReason},
          updated_at = ${now},
          completed_at = NULL
        WHERE call_recording_id = ${recordingId}
        RETURNING (
          SELECT call_brief_id
          FROM call_recordings
          WHERE id = ${recordingId}
        ) AS "callId"
      `;
      const updated = rows[0];
      if (updated) {
        await this.#audit(transaction, updated.callId, "final_transcript.failed", {
          failureReason,
          recordingId
        });
      }
      return rows;
    });
    if (!row) throw new CallRepositoryError("RECORDING_NOT_FOUND");
    return this.#finalTranscriptMutation(row.callId);
  }

  async listTranscriptionCandidates() {
    const rows = await this.#sql<{ recordingId: string }[]>`
      SELECT call_recordings.id AS "recordingId"
      FROM call_recordings
      LEFT JOIN final_transcripts
        ON final_transcripts.call_recording_id = call_recordings.id
      WHERE call_recordings.status = 'available'
        AND (
          final_transcripts.id IS NULL
          OR final_transcripts.status = 'failed'
        )
      ORDER BY call_recordings.completed_at ASC
    `;
    return rows.map((row) => row.recordingId);
  }

  async listExpiredRecordingCallIds(now: string) {
    const rows = await this.#sql<{ callId: string }[]>`
      SELECT call_brief_id AS "callId"
      FROM call_recordings
      WHERE status = 'available'
        AND delete_after IS NOT NULL
        AND delete_after <= ${new Date(now)}
      ORDER BY delete_after ASC
    `;
    return rows.map((row) => row.callId);
  }

  async markRecordingDeleted(id: string) {
    const now = new Date();
    await this.#sql.begin(async (transaction) => {
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

  async recoverInterruptedCalls() {
    const now = new Date();
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        SELECT id
        FROM call_briefs
        WHERE status IN ('dialing', 'in_progress', 'awaiting_approval')
        FOR UPDATE
      `;

      for (const { id } of rows) {
        await transaction`
          UPDATE approval_requests
          SET status = 'expired', decided_at = ${now}
          WHERE call_brief_id = ${id} AND status = 'pending'
        `;
        await transaction`
          UPDATE call_briefs
          SET status = 'failed', updated_at = ${now}
          WHERE id = ${id}
        `;
        await transaction`
          UPDATE call_attempts
          SET status = 'failed', ended_at = ${now}, failure_reason = 'server_restarted'
          WHERE id = (
            SELECT id FROM call_attempts
            WHERE call_brief_id = ${id}
            ORDER BY created_at DESC
            LIMIT 1
          )
        `;
        await this.#settleLatestAttempt(transaction, id, "call_refund");
        await this.#audit(transaction, id, "call.recovered_after_restart", {
          status: "failed"
        });
      }

      return rows.length;
    });
  }

  async recoverInterruptedTranscriptions() {
    const now = new Date();
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ callId: string; recordingId: string }[]>`
        UPDATE final_transcripts
        SET
          status = 'failed',
          failure_reason = 'server_restarted',
          updated_at = ${now},
          completed_at = NULL
        WHERE status = 'processing'
        RETURNING
          (
            SELECT call_brief_id
            FROM call_recordings
            WHERE call_recordings.id = final_transcripts.call_recording_id
          ) AS "callId",
          call_recording_id AS "recordingId"
      `;
      for (const row of rows) {
        await this.#audit(
          transaction,
          row.callId,
          "final_transcript.recovered_after_restart",
          { recordingId: row.recordingId }
        );
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
    if (attempt) await this.#settleAttempt(transaction, attempt.id, type);
  }

  async #settleAttempt(
    transaction: postgres.TransactionSql,
    attemptId: string,
    type: "call_charge" | "call_refund" | null
  ) {
    if (!type) return;
    const [attempt] = await transaction<{ userId: string | null }[]>`
      SELECT user_id AS "userId"
      FROM call_attempts
      WHERE id = ${attemptId}
    `;
    if (!attempt?.userId) return;
    await this.#lockCreditAccount(transaction, attempt.userId);
    await transaction`
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
          ? "Call ended before provider dialing"
          : "Provider dialing confirmed"},
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
    `;
  }

  async #lockCreditAccount(
    transaction: postgres.TransactionSql,
    userId: string
  ) {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
    `;
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
