import type postgres from "postgres";
import { callCompilationSchema, finalTranscriptRevisionSchema, type CallAssessmentRecord, type CallTextArtifact } from "@callassist/contracts";
import { encryptJson, decryptJson, type DataEncryptionMaterial } from "../security/encryption";
import { assessmentDeadlineMs, assessmentVersion, validateFinalAssessment } from "../credits/final-assessment";
import { CallRepositoryError } from "./call-repository";

export type FinalCreditEvidence = { version: 2; transcriptRevisionId: string; sourceHash: string; evaluatorVersion: string; category: string };
type Settle = (tx: postgres.TransactionSql, attemptId: string, type: "call_charge" | "call_refund", evidence?: FinalCreditEvidence) => Promise<unknown>;
type Row = {
  call_attempt_id: string; call_brief_id: string; compilation_id: string; source_hash: string | null;
  transcript_revision_id: string | null; evaluator_version: string | null; payload_ciphertext: string | null;
  status: CallAssessmentRecord["summary"]["status"]; conversation: CallAssessmentRecord["summary"]["conversation"];
  goal: CallAssessmentRecord["summary"]["goal"]; reason: CallAssessmentRecord["summary"]["reason"];
  updated_at: Date; deadline_at: Date | null;
};

export class PostgresCallAssessmentStore {
  constructor(readonly sql: postgres.Sql, readonly key: DataEncryptionMaterial, readonly settle: Settle) {}

  async get(callId: string, attemptId: string): Promise<CallAssessmentRecord | null> {
    const [row] = await this.sql<Row[]>`SELECT a.* FROM call_assessments a JOIN call_briefs b ON b.id=a.call_brief_id
      WHERE a.call_brief_id=${callId} AND a.call_attempt_id=${attemptId} AND b.data_deleted_at IS NULL`;
    return row ? this.map(row, true) : null;
  }
  async forCalls(ids: string[], sql: postgres.Sql | postgres.TransactionSql = this.sql) {
    const grouped = new Map<string, CallAssessmentRecord[]>();
    if (!ids.length) return grouped;
    const rows = await sql<Row[]>`SELECT a.call_attempt_id,a.call_brief_id,a.compilation_id,a.source_hash,a.transcript_revision_id,a.evaluator_version,
      NULL::text AS payload_ciphertext,a.status,a.conversation,a.goal,a.reason,a.updated_at,a.deadline_at FROM call_assessments a JOIN call_briefs b ON b.id=a.call_brief_id
      WHERE a.call_brief_id IN ${sql(ids)} AND b.data_deleted_at IS NULL`;
    for (const row of rows) grouped.set(row.call_brief_id, [...(grouped.get(row.call_brief_id) ?? []), this.map(row)]);
    return grouped;
  }
  map(row: Row, withDecision = false): CallAssessmentRecord {
    return { callAttemptId: row.call_attempt_id, compilationId: row.compilation_id, sourceHash: row.source_hash,
      summary: { status: row.status, conversation: row.conversation, goal: row.goal, reason: row.reason,
        updatedAt: row.updated_at.toISOString(), deadlineAt: row.deadline_at?.toISOString() ?? null,
        transcriptRevisionId: row.transcript_revision_id, evaluatorVersion: row.evaluator_version },
      decision: withDecision && row.payload_ciphertext ? decryptJson(row.payload_ciphertext, this.key) : null };
  }

  /** Called while the caller owns the lifecycle lock. Never undo an existing settlement. */
  async deferRefund(tx: postgres.TransactionSql, attemptId: string) {
    const [attempt] = await tx<{call_brief_id:string;compilation_id:string|null}[]>`SELECT a.call_brief_id,a.compilation_id FROM call_attempts a
      JOIN call_recordings r ON r.call_attempt_id=a.id JOIN call_briefs b ON b.id=a.call_brief_id
      WHERE a.id=${attemptId} AND r.consent_granted_at IS NOT NULL AND r.started_at IS NOT NULL
        AND b.data_deleted_at IS NULL AND a.compilation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM credit_transactions WHERE call_attempt_id=a.id AND type IN ('call_charge','call_refund'))`;
    if (!attempt?.compilation_id) return false;
    await tx`INSERT INTO call_assessments(call_attempt_id,call_brief_id,compilation_id,status,deadline_at)
      VALUES(${attemptId},${attempt.call_brief_id},${attempt.compilation_id},'pending',now()+${assessmentDeadlineMs}*interval '1 millisecond')
      ON CONFLICT DO NOTHING`;
    const [row] = await tx<Row[]>`SELECT * FROM call_assessments WHERE call_attempt_id=${attemptId} FOR UPDATE`;
    if (row?.status === "ready") await this.settleRow(tx, row);
    else if (row?.status === "unavailable") await this.settle(tx, attemptId, "call_refund");
    return true;
  }

  /** Runs inside the summary publication transaction, after the call/lease locks. */
  async complete(tx: postgres.TransactionSql, artifact: CallTextArtifact) {
    if (artifact.kind !== "call_summary" || !artifact.payload || !("assessment" in artifact.payload) || !artifact.payload.assessment ||
      !artifact.generatorVersion.startsWith("summary-v3:") || !artifact.generatorVersion.includes(":openai:")) return;
    const [source] = await tx<{payload_ciphertext:string;compilation_ciphertext:string;content_language:string|null;context:{taskContentLanguage:string}|null;ended_at:Date|null;consent:boolean}[]>`
      SELECT r.payload_ciphertext,c.compilation_ciphertext,a.content_language,l.context,a.ended_at,
        EXISTS(SELECT 1 FROM call_recordings cr WHERE cr.call_attempt_id=a.id AND cr.consent_granted_at IS NOT NULL AND cr.started_at IS NOT NULL) AS consent
      FROM final_transcript_revisions r JOIN call_attempts a ON a.id=r.call_attempt_id
      JOIN call_compilations c ON c.id=a.compilation_id LEFT JOIN call_language_contexts l ON l.call_brief_id=a.call_brief_id
      WHERE r.id=${artifact.transcriptRevisionId} AND r.call_brief_id=${artifact.callId} AND c.id=${artifact.compilationId} AND r.source_hash=${artifact.sourceHash}`;
    if (!source || artifact.targetLanguage !== (source.content_language ?? source.context?.taskContentLanguage)) return;
    const revision = finalTranscriptRevisionSchema.parse(decryptJson(source.payload_ciphertext,this.key));
    const compilation = callCompilationSchema.parse(decryptJson(source.compilation_ciphertext,this.key));
    if (!revision.callAttemptId || !compilation.compiledBrief || !source.consent) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    let decision;
    try { decision = validateFinalAssessment(artifact.payload.assessment, revision.segments, compilation.compiledBrief.successCriteria.map((_,i)=>`criterion.${i}`)); }
    catch { throw new CallRepositoryError("TEXT_ARTIFACT_INVALID"); }
    const evaluatorVersion = `${assessmentVersion}:${artifact.generatorVersion}`;
    await tx`INSERT INTO call_assessments(call_attempt_id,call_brief_id,compilation_id,status)
      VALUES(${revision.callAttemptId},${artifact.callId},${artifact.compilationId},'pending') ON CONFLICT DO NOTHING`;
    const [existing] = await tx<Row[]>`SELECT * FROM call_assessments WHERE call_attempt_id=${revision.callAttemptId} FOR UPDATE`;
    if (existing?.status === "ready" && existing.transcript_revision_id === revision.id) return;
    // A delayed result cannot turn an expired reservation into a debit.
    if (existing?.deadline_at && existing.deadline_at.getTime() <= Date.now()) await this.settle(tx,revision.callAttemptId,"call_refund");
    const [row] = await tx<Row[]>`UPDATE call_assessments SET status='ready',transcript_revision_id=${revision.id},
      source_hash=${revision.sourceHash},plan_hash=${compilation.snapshotHash},evaluator_version=${evaluatorVersion},
      conversation=${decision.conversation.status},goal=${decision.goal.status},payload_ciphertext=${encryptJson(decision,this.key)},
      reason=${decision.conversation.status === "uncertain" ? "evidence_uncertain" : null},updated_at=now()
      WHERE call_attempt_id=${revision.callAttemptId} RETURNING *`;
    if (source.ended_at && row) await this.settleRow(tx,row);
  }
  async settleRow(tx: postgres.TransactionSql, row: Row) {
    if (row.conversation === "confirmed" && row.payload_ciphertext) {
      const decision = this.map(row,true).decision!;
      await this.settle(tx,row.call_attempt_id,"call_charge",{version:2,transcriptRevisionId:row.transcript_revision_id!,sourceHash:row.source_hash!,
        evaluatorVersion:row.evaluator_version!,category:decision.conversation.category});
    } else await this.settle(tx,row.call_attempt_id,"call_refund");
  }

  /** Only a terminal failure of the canonical job can release its reservation. */
  async fail(tx: postgres.TransactionSql, artifact: CallTextArtifact) {
    if (artifact.kind !== "call_summary" || !artifact.generatorVersion.startsWith("summary-v3:") || !artifact.generatorVersion.includes(":openai:")) return;
    const [attempt] = await tx<{id:string;ended_at:Date|null}[]>`SELECT a.id,a.ended_at
      FROM call_attempts a JOIN final_transcript_revisions r ON r.call_attempt_id=a.id
      LEFT JOIN call_language_contexts l ON l.call_brief_id=a.call_brief_id
      WHERE r.id=${artifact.transcriptRevisionId} AND r.source_hash=${artifact.sourceHash}
        AND a.call_brief_id=${artifact.callId} AND a.compilation_id=${artifact.compilationId}
        AND EXISTS (SELECT 1 FROM call_recordings cr WHERE cr.call_attempt_id=a.id AND cr.consent_granted_at IS NOT NULL AND cr.started_at IS NOT NULL)
        AND COALESCE(a.content_language,l.context->>'taskContentLanguage')=${artifact.targetLanguage}`;
    if (!attempt) return;
    await tx`INSERT INTO call_assessments(call_attempt_id,call_brief_id,compilation_id,status)
      VALUES(${attempt.id},${artifact.callId},${artifact.compilationId},'pending') ON CONFLICT DO NOTHING`;
    const [row] = await tx<Row[]>`SELECT * FROM call_assessments WHERE call_attempt_id=${attempt.id} FOR UPDATE`;
    if (row?.status !== "pending") return;
    await tx`UPDATE call_assessments SET status='unavailable',reason='generation_failed',updated_at=now() WHERE call_attempt_id=${attempt.id}`;
    if (attempt.ended_at) await this.settle(tx,attempt.id,"call_refund");
  }

  async export(callId: string) {
    const rows = await this.sql<Row[]>`SELECT a.* FROM call_assessments a JOIN call_briefs b ON b.id=a.call_brief_id
      WHERE a.call_brief_id=${callId} AND b.data_deleted_at IS NULL ORDER BY a.updated_at,a.id`;
    return rows.map(row=>this.map(row,true));
  }
  /** Durable indexed sweep. Call locks precede assessment locks, as on publication. */
  async expire(now: string) {
    const due = await this.sql<{call_brief_id:string;call_attempt_id:string}[]>`SELECT call_brief_id,call_attempt_id FROM call_assessments
      WHERE status='pending' AND deadline_at<=${now} ORDER BY deadline_at LIMIT 100`;
    for (const item of due) await this.sql.begin(async tx=>{
      // Match content/deletion operations: owner before call, then assessment.
      await tx`SELECT u.id FROM users u JOIN call_briefs b ON b.user_id=u.id
        WHERE b.id=${item.call_brief_id} FOR KEY SHARE OF u`;
      await tx`SELECT id FROM call_briefs WHERE id=${item.call_brief_id} FOR UPDATE`;
      const [row] = await tx<Row[]>`SELECT * FROM call_assessments WHERE call_attempt_id=${item.call_attempt_id} FOR UPDATE`;
      if (row?.status !== "pending" || !row.deadline_at || row.deadline_at.toISOString()>now) return;
      await this.settle(tx,row.call_attempt_id,"call_refund");
      await tx`UPDATE call_assessments SET status='unavailable',reason='deadline',updated_at=${now} WHERE call_attempt_id=${row.call_attempt_id}`;
    });
  }
}
