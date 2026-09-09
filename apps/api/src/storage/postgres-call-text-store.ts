import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  callCompilationSchema, callTextArtifactSchema, finalTranscriptRevisionSchema,
  planReviewPayloadSchema, transcriptTranslationPayloadSchema, callSummaryPayloadSchema,
  type CallTextArtifact, type FinalTranscriptRevision, type CompilationReviewApprovalInput,
  type FinalTranscriptSegment, type TextLanguage, type PlanSource
} from "@callassist/contracts";
import { encryptJson, decryptJson, type DataEncryptionMaterial } from "../security/encryption";
import type { DurableJobLease } from "../jobs/durable-job";
import { CallRepositoryError } from "./call-repository";
import {
  createTranscriptRevision, textPayloadHash, textArtifactMaximumRequests, textArtifactMaximumTargets,
  textArtifactMaximumGenerations, textArtifactMaximumChunks,
  type EnqueueTextArtifactInput, type TextArtifactProviderReservationInput, type CallPlanReviewReceipt
} from "./call-text-repository";

type Sql = postgres.Sql | postgres.TransactionSql;
type ArtifactRow = {
  id: string; call_brief_id: string; kind: CallTextArtifact["kind"]; compilation_id: string | null;
  transcript_revision_id: string | null; source_hash: string; target_language: TextLanguage;
  generator_version: string; status: CallTextArtifact["status"]; payload_ciphertext: string | null;
  payload_hash: string | null; failure_code: string | null; created_at: Date; updated_at: Date;
};

export class PostgresCallTextStore {
  constructor(readonly sql: postgres.Sql, readonly key: DataEncryptionMaterial) {}

  async getPlanSource(callId: string): Promise<PlanSource> {
    await requireAvailableCall(this.sql, callId);
    const [row] = await this.sql<{ compilationId: string; revision: number; snapshotHash: string; reviewPolicyVersion: 1 | 2 }[]>`
      SELECT c.id AS "compilationId", c.revision, c.snapshot_hash AS "snapshotHash", COALESCE(p.policy_version,2) AS "reviewPolicyVersion"
      FROM call_briefs b JOIN call_compilations c ON c.id=b.current_compilation_id
      LEFT JOIN call_compilation_review_policies p ON p.compilation_id=c.id WHERE b.id=${callId}`;
    if (!row) throw new CallRepositoryError("CALL_COMPILATION_RECOMPILE_REQUIRED");
    return row;
  }

  async getTextArtifactSourceCompilation(callId: string, compilationId: string) {
    await requireAvailableCall(this.sql, callId);
    const [row] = await this.sql<{ compilation_ciphertext: string | null }[]>`
      SELECT compilation_ciphertext FROM call_compilations WHERE id=${compilationId} AND call_brief_id=${callId}`;
    return row?.compilation_ciphertext ? callCompilationSchema.parse(decryptJson(row.compilation_ciphertext,this.key)) : null;
  }

  async getCurrentTranscriptRevision(callId: string) {
    return this.sql.begin(async tx => {
      await requireAvailableCall(tx,callId,true);
      const [row] = await tx<{ id:string; current_revision_id:string|null; text_ciphertext:string|null; segments_ciphertext:string|null; call_attempt_id:string|null; completed_at:Date }[]>`
        SELECT f.*,r.call_attempt_id FROM final_transcripts f JOIN call_recordings r ON r.id=f.call_recording_id
        WHERE r.call_brief_id=${callId} AND f.status='completed' ORDER BY f.completed_at DESC LIMIT 1 FOR UPDATE OF f`;
      if (!row?.text_ciphertext) return null;
      if (row.current_revision_id) return readRevision(tx,this.key,callId,row.current_revision_id);
      return persistTranscriptRevision(tx,this.key,{
        callId,transcriptId:row.id,callAttemptId:row.call_attempt_id,
        text:decryptJson<string>(row.text_ciphertext,this.key),
        segments:row.segments_ciphertext ? decryptJson<FinalTranscriptSegment[]>(row.segments_ciphertext,this.key) : [],
        createdAt:row.completed_at.toISOString()
      });
    });
  }

  async getTranscriptRevision(callId:string,revisionId:string) {
    await requireAvailableCall(this.sql,callId);
    return readRevision(this.sql,this.key,callId,revisionId);
  }

  async listTextArtifacts(callId:string) {
    await requireAvailableCall(this.sql,callId);
    const rows = await this.sql<ArtifactRow[]>`SELECT * FROM call_text_artifacts WHERE call_brief_id=${callId} ORDER BY created_at,id`;
    return Promise.all(rows.map(row=>this.mapCurrent(row)));
  }

  async getTextArtifact(callId:string,artifactId:string) {
    await requireAvailableCall(this.sql,callId);
    const [row] = await this.sql<ArtifactRow[]>`SELECT * FROM call_text_artifacts WHERE id=${artifactId} AND call_brief_id=${callId}`;
    return row ? this.mapCurrent(row) : null;
  }

  async mapCurrent(row:ArtifactRow) {
    const artifact = mapArtifact(row,this.key);
    if (artifact.status !== "cancelled" && !await sourceIsCurrent(this.sql,row)) artifact.status="stale";
    return artifact;
  }

  async enqueueTextArtifact(input:EnqueueTextArtifactInput) {
    return this.sql.begin(async tx=>{
      await requireTextMutationCall(tx,input.callId);
      return enqueueArtifact(tx,this.key,input);
    });
  }

  async claimTextArtifact(id:string,lease:DurableJobLease) {
    return this.sql.begin(async tx=>{
      const row=await requireTextLease(tx,id,lease);
      if(row.status!=="ready") await tx`UPDATE call_text_artifacts SET status='processing',failure_code=NULL,updated_at=now() WHERE id=${id}`;
      return {...mapArtifact(row,this.key),status:row.status==="ready"?"ready" as const:"processing" as const};
    });
  }

  async getTextArtifactChunks(id:string,lease:DurableJobLease) {
    return this.sql.begin(async tx=>{
      await requireTextLease(tx,id,lease);
      const rows=await tx<{chunk_index:number;payload_ciphertext:string|null}[]>`SELECT chunk_index,payload_ciphertext FROM call_text_artifact_chunks WHERE artifact_id=${id} ORDER BY chunk_index`;
      return rows.filter(row=>row.payload_ciphertext).map(row=>({index:row.chunk_index,payload:decryptJson<unknown>(row.payload_ciphertext!,this.key)}));
    });
  }

  async saveTextArtifactChunk(id:string,index:number,payload:unknown,lease:DurableJobLease) {
    if(!Number.isInteger(index)||index<0||index>=textArtifactMaximumChunks||JSON.stringify(payload).length>1000000) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    await this.sql.begin(async tx=>{
      await requireTextLease(tx,id,lease);
      const hash=textPayloadHash(payload);
      const [old]=await tx<{payload_hash:string}[]>`SELECT payload_hash FROM call_text_artifact_chunks WHERE artifact_id=${id} AND chunk_index=${index}`;
      if(old && old.payload_hash!==hash) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
      if(!old) await tx`INSERT INTO call_text_artifact_chunks(id,artifact_id,chunk_index,payload_ciphertext,payload_hash)
        VALUES(${randomUUID()},${id},${index},${encryptJson(payload,this.key)},${hash})`;
    });
  }

  async completeTextArtifact(id:string,payload:NonNullable<CallTextArtifact["payload"]>,lease:DurableJobLease) {
    return this.sql.begin(async tx=>{
      const row=await requireTextLease(tx,id,lease);
      const parsed=parseArtifactPayload(row.kind,payload);
      if(row.status==="ready") {
        if(row.payload_hash!==textPayloadHash(parsed)) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
        return mapArtifact(row,this.key);
      }
      const [updated]=await tx<ArtifactRow[]>`UPDATE call_text_artifacts SET status='ready',payload_ciphertext=${encryptJson(parsed,this.key)},
        payload_hash=${textPayloadHash(parsed)},failure_code=NULL,updated_at=now() WHERE id=${id} RETURNING *`;
      return mapArtifact(updated!,this.key);
    });
  }

  async failTextArtifact(id:string,failureCode:string,lease:DurableJobLease) {
    return this.sql.begin(async tx=>{
      const row=await requireTextLease(tx,id,lease);
      if(row.status==="ready") return mapArtifact(row,this.key);
      const code=/^[a-z0-9_.:/-]{1,160}$/i.test(failureCode)?failureCode:"TEXT_ARTIFACT_FAILED";
      const [updated]=await tx<ArtifactRow[]>`UPDATE call_text_artifacts SET status='failed',failure_code=${code},updated_at=now() WHERE id=${id} RETURNING *`;
      return mapArtifact(updated!,this.key);
    });
  }

  async retryTextArtifact(callId:string,id:string) {
    return this.sql.begin(async tx=>{
      await requireTextMutationCall(tx,callId);
      const [row]=await tx<ArtifactRow[]>`SELECT * FROM call_text_artifacts WHERE id=${id} AND call_brief_id=${callId} FOR UPDATE`;
      if(!row) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_FOUND");
      if(!await sourceIsCurrent(tx,row)) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
      if(row.status==="ready"||row.status==="queued"||row.status==="processing") return mapArtifact(row,this.key);
      if(row.status!=="failed") throw new CallRepositoryError("TEXT_ARTIFACT_NOT_RETRYABLE");
      const updated=await tx`UPDATE durable_jobs SET status='queued',generation=generation+1,attempt_count=0,run_after=now(),
        lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,last_error_code=NULL,completed_at=NULL,updated_at=now()
        WHERE text_artifact_id=${id} AND status IN ('dead_letter','succeeded') AND generation<${textArtifactMaximumGenerations}`;
      if(updated.count!==1) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_RETRYABLE");
      await tx`UPDATE call_text_artifacts SET status='queued',failure_code=NULL,updated_at=now() WHERE id=${id}`;
      return {...mapArtifact(row,this.key),status:"queued" as const,failureCode:null};
    });
  }

  async reserveTextArtifactProviderRequest(input:TextArtifactProviderReservationInput,lease:DurableJobLease) {
    return this.sql.begin(async tx=>{
      const row=await requireTextLease(tx,input.artifactId,lease);
      if(row.status!=="processing"||input.durableJobGeneration!==lease.generation) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
      const existing=await tx`SELECT id FROM provider_operations WHERE id=${input.id} AND text_artifact_id=${input.artifactId} AND durable_job_id=${lease.jobId}`;
      if(existing.count) return true;
      const reserved=await tx`UPDATE call_text_artifacts SET provider_request_count=provider_request_count+1
        WHERE id=${input.artifactId} AND provider_request_count<${Math.min(input.maxRequests,textArtifactMaximumRequests)}`;
      if(!reserved.count) return false;
      await tx`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_brief_id,text_artifact_id,durable_job_id,durable_job_generation,started_at)
        VALUES(${input.id},${input.provider},${input.operationType},${input.stage},${input.requestedModel},${input.clientRequestId},${row.call_brief_id},${input.artifactId},${lease.jobId},${input.durableJobGeneration},${input.startedAt})`;
      return true;
    });
  }

  async cancelUserTextArtifacts(userId:string,now:string) {
    await this.sql.begin(async tx=>{
      await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      const calls=await tx<{id:string}[]>`SELECT id FROM call_briefs WHERE user_id=${userId} ORDER BY id FOR UPDATE`;
      for(const call of calls) {
        await tx`INSERT INTO durable_job_attempts(id,job_id,generation,attempt_number,worker_id,started_at,completed_at,outcome,error_code)
          SELECT gen_random_uuid(),id,generation,attempt_count,lease_owner,leased_at,${now},'cancelled','account_deletion_requested'
          FROM durable_jobs WHERE status='running' AND text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id=${call.id})
          ON CONFLICT (job_id,generation,attempt_number) DO NOTHING`;
        await tx`UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,
          completed_at=${now},updated_at=${now},last_error_code='account_deletion_requested'
          WHERE status IN ('queued','running') AND text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id=${call.id})`;
        await tx`UPDATE call_text_artifacts SET status='cancelled',updated_at=${now} WHERE call_brief_id=${call.id}`;
      }
    });
  }

  async getCurrentReviewReceipt(callId:string) {
    await requireAvailableCall(this.sql,callId);
    const [row]=await this.sql<{payload_ciphertext:string|null}[]>`SELECT r.payload_ciphertext FROM call_plan_review_receipts r
      JOIN call_briefs b ON b.current_compilation_id=r.compilation_id WHERE b.id=${callId}`;
    return row?.payload_ciphertext?decryptJson<CallPlanReviewReceipt>(row.payload_ciphertext,this.key):null;
  }

  async exportCallTextData(callId:string) {
    await requireAvailableCall(this.sql,callId);
    const compilations=await this.sql<{id:string;compilation_ciphertext:string|null}[]>`SELECT id,compilation_ciphertext FROM call_compilations WHERE call_brief_id=${callId} ORDER BY revision`;
    const revisions=await this.sql<{payload_ciphertext:string|null}[]>`SELECT payload_ciphertext FROM final_transcript_revisions WHERE call_brief_id=${callId} ORDER BY revision`;
    const receipts=await this.sql<{payload_ciphertext:string|null}[]>`SELECT payload_ciphertext FROM call_plan_review_receipts WHERE call_brief_id=${callId} ORDER BY created_at`;
    return {compilations:compilations.filter(r=>r.compilation_ciphertext).map(r=>({id:r.id,compilation:callCompilationSchema.parse(decryptJson(r.compilation_ciphertext!,this.key))})),
      transcriptRevisions:revisions.filter(r=>r.payload_ciphertext).map(r=>decryptJson<FinalTranscriptRevision>(r.payload_ciphertext!,this.key)),
      artifacts:await this.listTextArtifacts(callId),reviewReceipts:receipts.filter(r=>r.payload_ciphertext).map(r=>decryptJson<CallPlanReviewReceipt>(r.payload_ciphertext!,this.key))};
  }
}

export async function requireAvailableCall(sql:Sql,callId:string,lock=false) {
  const rows=await sql`SELECT id FROM call_briefs WHERE id=${callId} AND data_deleted_at IS NULL ${lock?sql`FOR UPDATE`:sql``}`;
  if(!rows.count) throw new CallRepositoryError("CALL_NOT_FOUND");
}

async function requireTextMutationCall(tx:postgres.TransactionSql,callId:string) {
  const [call]=await tx<{user_id:string|null}[]>`SELECT user_id FROM call_briefs WHERE id=${callId} AND data_deleted_at IS NULL`;
  if(!call) throw new CallRepositoryError("CALL_NOT_FOUND");
  if(call.user_id) {
    // Account deletion takes this same owner lock before creating its request.
    const [owner]=await tx<{status:string}[]>`SELECT status FROM users WHERE id=${call.user_id} FOR UPDATE`;
    const pending=await tx`SELECT id FROM account_deletion_requests WHERE user_id=${call.user_id} AND status<>'completed'`;
    if(!owner||owner.status!=="active"||pending.count) throw new CallRepositoryError("CALL_NOT_FOUND");
  }
  await requireAvailableCall(tx,callId,true);
}

async function readRevision(sql:Sql,key:DataEncryptionMaterial,callId:string,id:string) {
  const [row]=await sql<{payload_ciphertext:string|null}[]>`SELECT payload_ciphertext FROM final_transcript_revisions WHERE id=${id} AND call_brief_id=${callId}`;
  return row?.payload_ciphertext?finalTranscriptRevisionSchema.parse(decryptJson(row.payload_ciphertext,key)):null;
}

async function sourceIsCurrent(sql:Sql,row:Pick<ArtifactRow,"call_brief_id"|"kind"|"compilation_id"|"transcript_revision_id"|"source_hash">) {
  if(row.kind==="plan_review"||row.kind==="clarification_review") {
    const found=await sql`SELECT c.id FROM call_compilations c JOIN call_briefs b ON b.current_compilation_id=c.id
      WHERE b.id=${row.call_brief_id} AND b.data_deleted_at IS NULL AND c.id=${row.compilation_id} AND c.snapshot_hash=${row.source_hash}`;
    return found.count===1;
  }
  const found=await sql`SELECT r.id FROM final_transcript_revisions r JOIN final_transcripts f ON f.current_revision_id=r.id
    JOIN call_briefs b ON b.id=r.call_brief_id WHERE b.id=${row.call_brief_id} AND b.data_deleted_at IS NULL
    AND f.status='completed' AND r.id=${row.transcript_revision_id} AND r.source_hash=${row.source_hash}
    AND (${row.kind!=="call_summary"} OR EXISTS (SELECT 1 FROM call_attempts a WHERE a.id=r.call_attempt_id AND a.compilation_id=${row.compilation_id}))`;
  return found.count===1;
}

export async function enqueueArtifact(tx:postgres.TransactionSql,key:DataEncryptionMaterial,input:EnqueueTextArtifactInput) {
  const source={call_brief_id:input.callId,kind:input.kind,compilation_id:input.compilationId??null,transcript_revision_id:input.transcriptRevisionId??null,source_hash:input.sourceHash};
  if(!await sourceIsCurrent(tx,source)) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
  const [existing]=await tx<ArtifactRow[]>`SELECT * FROM call_text_artifacts WHERE call_brief_id=${input.callId} AND kind=${input.kind}
    AND compilation_id IS NOT DISTINCT FROM ${input.compilationId??null}::uuid AND transcript_revision_id IS NOT DISTINCT FROM ${input.transcriptRevisionId??null}::uuid
    AND source_hash=${input.sourceHash} AND target_language=${input.targetLanguage} AND generator_version=${input.generatorVersion}`;
  if(existing) return mapArtifact(existing,key);
  const [count]=await tx<{count:number;existingTarget:boolean}[]>`SELECT count(DISTINCT target_language)::integer AS count,
    COALESCE(bool_or(target_language=${input.targetLanguage}),false) AS "existingTarget" FROM call_text_artifacts
    WHERE call_brief_id=${input.callId} AND kind=${input.kind} AND source_hash=${input.sourceHash}`;
  if(!count?.existingTarget&&(count?.count??0)>=textArtifactMaximumTargets) throw new CallRepositoryError("TEXT_ARTIFACT_LIMIT_REACHED");
  const id=randomUUID();
  const [row]=await tx<ArtifactRow[]>`INSERT INTO call_text_artifacts(id,call_brief_id,kind,compilation_id,transcript_revision_id,source_hash,target_language,generator_version,status)
    VALUES(${id},${input.callId},${input.kind},${input.compilationId??null},${input.transcriptRevisionId??null},${input.sourceHash},${input.targetLanguage},${input.generatorVersion},'queued') RETURNING *`;
  await tx`INSERT INTO durable_jobs(id,job_type,text_artifact_id,status,max_attempts,run_after)
    VALUES(${randomUUID()},'text_artifact_generation',${id},'queued',3,now())`;
  return mapArtifact(row!,key);
}

export async function persistTranscriptRevision(tx:postgres.TransactionSql,key:DataEncryptionMaterial,input:{
  callId:string;transcriptId:string;callAttemptId:string|null;text:string;segments:FinalTranscriptSegment[];createdAt:string;
},summaryGeneratorVersion?:string) {
  const [latest]=await tx<{revision:number}[]>`SELECT COALESCE(max(revision),0)::integer AS revision FROM final_transcript_revisions WHERE transcript_id=${input.transcriptId}`;
  let revision=createTranscriptRevision({...input,revision:(latest?.revision??0)+1});
  const [same]=await tx<{payload_ciphertext:string|null}[]>`SELECT payload_ciphertext FROM final_transcript_revisions WHERE transcript_id=${input.transcriptId} AND source_hash=${revision.sourceHash}`;
  if(same?.payload_ciphertext) revision=decryptJson<FinalTranscriptRevision>(same.payload_ciphertext,key);
  else await tx`INSERT INTO final_transcript_revisions(id,call_brief_id,transcript_id,call_attempt_id,revision,source_hash,payload_ciphertext,created_at)
    VALUES(${revision.id},${input.callId},${input.transcriptId},${input.callAttemptId},${revision.revision},${revision.sourceHash},${encryptJson(revision,key)},${input.createdAt})`;
  await tx`UPDATE final_transcripts SET current_revision_id=${revision.id} WHERE id=${input.transcriptId}`;
  const ownerPending=await tx`SELECT b.id FROM call_briefs b JOIN users u ON u.id=b.user_id WHERE b.id=${input.callId}
    AND (u.status<>'active' OR EXISTS (SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed'))`;
  if(summaryGeneratorVersion && input.callAttemptId && !ownerPending.count) {
    const [attempt]=await tx<{compilation_id:string|null;content_language:TextLanguage|null;context:{taskContentLanguage:TextLanguage}|null}[]>`
      SELECT a.compilation_id,a.content_language,l.context FROM call_attempts a LEFT JOIN call_language_contexts l ON l.call_brief_id=a.call_brief_id WHERE a.id=${input.callAttemptId}`;
    const language=attempt?.content_language??attempt?.context?.taskContentLanguage;
    if(attempt?.compilation_id&&language) await enqueueArtifact(tx,key,{callId:input.callId,kind:"call_summary",compilationId:attempt.compilation_id,
      transcriptRevisionId:revision.id,sourceHash:revision.sourceHash,targetLanguage:language,generatorVersion:summaryGeneratorVersion});
  }
  return revision;
}

async function requireTextLease(tx:postgres.TransactionSql,id:string,lease:DurableJobLease) {
  const [target]=await tx<ArtifactRow[]>`SELECT * FROM call_text_artifacts WHERE id=${id}`;
  if(!target) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_FOUND");
  await requireTextMutationCall(tx,target.call_brief_id);
  const valid=await tx`SELECT id FROM durable_jobs WHERE id=${lease.jobId} AND text_artifact_id=${id} AND status='running'
    AND lease_owner=${lease.workerId} AND generation=${lease.generation??-1} AND attempt_count=${lease.attemptNumber??-1}
    AND lease_expires_at>GREATEST(now(),${lease.checkedAt}::timestamptz) FOR UPDATE`;
  if(!valid.count) throw new CallRepositoryError("DURABLE_JOB_LEASE_LOST");
  const [row]=await tx<ArtifactRow[]>`SELECT * FROM call_text_artifacts WHERE id=${id} FOR UPDATE`;
  if(!row||row.status==="cancelled") throw new CallRepositoryError("TEXT_ARTIFACT_NOT_FOUND");
  if(!await sourceIsCurrent(tx,row)) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
  return row;
}

function mapArtifact(row:ArtifactRow,key:DataEncryptionMaterial) {
  return callTextArtifactSchema.parse({id:row.id,callId:row.call_brief_id,kind:row.kind,compilationId:row.compilation_id,
    transcriptRevisionId:row.transcript_revision_id,sourceHash:row.source_hash,targetLanguage:row.target_language,generatorVersion:row.generator_version,
    status:row.status,payload:row.payload_ciphertext?decryptJson(row.payload_ciphertext,key):null,payloadHash:row.payload_hash,
    failureCode:row.failure_code,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()});
}

export function parseArtifactPayload(kind:CallTextArtifact["kind"],payload:unknown) {
  if(JSON.stringify(payload).length>2000000) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
  return kind==="call_summary"?callSummaryPayloadSchema.parse(payload):kind==="transcript_translation"?
    transcriptTranslationPayloadSchema.parse(payload):planReviewPayloadSchema.parse(payload);
}

export async function saveReviewReceipt(tx:postgres.TransactionSql,key:DataEncryptionMaterial,callId:string,source:PlanSource,
  expected:CompilationReviewApprovalInput|undefined,callLocale:string) {
  const [existing]=await tx<{payload_ciphertext:string|null}[]>`SELECT payload_ciphertext FROM call_plan_review_receipts WHERE compilation_id=${source.compilationId}`;
  if(existing?.payload_ciphertext) {
    const receipt=decryptJson<CallPlanReviewReceipt>(existing.payload_ciphertext,key);
    if(expected?.review && textPayloadHash(receipt.evidence)!==textPayloadHash(expected.review)) throw new CallRepositoryError("CALL_REVIEW_CONFLICT");
    return receipt;
  }
  if(source.reviewPolicyVersion===1) return null;
  if(!expected?.review) throw new CallRepositoryError("CALL_REVIEW_REQUIRED");
  const evidence=expected.review;
  const [context]=await tx<{context:{selectionRevision:number;taskContentLanguage:TextLanguage}}[]>`SELECT context FROM call_language_contexts WHERE call_brief_id=${callId} FOR SHARE`;
  if(evidence.selectionRevision!==(context?.context.selectionRevision??1)) throw new CallRepositoryError("CALL_REVIEW_STALE");
  if(evidence.mode==="original") {
    if(evidence.language!==callLocale&&evidence.language!==callLocale.split("-")[0]) throw new CallRepositoryError("CALL_REVIEW_STALE");
  } else {
    const [artifact]=await tx<ArtifactRow[]>`SELECT * FROM call_text_artifacts WHERE id=${evidence.artifactId} AND call_brief_id=${callId} FOR SHARE`;
    if(!artifact||artifact.status!=="ready"||!artifact.payload_ciphertext||artifact.kind!=="plan_review"||artifact.compilation_id!==source.compilationId||
      artifact.source_hash!==source.snapshotHash||artifact.payload_hash!==evidence.artifactHash||artifact.target_language!==evidence.language||
      (context&&context.context.taskContentLanguage!==evidence.language)) throw new CallRepositoryError("CALL_REVIEW_STALE");
  }
  const receipt:CallPlanReviewReceipt={id:randomUUID(),callId,compilationId:source.compilationId,revision:source.revision,snapshotHash:source.snapshotHash,evidence,createdAt:new Date().toISOString()};
  await tx`INSERT INTO call_plan_review_receipts(id,call_brief_id,compilation_id,revision,snapshot_hash,mode,language,selection_revision,artifact_id,artifact_hash,payload_ciphertext,created_at)
    VALUES(${receipt.id},${callId},${source.compilationId},${source.revision},${source.snapshotHash},${evidence.mode},${evidence.language},${evidence.selectionRevision},
    ${evidence.mode==="translated"?evidence.artifactId:null},${evidence.mode==="translated"?evidence.artifactHash:null},${encryptJson(receipt,key)},${receipt.createdAt})`;
  return receipt;
}

export async function requireReceiptForStart(tx:postgres.TransactionSql,callId:string,compilationId:string) {
  const [row]=await tx<{id:string|null;policy:number;language:TextLanguage|null}[]>`SELECT r.id,COALESCE(p.policy_version,2) AS policy,
    l.context->>'taskContentLanguage' AS language FROM call_compilations c
    LEFT JOIN call_compilation_review_policies p ON p.compilation_id=c.id
    LEFT JOIN call_plan_review_receipts r ON r.compilation_id=c.id AND r.payload_ciphertext IS NOT NULL
    LEFT JOIN call_language_contexts l ON l.call_brief_id=c.call_brief_id WHERE c.id=${compilationId} AND c.call_brief_id=${callId}`;
  if(!row||(row.policy===2&&!row.id)) throw new CallRepositoryError("CALL_REVIEW_REQUIRED");
  return {receiptId:row.id,contentLanguage:row.language};
}

export async function redactCallTextData(tx:postgres.TransactionSql,callId:string) {
  await tx`INSERT INTO durable_job_attempts(id,job_id,generation,attempt_number,worker_id,started_at,completed_at,outcome,error_code)
    SELECT gen_random_uuid(),id,generation,attempt_count,lease_owner,leased_at,now(),'cancelled','call_data_deleted'
    FROM durable_jobs WHERE status='running' AND text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id=${callId})
    ON CONFLICT (job_id,generation,attempt_number) DO NOTHING`;
  await tx`UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now(),last_error_code='call_data_deleted'
    WHERE text_artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id=${callId}) AND status IN ('queued','running')`;
  await tx`UPDATE call_text_artifact_chunks SET payload_ciphertext=NULL WHERE artifact_id IN (SELECT id FROM call_text_artifacts WHERE call_brief_id=${callId})`;
  await tx`UPDATE call_text_artifacts SET payload_ciphertext=NULL,status='cancelled',updated_at=now() WHERE call_brief_id=${callId}`;
  await tx`UPDATE final_transcript_revisions SET payload_ciphertext=NULL WHERE call_brief_id=${callId}`;
  await tx`UPDATE call_plan_review_receipts SET payload_ciphertext=NULL WHERE call_brief_id=${callId}`;
}
