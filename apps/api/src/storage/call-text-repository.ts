import { createHash, randomUUID } from "node:crypto";
import type {
  CallTextArtifact, FinalTranscriptRevision, FinalTranscriptSegment, PlanSource,
  TextArtifactKind, TextLanguage, ReviewEvidence, CallCompilation
} from "@callassist/contracts";
import type { DurableJobLease } from "../jobs/durable-job";

export type EnqueueTextArtifactInput = {
  callId: string; kind: TextArtifactKind; compilationId?: string; transcriptRevisionId?: string;
  sourceHash: string; targetLanguage: TextLanguage; generatorVersion: string;
};
export type TextArtifactChunk = { index: number; payload: unknown };
export type TextArtifactProviderReservationInput = {
  id: string; artifactId: string; provider: "openai";
  operationType: "text_translation" | "call_summary"; stage: string;
  requestedModel: string; clientRequestId: string; startedAt: string;
  maxRequests: number; durableJobGeneration: number;
};
export type CallPlanReviewReceipt = {
  id: string; callId: string; compilationId: string; snapshotHash: string;
  revision: number; evidence: ReviewEvidence; createdAt: string;
};
export interface CallTextRepository {
  getPlanSource(callId: string): Promise<PlanSource>;
  getTextArtifactSourceCompilation(callId: string, compilationId: string): Promise<CallCompilation | null>;
  getCurrentTranscriptRevision(callId: string): Promise<FinalTranscriptRevision | null>;
  getTranscriptRevision(callId: string, revisionId: string): Promise<FinalTranscriptRevision | null>;
  listTextArtifacts(callId: string): Promise<CallTextArtifact[]>;
  getTextArtifact(callId: string, artifactId: string): Promise<CallTextArtifact | null>;
  enqueueTextArtifact(input: EnqueueTextArtifactInput): Promise<CallTextArtifact>;
  claimTextArtifact(artifactId: string, lease: DurableJobLease): Promise<CallTextArtifact>;
  getTextArtifactChunks(artifactId: string, lease: DurableJobLease): Promise<TextArtifactChunk[]>;
  saveTextArtifactChunk(artifactId: string, index: number, payload: unknown, lease: DurableJobLease): Promise<void>;
  completeTextArtifact(artifactId: string, payload: NonNullable<CallTextArtifact["payload"]>, lease: DurableJobLease): Promise<CallTextArtifact>;
  failTextArtifact(artifactId: string, failureCode: string, lease: DurableJobLease): Promise<CallTextArtifact>;
  retryTextArtifact(callId: string, artifactId: string): Promise<CallTextArtifact>;
  cancelUserTextArtifacts(userId: string, now: string): Promise<void>;
  reserveTextArtifactProviderRequest(input: TextArtifactProviderReservationInput, lease: DurableJobLease): Promise<boolean>;
  getCurrentReviewReceipt(callId: string): Promise<CallPlanReviewReceipt | null>;
  exportCallTextData(callId: string): Promise<{
    compilations: Array<{ id: string; compilation: CallCompilation }>;
    transcriptRevisions: FinalTranscriptRevision[]; artifacts: CallTextArtifact[]; reviewReceipts: CallPlanReviewReceipt[];
  }>;
}

export const textArtifactMaximumRequests = 24;
export const textArtifactMaximumChunks = 24;
export const textArtifactMaximumGenerations = 3;
export const textArtifactMaximumTargets = 6;

export function textPayloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createTranscriptRevision(input: {
  transcriptId: string; callAttemptId: string | null; revision: number;
  text: string; segments: FinalTranscriptSegment[]; createdAt: string;
}): FinalTranscriptRevision {
  const id = randomUUID();
  const segments = input.segments.length ? input.segments.map((segment) => ({
    role: segment.role, text: segment.text,
    startSeconds: segment.startSeconds ?? null, endSeconds: segment.endSeconds ?? null
  })) : splitTranscriptText(input.text).map(text=>({ role: "unknown" as const, text, startSeconds: null, endSeconds: null }));
  return {
    id, transcriptId: input.transcriptId, callAttemptId: input.callAttemptId,
    revision: input.revision,
    sourceHash: textPayloadHash({ text: input.text, segments }),
    text: input.text,
    segments: segments.map((segment, index) => ({ id: `${id}:${index}`, ...segment })),
    createdAt: input.createdAt
  };
}

function splitTranscriptText(text:string) {
  const pieces:string[]=[];
  let start=0;
  while(start<text.length) {
    let end=Math.min(start+12000,text.length);
    if(end<text.length) {
      const paragraph=text.lastIndexOf("\n",end-1);
      if(paragraph>start+6000) end=paragraph+1;
      if(end<text.length && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
    }
    pieces.push(text.slice(start,end));start=end;
  }
  return pieces;
}
