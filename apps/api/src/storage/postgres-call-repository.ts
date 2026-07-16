import { randomUUID } from "node:crypto";
import {
  DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURE,
  createCallBriefInputSchema,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallBrief,
  type CallLocale,
  type CallSnapshot,
  type CreateCallBriefInput,
  type TranscriptSegment
} from "@callassist/contracts";
import postgres from "postgres";
import { decryptJson, encryptJson } from "../security/encryption";
import {
  CallRepositoryError,
  shouldApplyProviderCallStatus,
  type ApprovalRequestDraft,
  type CallAttemptRecord,
  type CallRepository,
  type StartAttemptInput
} from "./call-repository";

type DatabaseDate = Date | string;

type CallBriefRow = {
  id: string;
  recipientName: string;
  phoneNumber: string;
  objective: string;
  agentName: string;
  representedPerson: string;
  speechImpairmentDisclosure: string | null;
  speechImpairmentDisclosureCiphertext: string | null;
  contextCiphertext: string | null;
  locale: CallBrief["locale"];
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

const terminalStatuses = new Set<CallBrief["status"]>([
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

  async list() {
    const rows = await this.#sql<CallBriefRow[]>`
      ${this.#briefSelect()}
      ORDER BY created_at DESC
    `;
    return rows.map((row) => this.#mapBrief(row));
  }

  async create(input: CreateCallBriefInput) {
    const parsed = createCallBriefInputSchema.parse(input);
    const id = randomUUID();
    const now = new Date();
    const encryptedFacts = encryptJson(parsed.allowedFacts, this.#encryptionKey);
    const encryptedContext = encryptJson(parsed.context, this.#encryptionKey);
    const encryptedDisclosure = encryptJson(
      parsed.speechImpairmentDisclosure,
      this.#encryptionKey
    );

    await this.#sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO call_briefs (
          id,
          recipient_name,
          phone_number,
          objective,
          agent_name,
          represented_person,
          speech_impairment_disclosure,
          speech_impairment_disclosure_ciphertext,
          context_ciphertext,
          locale,
          allow_language_switch,
          fallback_locale,
          allowed_facts_ciphertext,
          status,
          created_at,
          updated_at
        ) VALUES (
          ${id},
          ${parsed.recipientName},
          ${parsed.phoneNumber},
          ${parsed.objective},
          ${parsed.agentName},
          ${parsed.representedPerson},
          ${null},
          ${encryptedDisclosure},
          ${encryptedContext},
          ${parsed.locale},
          ${parsed.allowLanguageSwitch},
          ${parsed.fallbackLocale ?? null},
          ${encryptedFacts},
          'ready',
          ${now},
          ${now}
        )
      `;
      await this.#audit(transaction, id, "call.created", {
        locale: parsed.locale,
        status: "ready"
      });
    });

    const snapshot = await this.#require(id);
    return snapshot.brief;
  }

  async get(id: string) {
    const [briefRow] = await this.#sql<CallBriefRow[]>`
      ${this.#briefSelect()}
      WHERE id = ${id}
    `;
    if (!briefRow) return null;

    const [transcriptRows, approvalRows] = await Promise.all([
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
      `
    ]);

    return {
      brief: this.#mapBrief(briefRow),
      transcript: transcriptRows.map((row) => this.#mapTranscript(row)),
      pendingApproval: approvalRows[0]
        ? this.#mapApproval(approvalRows[0])
        : null
    };
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
    await this.#sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE call_briefs
        SET status = 'dialing', updated_at = ${now}
        WHERE id = ${id} AND status = 'ready'
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
          provider,
          provider_call_id,
          status,
          provider_status,
          started_at,
          created_at
        ) VALUES (
          ${attemptId},
          ${id},
          ${input.provider},
          ${null},
          'dialing',
          ${null},
          ${now},
          ${now}
        )
      `;
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
    const [row] = await this.#sql<{ callId: string }[]>`
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

      if (applyCallStatus) {
        await transaction`
          UPDATE call_briefs
          SET status = ${callStatus}, updated_at = ${now}
          WHERE id = ${row.callId}
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
      await this.#audit(transaction, id, "call.status_changed", {
        status: "stopped"
      });
    });
    return this.#require(id);
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
        await this.#audit(transaction, id, "call.recovered_after_restart", {
          status: "failed"
        });
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
        agent_name AS "agentName",
        represented_person AS "representedPerson",
        speech_impairment_disclosure AS "speechImpairmentDisclosure",
        speech_impairment_disclosure_ciphertext AS "speechImpairmentDisclosureCiphertext",
        context_ciphertext AS "contextCiphertext",
        locale,
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
    return {
      id: row.id,
      recipientName: row.recipientName,
      phoneNumber: row.phoneNumber,
      objective: row.objective,
      agentName: row.agentName,
      representedPerson: row.representedPerson,
      speechImpairmentDisclosure: row.speechImpairmentDisclosureCiphertext
        ? decryptJson<string>(
            row.speechImpairmentDisclosureCiphertext,
            this.#encryptionKey
          )
        : row.speechImpairmentDisclosure ??
          DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURE,
      context: row.contextCiphertext
        ? decryptJson<string>(row.contextCiphertext, this.#encryptionKey)
        : "",
      locale: row.locale,
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

  async #require(id: string) {
    const snapshot = await this.get(id);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    return snapshot;
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
