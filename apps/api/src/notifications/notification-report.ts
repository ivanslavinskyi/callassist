import type postgres from "postgres";
import { approvedExecutionSnapshotSchema, callAssessmentDecisionSchema, callSummaryPayloadSchema, callCompilationSchema } from "@callassist/contracts";
import { decryptJson, type DataEncryptionMaterial } from "../security/encryption";
import type { CallRepository } from "../storage/call-repository";
import { calculateProviderUsageCost } from "../config/provider-pricing-policy";
import { type CallReport, type RegistrationReport } from "./notification-email";

export type NotificationEvent = {
  id: string; kind: "registration" | "call"; source_id: string; source_user_id: string | null;
  call_brief_id: string | null; call_attempt_id: string | null; occurred_at: Date;
};
export class NotificationReportReader {
  constructor(private readonly sql: postgres.Sql, private readonly key: DataEncryptionMaterial, private readonly calls: CallRepository) {}

  async registration(event: NotificationEvent): Promise<RegistrationReport | null> {
    const [user] = await this.sql<{id:string;first_name:string;last_name:string;email:string;phone_e164:string;
      email_verified_at:Date|null;ui_locale:string;created_at:Date}[]>`
      SELECT id,first_name,last_name,email,phone_e164,email_verified_at,ui_locale,created_at FROM users
      WHERE id=${event.source_user_id} AND status<>'deleted'
        AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=users.id AND d.status<>'completed')`;
    return user ? { userId:user.id,name:`${user.first_name} ${user.last_name}`,email:user.email,phone:user.phone_e164,
      emailVerified:!!user.email_verified_at,language:user.ui_locale,createdAt:user.created_at.toISOString(),verifiedAt:event.occurred_at.toISOString() } : null;
  }

  async call(event: NotificationEvent, now: Date): Promise<CallReport | "pending" | null> {
    const [row] = await this.sql<{
      status:string;failure_reason:string|null;started_at:Date;ended_at:Date;execution_snapshot_ciphertext:string|null;
      compilation_ciphertext:string|null;
      provider_status:string|null;has_consent:boolean;
      recipient_name:string;phone_number:string;locale:string;objective:string;owner:string|null;
      assessment_status:string|null;assessment_reason:string|null;assessment_payload:string|null;summary_payload:string|null;
      connected_at:Date|null;connected_seconds:number|null;
    }[]>`SELECT a.status,a.provider_status,a.failure_reason,a.started_at,a.ended_at,a.execution_snapshot_ciphertext,
      EXISTS(SELECT 1 FROM call_recordings cr WHERE cr.call_attempt_id=a.id AND cr.consent_granted_at IS NOT NULL) AS has_consent,
      b.recipient_name,b.phone_number,b.locale,b.objective,compilation.compilation_ciphertext,
      concat_ws(' ',u.first_name,u.last_name,u.email) AS owner,
      assessment.status AS assessment_status,assessment.reason AS assessment_reason,assessment.payload_ciphertext AS assessment_payload,
      (SELECT t.payload_ciphertext FROM call_text_artifacts t JOIN final_transcript_revisions r ON r.id=t.transcript_revision_id
        WHERE r.call_attempt_id=a.id AND t.kind='call_summary' AND t.status='ready'
          AND t.compilation_id=a.compilation_id AND t.target_language=COALESCE(a.content_language,l.context->>'taskContentLanguage')
          AND (assessment.transcript_revision_id IS NULL OR t.transcript_revision_id=assessment.transcript_revision_id)
        ORDER BY t.updated_at DESC LIMIT 1) AS summary_payload,
      (SELECT min(e.occurred_at) FROM call_events e WHERE e.call_attempt_id=a.id AND e.event_name='connection.confirmed' AND e.metadata->>'providerStatus'='in-progress') AS connected_at,
      (SELECT max(usage.duration_seconds)::double precision FROM effective_provider_usage usage JOIN provider_operations o ON o.id=usage.operation_id
        WHERE o.call_attempt_id=a.id AND o.operation_type='telephony_leg') AS connected_seconds
      FROM call_attempts a JOIN call_briefs b ON b.id=a.call_brief_id LEFT JOIN users u ON u.id=b.user_id
      LEFT JOIN call_compilations compilation ON compilation.id=a.compilation_id
      LEFT JOIN call_assessments assessment ON assessment.call_attempt_id=a.id
      LEFT JOIN call_language_contexts l ON l.call_brief_id=b.id
      WHERE a.id=${event.call_attempt_id} AND b.data_deleted_at IS NULL AND (u.id IS NULL OR u.status<>'deleted')
        AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed')`;
    if (!row) return null;
    // Also bound waiting when transcription has not produced an assessment row.
    if (row.has_consent && (!row.assessment_status || row.assessment_status === "pending") && now.getTime() < event.occurred_at.getTime() + 5 * 60_000) return "pending";
    const execution = row.execution_snapshot_ciphertext ? approvedExecutionSnapshotSchema.parse(decryptJson(row.execution_snapshot_ciphertext,this.key)) : null;
    const original = row.compilation_ciphertext ? callCompilationSchema.parse(decryptJson(row.compilation_ciphertext,this.key)).rawBrief : null;
    const costs = await this.costs(event.call_brief_id!,event.call_attempt_id!,now);
    return {
      callId:event.call_brief_id!,attemptId:event.call_attempt_id!,user:row.owner || "Unavailable",recipient:original?.recipientName ?? row.recipient_name,
      phone:original?.phoneNumber ?? row.phone_number,language:execution?.plan.callLocale ?? row.locale,objective:execution?.plan.localizedObjective ?? row.objective,
      status:statusLabels[row.provider_status ?? ""] ?? statusLabels[row.status] ?? row.status,failure:row.failure_reason,startedAt:row.started_at.toISOString(),endedAt:row.ended_at.toISOString(),
      elapsedSeconds:Math.max(0,Math.round((row.ended_at.getTime()-row.started_at.getTime())/1000)),
      connectedSeconds:row.connected_seconds ?? (row.connected_at ? Math.max(0,Math.round((row.ended_at.getTime()-row.connected_at.getTime())/1000)) : ["no-answer","busy","canceled"].includes(row.provider_status ?? "") ? 0 : null),
      assessmentStatus:!row.has_consent ? "Not assessed (no recording consent)" : row.assessment_status === "ready" ? "Ready" : `Unavailable${row.assessment_reason ? ` (${row.assessment_reason})` : " (processing deadline reached)"}`,
      assessment:row.assessment_payload ? callAssessmentDecisionSchema.parse(decryptJson(row.assessment_payload,this.key)) : null,
      criteria:execution?.plan.successCriteria ?? [],summary:row.summary_payload ? callSummaryPayloadSchema.parse(decryptJson(row.summary_payload,this.key)) : null,
      costs:costs.items,costsIncomplete:costs.incomplete,preparedAt:now.toISOString()
    };
  }

  private async costs(callId: string, attemptId: string, now: Date) {
    // Reuse the admin's per-request usage facts and immutable pricing policy.
    // Text generation is linked through its transcript revision, not the latest call attempt.
    const operations = await this.sql<{id:string;attempt_id:string|null;operation_type:string;provider:string;outcome:string|null}[]>`
      SELECT o.id,COALESCE(o.call_attempt_id,r.call_attempt_id,recording.call_attempt_id) AS attempt_id,o.operation_type,o.provider,result.outcome
      FROM provider_operations o LEFT JOIN call_text_artifacts t ON t.id=o.text_artifact_id
      LEFT JOIN final_transcript_revisions r ON r.id=t.transcript_revision_id
      LEFT JOIN call_recordings recording ON recording.id=o.recording_id
      LEFT JOIN provider_operation_results result ON result.operation_id=o.id
      WHERE o.call_brief_id=${callId} OR EXISTS(SELECT 1 FROM call_preparation_requests p WHERE p.id=o.call_preparation_id
        AND COALESCE(p.call_brief_id,p.target_call_brief_id)=${callId})`;
    const included = operations.filter(o=>o.attempt_id === attemptId || o.attempt_id === null);
    const byId = new Map(included.map(o=>[o.id,o]));
    const facts = await this.calls.getAdminOperationsFacts("1970-01-01T00:00:00.000Z",now.toISOString(),callId);
    const usageIds = new Set(facts.providerUsage.buckets.map(b=>b.operationId));
    let incomplete = included.some(o=>o.provider === "openai" &&
      (o.operation_type === "realtime_session" ? o.outcome !== "succeeded" : o.operation_type !== "brief_moderation" && !usageIds.has(o.id)));
    const groups = new Map<string,{label:string;amountMicros:number|null;currency:string;basis:string}>();
    const add = (label:string, amount:number|null, currency:string, basis:string) => {
      const key = `${label}:${currency}:${basis}`, old = groups.get(key);
      groups.set(key,{label,amountMicros:amount === null ? old?.amountMicros ?? null : (old?.amountMicros ?? 0)+amount,currency,basis});
    };
    for (const bucket of facts.providerUsage.buckets) {
      const operation = byId.get(bucket.operationId ?? "");
      if (!operation || bucket.provider !== "openai" || ["brief_moderation","realtime_session"].includes(bucket.operationType)) continue;
      const price = calculateProviderUsageCost(bucket);
      incomplete ||= price.calculatedUsdMicros === null || price.unpricedMetrics.length > 0;
      add(`${operation.attempt_id ? "Attempt" : "Shared"} — ${costLabels[bucket.operationType] ?? bucket.operationType}`,
        price.calculatedUsdMicros,"USD",`usage estimate; ${price.pricingVersion}`);
    }
    const charges = await this.sql<{operation_id:string;amount:number;currency:string;component:string;provider:string}[]>`
      SELECT c.operation_id,c.amount_micros::double precision AS amount,c.currency,c.component,c.provider
      FROM provider_cost_records c JOIN provider_operations o ON o.id=c.operation_id
      WHERE o.call_attempt_id=${attemptId}`;
    // Provider-reported telephony replaces any estimate; account billing totals are never additive.
    for (const charge of charges.filter(c=>c.provider === "twilio")) add(`Attempt — Telephony / ${charge.component}`,charge.amount,charge.currency,"provider reported");
    if (!charges.some(c=>c.provider === "twilio")) { add("Attempt — Telephony",null,"USD","provider price pending"); incomplete=true; }
    if (included.some(o=>o.provider==="openai" && o.attempt_id===attemptId) && ![...groups.values()].some(g=>g.label.startsWith("Attempt") && g.basis.startsWith("usage"))) {
      add("Attempt — AI",null,"USD","usage unavailable"); incomplete=true;
    }
    const items = [...groups.values()];
    const currencies = new Set(items.filter(i=>i.label.startsWith("Attempt") && i.amountMicros !== null).map(i=>i.currency));
    for (const currency of currencies) items.unshift({label:"Attempt — Known subtotal",amountMicros:items.filter(i=>i.currency===currency && i.label.startsWith("Attempt") && i.label!=="Attempt — Known subtotal").reduce((sum,i)=>sum+(i.amountMicros??0),0),currency,basis:incomplete ? "partial estimate" : "preliminary"});
    return {items,incomplete};
  }
}
const costLabels: Record<string,string> = { brief_compilation:"Plan preparation",text_translation:"Translation",call_summary:"Summary and assessment",realtime_response:"Realtime AI",transcription:"Transcription" };
const statusLabels: Record<string,string> = {completed:"Completed",failed:"Failed",stopped:"Stopped","no-answer":"No answer",busy:"Busy",canceled:"Canceled"};
