import type postgres from "postgres";
import { callCompilationSchema, callSummaryPayloadSchema, finalTranscriptRevisionSchema, resolveUiLocale } from "@callassist/contracts";
import { decryptJson, type DataEncryptionMaterial } from "../security/encryption";
import type { CallRepository } from "../storage/call-repository";
import type { UserCallReport } from "./user-call-email";

export type UserCallEvent = { call_brief_id: string; call_attempt_id: string; recipient_user_id: string; occurred_at: Date };
const waitForAssessmentMs = 5 * 60_000;
export const resultEvidenceLifetimeMs = 24 * 3600_000;

export class UserCallReportReader {
  constructor(private readonly sql: postgres.Sql, private readonly key: DataEncryptionMaterial, private readonly calls: CallRepository) {}

  async read(event: UserCallEvent, now: Date): Promise<UserCallReport | "pending" | null> {
    const [call] = await this.sql<{
      creation_ui_locale: string; ended_at: Date; compilation_id: string; compilation: string | null;
      consent: boolean; consent_at: Date | null; conversation_started: boolean; content_language: string | null;
    }[]>`SELECT b.creation_ui_locale,a.ended_at,a.compilation_id,c.compilation_ciphertext AS compilation,
      a.content_language,
      EXISTS(SELECT 1 FROM call_recordings r WHERE r.call_attempt_id=a.id AND r.consent_granted_at IS NOT NULL AND r.started_at IS NOT NULL) AS consent,
      (SELECT min(r.consent_granted_at) FROM call_recordings r WHERE r.call_attempt_id=a.id) AS consent_at,
      EXISTS(SELECT 1 FROM call_events e WHERE e.call_attempt_id=a.id AND e.event_name='conversation.started') AS conversation_started
      FROM call_attempts a JOIN call_briefs b ON b.id=a.call_brief_id JOIN call_compilations c ON c.id=a.compilation_id
      WHERE a.id=${event.call_attempt_id} AND b.id=${event.call_brief_id} AND b.user_id=${event.recipient_user_id}
        AND b.data_deleted_at IS NULL AND a.ended_at IS NOT NULL`;
    if (!call?.consent || !call.compilation) return null;
    const age = now.getTime() - event.occurred_at.getTime();
    const pending = () => age < resultEvidenceLifetimeMs ? "pending" as const : null;
    // Use the same display assessment projection as the call page, then freeze its exact source.
    const assessment = await this.calls.getCallAssessment(event.call_brief_id, event.call_attempt_id);
    const ready = assessment?.summary.status === "ready" && assessment.decision !== null;
    if (ready && assessment.decision?.conversation.status === "absent") return null;
    if (!ready && age < waitForAssessmentMs) return pending();
    const revisionId = ready ? assessment.summary.transcriptRevisionId : null;
    const [source] = await this.sql<{ payload: string; source: string; quality: { coverage?: string; timeOrigin?: string } | null }[]>`
      SELECT r.payload_ciphertext AS payload,t.source,t.quality FROM final_transcript_revisions r
      JOIN final_transcripts t ON t.id=r.transcript_id
      WHERE r.call_brief_id=${event.call_brief_id} AND r.call_attempt_id=${event.call_attempt_id}
        AND r.payload_ciphertext IS NOT NULL AND t.status='completed'
        AND (${revisionId}::uuid IS NULL OR r.id=${revisionId})
      ORDER BY CASE WHEN t.source IN ('live_native','live_composed') THEN 0 ELSE 1 END, r.created_at DESC,r.id DESC LIMIT 1`;
    if (!source) return pending();
    const transcript = finalTranscriptRevisionSchema.parse(decryptJson(source.payload, this.key));
    if (transcript.callAttemptId !== event.call_attempt_id || (revisionId && transcript.id !== revisionId)) return null;
    const confirmed = ready && assessment.decision?.conversation.status === "confirmed";
    // Connection alone and disclosure/consent text are not a conversation. Fallback
    // needs task admission plus original turns from both parties after consent.
    const consentOffset = call.consent_at && source.quality?.timeOrigin
      ? (call.consent_at.getTime() - Date.parse(source.quality.timeOrigin)) / 1000 : null;
    const taskTurns = transcript.segments.filter(s => s.text.trim() && s.source !== "application_playback" && s.source !== "consent_event" &&
      (source.source === "recording_asr" || (consentOffset !== null && s.startSeconds !== null && s.startSeconds > consentOffset)));
    const dialogue = call.conversation_started && taskTurns.some(s => s.role === "recipient") && taskTurns.some(s => s.role === "assistant");
    if (!confirmed && (!dialogue || age < waitForAssessmentMs)) return pending();
    const compilation = callCompilationSchema.parse(decryptJson(call.compilation, this.key));
    if (!compilation.compiledBrief) return null;
    const [summaryRow] = ready ? await this.sql<{ payload: string; language: string }[]>`
      SELECT t.payload_ciphertext AS payload,t.target_language AS language FROM call_text_artifacts t
      WHERE t.call_brief_id=${event.call_brief_id} AND t.compilation_id=${call.compilation_id}
        AND t.transcript_revision_id=${transcript.id} AND t.source_hash=${transcript.sourceHash}
        AND t.kind='call_summary' AND t.status='ready' AND t.payload_ciphertext IS NOT NULL
        AND (${assessment.artifactId ?? null}::uuid IS NULL OR t.id=${assessment.artifactId ?? null})
        AND (${assessment.artifactId ?? null}::uuid IS NOT NULL OR t.target_language=${call.content_language})
      ORDER BY t.updated_at DESC,t.id DESC LIMIT 1` : [];
    const summary = summaryRow ? callSummaryPayloadSchema.parse(decryptJson(summaryRow.payload, this.key)) : null;
    const prose = summary ? (summary.overview.length ? summary.overview : summary.findings.slice(0, 3)) : [];
    return {
      callId: event.call_brief_id, attemptId: event.call_attempt_id, locale: resolveUiLocale(call.creation_ui_locale),
      recipient: compilation.rawBrief.recipientName, endedAt: call.ended_at.toISOString(),
      callLanguage: compilation.compiledBrief.callLocale, assessmentLanguage: summaryRow?.language,
      goal: ready ? assessment.decision!.goal.status : null,
      assessmentParagraphs: prose.map(item => item.label ? `${item.label}: ${item.text}` : item.text),
      transcript, partial: source.quality?.coverage === "partial" || source.quality?.coverage === "unavailable"
    };
  }
}
