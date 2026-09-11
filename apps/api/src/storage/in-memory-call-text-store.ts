import { randomUUID } from "node:crypto";
import type {
  CallSnapshot, CallCompilation, PlanSource, CallTextArtifact, FinalTranscriptRevision,
  CompilationReviewApprovalInput, FinalTranscriptSegment
} from "@callassist/contracts";
import type { DurableJob, DurableJobLease, EnqueueDurableJobInput } from "../jobs/durable-job";
import { CallRepositoryError, type CallAttemptRecord } from "./call-repository";
import {
  createTranscriptRevision, textPayloadHash, textArtifactMaximumRequests, textArtifactMaximumChunks, projectTextArtifactProgress,
  textArtifactMaximumTargets, type EnqueueTextArtifactInput,
  type TextArtifactChunk, type CallPlanReviewReceipt
} from "./call-text-repository";
import { parseArtifactPayload } from "./postgres-call-text-store";

type CompilationSource={id:string;compilation:CallCompilation|null};
type Hooks={
  snapshot:(id:string)=>CallSnapshot;
  textAllowed:(id:string)=>boolean;
  compilations:(id:string)=>CompilationSource[];
  attempt:(id:string,attemptId?:string|null)=>CallAttemptRecord|undefined;
  enqueue:(input:EnqueueDurableJobInput)=>Promise<DurableJob>;
  job:(id:string)=>DurableJob|null|undefined;
  jobs:()=>DurableJob[];
};
export class InMemoryCallTextStore {
  readonly artifacts=new Map<string,CallTextArtifact>();
  readonly revisions=new Map<string,{callId:string;revision:FinalTranscriptRevision}>();
  readonly receipts=new Map<string,CallPlanReviewReceipt>();
  readonly requests=new Map<string,number>();
  readonly chunks=new Map<string,TextArtifactChunk[]>();
  constructor(readonly hooks:Hooks) {}

  getPlanSource(callId:string):PlanSource {
    this.hooks.snapshot(callId);
    const source=this.hooks.compilations(callId).at(-1);
    if(!source?.compilation) throw new CallRepositoryError("CALL_COMPILATION_RECOMPILE_REQUIRED");
    return {compilationId:source.id,revision:source.compilation.revision,snapshotHash:source.compilation.snapshotHash,reviewPolicyVersion:2};
  }
  getTextArtifactSourceCompilation(callId:string,id:string) {
    this.hooks.snapshot(callId);
    return structuredClone(this.hooks.compilations(callId).find(c=>c.id===id)?.compilation??null);
  }
  async getCurrentTranscriptRevision(callId:string) {
    const snapshot=this.hooks.snapshot(callId);
    const transcript=snapshot.finalTranscript;
    if(transcript?.status!=="completed"||transcript.text===null) return null;
    return this.persistRevision(callId,transcript.id,transcript.text,transcript.segments,transcript.completedAt??transcript.updatedAt);
  }
  async persistRevision(callId:string,transcriptId:string,text:string,segments:FinalTranscriptSegment[],createdAt:string,summaryGeneratorVersion?:string) {
    const history=[...this.revisions.values()].filter(r=>r.callId===callId&&r.revision.transcriptId===transcriptId);
    const attempt=this.hooks.attempt(callId);
    const proposed=createTranscriptRevision({transcriptId,callAttemptId:attempt?.id??null,text,segments,createdAt,revision:history.length+1});
    const revision=history.find(row=>row.revision.sourceHash===proposed.sourceHash)?.revision??proposed;
    if(!this.revisions.has(revision.id)) this.revisions.set(revision.id,{callId,revision});
    if(summaryGeneratorVersion && attempt?.compilationId && this.hooks.textAllowed(callId)) {
      const language=attempt.contentLanguage??this.hooks.snapshot(callId).languageContext?.taskContentLanguage;
      if(language) await this.enqueueTextArtifact({callId,kind:"call_summary",compilationId:attempt.compilationId,transcriptRevisionId:revision.id,
        sourceHash:revision.sourceHash,targetLanguage:language,generatorVersion:summaryGeneratorVersion});
    }
    return structuredClone(revision);
  }
  getTranscriptRevision(callId:string,id:string) {
    this.hooks.snapshot(callId);
    const row=this.revisions.get(id);
    return row?.callId===callId?structuredClone(row.revision):null;
  }
  listTextArtifacts(callId:string) {
    this.hooks.snapshot(callId);
    return [...this.artifacts.values()].filter(a=>a.callId===callId).map(a=>this.project(a));
  }
  getTextArtifact(callId:string,id:string) {
    this.hooks.snapshot(callId);
    const artifact=this.artifacts.get(id);
    return artifact?.callId===callId?this.project(artifact):null;
  }
  project(artifact:CallTextArtifact) {
    const current = {...artifact,status:artifact.status!=="cancelled"&&!this.current(artifact)?"stale" as const:artifact.status};
    return structuredClone(projectTextArtifactProgress(current, this.hooks.jobs().find(j=>j.textArtifactId===artifact.id), this.requests.get(artifact.id)??0));
  }
  current(artifact:CallTextArtifact) {
    const snapshot=this.hooks.snapshot(artifact.callId);
    if(artifact.kind==="plan_review"||artifact.kind==="clarification_review") {
      const source=this.getPlanSource(artifact.callId);
      return source.compilationId===artifact.compilationId&&source.snapshotHash===artifact.sourceHash;
    }
    const revision=this.revisions.get(artifact.transcriptRevisionId??"")?.revision;
    const final=snapshot.finalTranscript;
    if(!revision||final?.status!=="completed"||final.text===null) return false;
    const current=createTranscriptRevision({transcriptId:final.id,callAttemptId:revision.callAttemptId,text:final.text,segments:final.segments,revision:1,createdAt:final.updatedAt});
    return revision.sourceHash===current.sourceHash&&artifact.sourceHash===revision.sourceHash&&
      (artifact.kind!=="call_summary"||this.hooks.attempt(artifact.callId,revision.callAttemptId)?.compilationId===artifact.compilationId);
  }
  async enqueueTextArtifact(input:EnqueueTextArtifactInput) {
    this.hooks.snapshot(input.callId);
    if(!this.hooks.textAllowed(input.callId)) throw new CallRepositoryError("CALL_NOT_FOUND");
    const now=new Date().toISOString();
    const artifact:CallTextArtifact={id:randomUUID(),callId:input.callId,kind:input.kind,compilationId:input.compilationId??null,
      transcriptRevisionId:input.transcriptRevisionId??null,sourceHash:input.sourceHash,targetLanguage:input.targetLanguage,generatorVersion:input.generatorVersion,
      status:"queued",payload:null,payloadHash:null,failureCode:null,retryable:false,createdAt:now,updatedAt:now};
    if(!this.current(artifact)) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
    const same=[...this.artifacts.values()].find(a=>a.callId===artifact.callId&&a.kind===artifact.kind&&a.compilationId===artifact.compilationId&&
      a.transcriptRevisionId===artifact.transcriptRevisionId&&a.sourceHash===artifact.sourceHash&&a.targetLanguage===artifact.targetLanguage&&a.generatorVersion===artifact.generatorVersion);
    if(same) return this.project(same);
    const targets=new Set([...this.artifacts.values()].filter(a=>a.callId===artifact.callId&&a.kind===artifact.kind&&a.sourceHash===artifact.sourceHash).map(a=>a.targetLanguage));
    if(!targets.has(artifact.targetLanguage)&&targets.size>=textArtifactMaximumTargets) throw new CallRepositoryError("TEXT_ARTIFACT_LIMIT_REACHED");
    this.artifacts.set(artifact.id,artifact);
    await this.hooks.enqueue({type:"text_artifact_generation",textArtifactId:artifact.id,runAfter:now,maxAttempts:3});
    return structuredClone(artifact);
  }
  requireLease(id:string,lease:DurableJobLease) {
    const artifact=this.artifacts.get(id);
    if(!artifact) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_FOUND");
    this.hooks.snapshot(artifact.callId);
    if(!this.hooks.textAllowed(artifact.callId)) throw new CallRepositoryError("CALL_NOT_FOUND");
    const job=this.hooks.job(lease.jobId);
    if(!job||job.textArtifactId!==id||job.status!=="running"||job.leaseOwner!==lease.workerId||job.generation!==lease.generation||job.attemptCount!==lease.attemptNumber||
      !job.leaseExpiresAt||job.leaseExpiresAt<=new Date(Math.max(Date.now(),Date.parse(lease.checkedAt))).toISOString()) throw new CallRepositoryError("DURABLE_JOB_LEASE_LOST");
    if(!this.current(artifact)) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
    return artifact;
  }
  claimTextArtifact(id:string,lease:DurableJobLease) {
    const artifact=this.requireLease(id,lease);
    if(artifact.status!=="ready") Object.assign(artifact,{status:"processing",failureCode:null,updatedAt:new Date().toISOString()});
    return structuredClone(artifact);
  }
  getTextArtifactChunks(id:string,lease:DurableJobLease) {
    this.requireLease(id,lease);
    return structuredClone(this.chunks.get(id)??[]);
  }
  saveTextArtifactChunk(id:string,index:number,payload:unknown,lease:DurableJobLease) {
    this.requireLease(id,lease);
    if(!Number.isInteger(index)||index<0||index>=textArtifactMaximumChunks||JSON.stringify(payload).length>1000000) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    const chunks=this.chunks.get(id)??[];
    const existing=chunks.find(c=>c.index===index);
    if(existing && textPayloadHash(existing.payload)!==textPayloadHash(payload)) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    if(!existing) chunks.push({index,payload:structuredClone(payload)});
    this.chunks.set(id,chunks.sort((a,b)=>a.index-b.index));
  }
  completeTextArtifact(id:string,payload:NonNullable<CallTextArtifact["payload"]>,lease:DurableJobLease) {
    const artifact=this.requireLease(id,lease);
    const parsed=parseArtifactPayload(artifact.kind,payload);
    if(artifact.status==="ready"&&artifact.payloadHash!==textPayloadHash(parsed)) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    Object.assign(artifact,{status:"ready",payload:structuredClone(parsed),payloadHash:textPayloadHash(parsed),failureCode:null,updatedAt:new Date().toISOString()});
    return structuredClone(artifact);
  }
  failTextArtifact(id:string,failureCode:string,lease:DurableJobLease) {
    const artifact=this.requireLease(id,lease);
    if(artifact.status!=="ready") Object.assign(artifact,{status:"failed",failureCode:/^[a-z0-9_.:/-]{1,160}$/i.test(failureCode)?failureCode:"TEXT_ARTIFACT_FAILED",updatedAt:new Date().toISOString()});
    return structuredClone(artifact);
  }
  async retryTextArtifact(callId:string,id:string) {
    const artifact=this.artifacts.get(id);
    this.hooks.snapshot(callId);
    if(!artifact||artifact.callId!==callId) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_FOUND");
    if(!this.hooks.textAllowed(callId)) throw new CallRepositoryError("CALL_NOT_FOUND");
    if(!this.current(artifact)) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
    const projected = this.project(artifact);
    if(["ready","queued","processing"].includes(projected.status)) return projected;
    if(!projected.retryable) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_RETRYABLE");
    await this.hooks.enqueue({type:"text_artifact_generation",textArtifactId:id,runAfter:new Date().toISOString(),maxAttempts:3,restartTerminal:true});
    Object.assign(artifact,{status:"queued",failureCode:null,updatedAt:new Date().toISOString()});
    return structuredClone(artifact);
  }
  saveReviewReceipt(callId:string,expected:CompilationReviewApprovalInput|undefined) {
    const snapshot=this.hooks.snapshot(callId);
    const source=this.getPlanSource(callId);
    const existing=this.receipts.get(source.compilationId);
    if(existing) {
      if(expected?.review&&textPayloadHash(expected.review)!==textPayloadHash(existing.evidence)) throw new CallRepositoryError("CALL_REVIEW_CONFLICT");
      return existing;
    }
    if(!expected?.review) throw new CallRepositoryError("CALL_REVIEW_REQUIRED");
    const evidence=expected.review;
    if(evidence.selectionRevision!==(snapshot.languageContext?.selectionRevision??1)) throw new CallRepositoryError("CALL_REVIEW_STALE");
    if(evidence.mode==="original") {
      if(evidence.language!==snapshot.brief.locale&&evidence.language!==snapshot.brief.locale.split("-")[0]) throw new CallRepositoryError("CALL_REVIEW_STALE");
    } else {
      const artifact=this.artifacts.get(evidence.artifactId);
      if(!artifact||artifact.callId!==callId||artifact.status!=="ready"||artifact.kind!=="plan_review"||artifact.compilationId!==source.compilationId||
        artifact.sourceHash!==source.snapshotHash||artifact.payloadHash!==evidence.artifactHash||artifact.targetLanguage!==evidence.language||
        (snapshot.languageContext&&snapshot.languageContext.taskContentLanguage!==evidence.language)) throw new CallRepositoryError("CALL_REVIEW_STALE");
    }
    const receipt={id:randomUUID(),callId,compilationId:source.compilationId,revision:source.revision,snapshotHash:source.snapshotHash,evidence:structuredClone(evidence),createdAt:new Date().toISOString()};
    this.receipts.set(source.compilationId,receipt);
    return receipt;
  }
  getCurrentReviewReceipt(callId:string) {
    return structuredClone(this.receipts.get(this.getPlanSource(callId).compilationId)??null);
  }
  exportCallTextData(callId:string) {
    this.hooks.snapshot(callId);
    return {compilations:this.hooks.compilations(callId).filter(c=>c.compilation).map(c=>({id:c.id,compilation:structuredClone(c.compilation!)})),
      transcriptRevisions:[...this.revisions.values()].filter(r=>r.callId===callId).map(r=>structuredClone(r.revision)),artifacts:this.listTextArtifacts(callId),
      reviewReceipts:[...this.receipts.values()].filter(r=>r.callId===callId).map(r=>structuredClone(r))};
  }
  redact(callId:string) {
    for(const [id,artifact] of this.artifacts) if(artifact.callId===callId) { artifact.payload=null;artifact.status="cancelled";this.chunks.delete(id); }
    for(const [id,row] of this.revisions) if(row.callId===callId) this.revisions.delete(id);
    for(const [id,receipt] of this.receipts) if(receipt.callId===callId) this.receipts.delete(id);
  }
  reserveRequest(id:string,maxRequests:number,lease:DurableJobLease) {
    const artifact=this.requireLease(id,lease);
    if(artifact.status!=="processing") throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    const count=this.requests.get(id)??0;
    if(count>=Math.min(maxRequests,textArtifactMaximumRequests)) return false;
    this.requests.set(id,count+1);return true;
  }
}
