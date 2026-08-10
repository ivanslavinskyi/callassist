import { randomUUID } from "node:crypto";
import {
  DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURE,
  createCallBriefInputSchema,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallBrief,
  type CallRecording,
  type CallLocale,
  type CallSnapshot,
  type CreateCallBriefInput,
  type FinalTranscript,
  type FinalTranscriptSegment,
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
  type RecordingStatusInput,
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
          ${parsed.recipientName},
          ${parsed.phoneNumber},
          ${parsed.objective},
          ${parsed.agentName},
          ${parsed.representedPerson},
          ${null},
          ${encryptedDisclosure},
          ${encryptedContext},
          ${parsed.locale},
          ${parsed.voiceGender},
          ${parsed.audioRetentionDays},
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
        agent_name AS "agentName",
        represented_person AS "representedPerson",
        speech_impairment_disclosure AS "speechImpairmentDisclosure",
        speech_impairment_disclosure_ciphertext AS "speechImpairmentDisclosureCiphertext",
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
