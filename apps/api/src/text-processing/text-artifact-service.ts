import {
  callSummaryPayloadSchema, planReviewPayloadSchema, transcriptTranslationPayloadSchema,
  type CallCompilation, type CallTextArtifact, type TextArtifactKind, type TextLanguage,
  type PlanReviewPayload, type CallSummaryPayload
} from "@callassist/contracts";
import { CallRepositoryError, type CallRepository } from "../storage/call-repository";
import { textArtifactMaximumRequests } from "../storage/call-text-repository";
import { DurableJobExecutionError, type DurableJob, type DurableJobLease } from "../jobs/durable-job";
import { planReviewFields } from "./plan-review-fields";
import { textDirectionEnabled, type TextCapabilities } from "./text-capabilities";
import { TextProcessingError, textGeneratorVersion, type TextProcessingInput, type TextProcessor, type TextProcessingPayload } from "./text-processor";
import { summaryInput } from "./summary-input";
import { validateTextProcessingInput, validateTextProcessingOutput } from "./text-validation";

export class TextArtifactServiceError extends Error {
  constructor(readonly code: "TEXT_GENERATION_DISABLED" | "TEXT_DIRECTION_UNSUPPORTED") { super(code); }
}

export class TextArtifactService {
  constructor(readonly repository: CallRepository, readonly processor: TextProcessor, readonly capabilities: TextCapabilities) {}

  async requestPlanReview(callId: string, input: { compilationId: string; revision: number; snapshotHash: string; targetLanguage: TextLanguage }) {
    const [snapshot, source] = await Promise.all([this.repository.get(callId), this.repository.getPlanSource(callId)]);
    if (!snapshot?.compilation) throw new CallRepositoryError("CALL_NOT_FOUND");
    if (source.compilationId !== input.compilationId || source.revision !== input.revision || source.snapshotHash !== input.snapshotHash) {
      throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
    }
    const kind = reviewKind(snapshot.compilation);
    const existing = await this.#find(callId, kind, source.compilationId, null, source.snapshotHash, input.targetLanguage);
    if (existing) return existing;
    this.#assertDirection(kind, reviewSourceLanguage(snapshot.compilation, snapshot.languageContext?.detectedInputLanguage), input.targetLanguage);
    return this.repository.enqueueTextArtifact({ callId, kind, compilationId: source.compilationId, sourceHash: source.snapshotHash,
      targetLanguage: input.targetLanguage, generatorVersion: textGeneratorVersion(this.processor, kind) });
  }

  async requestTranscriptArtifact(callId: string, kind: "transcript_translation" | "call_summary", input: { sourceRevisionId: string; targetLanguage: TextLanguage }) {
    const [snapshot, source] = await Promise.all([this.repository.get(callId), this.repository.getCurrentTranscriptRevision(callId)]);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    if (!source || source.id !== input.sourceRevisionId) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
    const compilationId = kind === "call_summary" && source.callAttemptId ? (await this.repository.getAttempt(callId, source.callAttemptId))?.compilationId ?? null : null;
    if (kind === "call_summary" && !compilationId) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    const existing = await this.#find(callId, kind, compilationId, source.id, source.sourceHash, input.targetLanguage);
    if (existing) return existing;
    this.#assertDirection(kind, "*", input.targetLanguage);
    return this.repository.enqueueTextArtifact({ callId, kind, ...(compilationId ? { compilationId } : {}), transcriptRevisionId: source.id,
      sourceHash: source.sourceHash, targetLanguage: input.targetLanguage, generatorVersion: textGeneratorVersion(this.processor, kind) });
  }

  async ensureAutomaticPlan(callId: string) {
    const snapshot = await this.repository.get(callId);
    if (!snapshot?.compilation || !snapshot.languageContext || snapshot.compilation.approvedAt) return;
    const targetLanguage = snapshot.languageContext.taskContentLanguage;
    const sourceLanguage = reviewSourceLanguage(snapshot.compilation, snapshot.languageContext.detectedInputLanguage);
    const kind = reviewKind(snapshot.compilation);
    const needsTranslation = snapshot.brief.locale.split("-")[0] !== targetLanguage ||
      (kind === "clarification_review" && sourceLanguage.split("-")[0] !== targetLanguage);
    if (!textDirectionEnabled(this.capabilities, kind, sourceLanguage, targetLanguage) || !needsTranslation) return;
    const source = await this.repository.getPlanSource(callId);
    await this.requestPlanReview(callId, { ...source, targetLanguage });
  }

  async retry(callId: string, artifactId: string) {
    const artifact = await this.repository.getTextArtifact(callId, artifactId);
    if (!artifact) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_FOUND");
    if (artifact.status === "ready") return artifact;
    const snapshot = await this.repository.get(callId);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    const sourceLanguage = snapshot.compilation && ["plan_review", "clarification_review"].includes(artifact.kind)
      ? reviewSourceLanguage(snapshot.compilation, snapshot.languageContext?.detectedInputLanguage) : "*";
    this.#assertDirection(artifact.kind, sourceLanguage, artifact.targetLanguage);
    if (artifact.generatorVersion !== textGeneratorVersion(this.processor, artifact.kind)) throw new CallRepositoryError("TEXT_ARTIFACT_NOT_RETRYABLE");
    return this.repository.retryTextArtifact(callId, artifactId);
  }

  async process(job: DurableJob, baseLease: DurableJobLease) {
    if (!job.textArtifactId) throw new DurableJobExecutionError("DURABLE_JOB_TARGET_INVALID");
    const lease = () => ({ ...baseLease, generation: job.generation, attemptNumber: job.attemptCount, checkedAt: new Date().toISOString() });
    const artifact = await this.repository.claimTextArtifact(job.textArtifactId, lease());
    if (["ready", "stale", "cancelled"].includes(artifact.status)) return;
    try {
      const snapshot = await this.repository.get(artifact.callId);
      if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
      const sourceLanguage = snapshot.compilation && ["plan_review", "clarification_review"].includes(artifact.kind)
        ? reviewSourceLanguage(snapshot.compilation, snapshot.languageContext?.detectedInputLanguage) : "*";
      this.#assertDirection(artifact.kind, sourceLanguage, artifact.targetLanguage);
      if (artifact.generatorVersion !== textGeneratorVersion(this.processor, artifact.kind)) throw new DurableJobExecutionError("TEXT_GENERATOR_UNAVAILABLE", { retryable: false });
      const inputs = await this.#inputs(artifact);
      const completed = new Map((await this.repository.getTextArtifactChunks(artifact.id, lease())).map((chunk) => [chunk.index, chunk.payload]));
      const outputs: TextProcessingPayload[] = [];
      const needsCompaction = artifact.kind === "call_summary" && inputs.length > 1;
      // Job attempts bound each generation; this budget bounds all generations together.
      const requestLimit = textArtifactMaximumRequests;
      const runInput = async (input: TextProcessingInput, index: number, maximumRequests: number) => {
        if (completed.has(index)) {
          const cached = parsePayload(input.kind, completed.get(index));
          return input.kind === "call_summary" ? validateTextProcessingOutput(input, cached) : cached;
        }
        this.#assertDirection(artifact.kind, sourceLanguage, artifact.targetLanguage);
        const output = await this.processor.process(input, {
          maxProviderRequests: 1,
          beforeProviderRequest: (request) => {
            this.#assertDirection(artifact.kind, sourceLanguage, artifact.targetLanguage);
            return this.repository.reserveTextArtifactProviderRequest({
            id: request.clientRequestId, artifactId: artifact.id, provider: request.provider, operationType: request.operationType,
            stage: `${artifact.kind}.${index}`, requestedModel: request.model, clientRequestId: request.clientRequestId,
            startedAt: request.startedAt, maxRequests: maximumRequests, durableJobGeneration: job.generation
            }, lease());
          },
          afterProviderRequest: (result) => this.repository.completeProviderOperation({
            operationId: result.clientRequestId, outcome: result.outcome, providerRequestId: result.providerRequestId,
            providerResponseId: result.providerResponseId, providerModel: result.providerModel, statusCode: result.statusCode,
            completedAt: result.completedAt, durationMs: result.durationMs, usage: result.usage,
            errorCode: result.outcome === "succeeded" ? null : result.errorCode ?? "TEXT_PROVIDER_REQUEST_FAILED"
          })
        });
        await this.repository.saveTextArtifactChunk(artifact.id, index, output, lease());
        return output;
      };
      for (const [index, input] of inputs.entries()) {
        outputs.push(await runInput(input, index, requestLimit));
      }
      let payload = combinePayloads(artifact.kind, outputs, artifact.targetLanguage);
      if (needsCompaction && inputs[0]?.kind === "call_summary") {
        const extraction = callSummaryPayloadSchema.parse(payload);
        const evidenceIds = new Set([...extraction.findings, ...extraction.nextSteps].flatMap(item => item.sourceSegmentIds));
        const allSegments = inputs.flatMap(input => input.kind === "call_summary" ? input.segments : []);
        const compactInput: TextProcessingInput = { ...inputs[0], extraction, segments: allSegments.filter(segment => evidenceIds.has(segment.id)) };
        try {
          validateTextProcessingInput(compactInput);
          payload = await runInput(compactInput, inputs.length, requestLimit);
        } catch (error) {
          // A compact view is optional. Keep the evidenced current-format details on a bounded provider failure.
          if (!(error instanceof TextProcessingError)) throw error;
          payload = extraction;
          await this.repository.saveTextArtifactChunk(artifact.id, inputs.length, extraction, lease());
        }
      }
      await this.repository.completeTextArtifact(artifact.id, payload, lease());
    } catch (error) {
      const code = error instanceof TextProcessingError || error instanceof DurableJobExecutionError || error instanceof CallRepositoryError || error instanceof TextArtifactServiceError ? error.code : "TEXT_ARTIFACT_GENERATION_FAILED";
      await this.repository.failTextArtifact(artifact.id, code, lease()).catch(() => undefined);
      throw new DurableJobExecutionError(code, { cause: error, retryAfterMs: error instanceof TextProcessingError ? error.retryAfterMs : undefined,
        retryable: error instanceof TextProcessingError ? error.retryable :
        error instanceof DurableJobExecutionError ? error.retryable : !(error instanceof CallRepositoryError) && !(error instanceof TextArtifactServiceError) });
    }
  }

  async #inputs(artifact: CallTextArtifact): Promise<TextProcessingInput[]> {
    if (artifact.kind === "plan_review" || artifact.kind === "clarification_review") {
      if (!artifact.compilationId) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
      const compilation = await this.repository.getTextArtifactSourceCompilation(artifact.callId, artifact.compilationId);
      if (!compilation || compilation.snapshotHash !== artifact.sourceHash) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
      return chunkBySize(planReviewFields(compilation)).map((fields) => ({ kind: artifact.kind as "plan_review" | "clarification_review", targetLanguage: artifact.targetLanguage, fields }));
    }
    if (!artifact.transcriptRevisionId) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    const source = await this.repository.getTranscriptRevision(artifact.callId, artifact.transcriptRevisionId);
    if (!source || source.sourceHash !== artifact.sourceHash) throw new CallRepositoryError("TEXT_ARTIFACT_STALE");
    if (artifact.kind === "transcript_translation") return chunkBySize(source.segments).map((segments) => ({ kind: "transcript_translation", targetLanguage: artifact.targetLanguage, segments }));
    const compilation = artifact.compilationId ? await this.repository.getTextArtifactSourceCompilation(artifact.callId, artifact.compilationId) : null;
    if (!compilation?.compiledBrief) throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
    return chunkBySize(source.segments).map(segments => summaryInput(compilation, segments, artifact.targetLanguage));
  }

  async #find(callId: string, kind: TextArtifactKind, compilationId: string | null, transcriptRevisionId: string | null, sourceHash: string, targetLanguage: TextLanguage) {
    return (await this.repository.listTextArtifacts(callId)).find((item) => item.kind === kind && item.compilationId === compilationId &&
      item.transcriptRevisionId === transcriptRevisionId && item.sourceHash === sourceHash && item.targetLanguage === targetLanguage && item.generatorVersion === textGeneratorVersion(this.processor, kind) && !["stale", "cancelled"].includes(item.status));
  }
  #assertDirection(kind: TextArtifactKind, sourceLanguage: string, targetLanguage: TextLanguage) {
    if (!this.capabilities.enabled) throw new TextArtifactServiceError("TEXT_GENERATION_DISABLED");
    if (!textDirectionEnabled(this.capabilities, kind, sourceLanguage, targetLanguage)) throw new TextArtifactServiceError("TEXT_DIRECTION_UNSUPPORTED");
  }
}

function reviewKind(compilation: CallCompilation): "plan_review" | "clarification_review" {
  return compilation.compiledBrief && compilation.policyDecision.status === "ready_for_review" ? "plan_review" : "clarification_review";
}

function reviewSourceLanguage(compilation: CallCompilation, detectedInputLanguage?: string | null) {
  return reviewKind(compilation) === "clarification_review"
    ? compilation.compiledBrief?.sourceLanguage ?? detectedInputLanguage ?? "*"
    : compilation.rawBrief.locale;
}

export function chunkBySize<T extends { id: string; text: string }>(items: T[]): T[][] {
  const chunks: T[][] = []; let current: T[] = []; let size = 0;
  for (const item of items) {
    const length = item.id.length + item.text.length;
    if (length > 28_000) throw new TextProcessingError("TEXT_INPUT_TOO_LARGE");
    if (current.length && (size + length > 28_000 || current.length >= 250)) { chunks.push(current); current = []; size = 0; }
    current.push(item); size += length;
  }
  if (current.length || !chunks.length) chunks.push(current);
  if (chunks.length > 8) throw new TextProcessingError("TEXT_INPUT_TOO_LARGE");
  return chunks;
}

function parsePayload(kind: TextArtifactKind, payload: unknown): TextProcessingPayload {
  return kind === "call_summary" ? callSummaryPayloadSchema.parse(payload) : kind === "transcript_translation" ? transcriptTranslationPayloadSchema.parse(payload) : planReviewPayloadSchema.parse(payload);
}

export function combinePayloads(kind: TextArtifactKind, outputs: TextProcessingPayload[], language: TextLanguage): TextProcessingPayload {
  if (kind === "plan_review" || kind === "clarification_review") return { fields: outputs.flatMap((output) => (output as PlanReviewPayload).fields) };
  if (kind === "transcript_translation") {
    const segments = outputs.flatMap((output) => transcriptTranslationPayloadSchema.parse(output).segments);
    return { segments, text: segments.map((segment) => segment.text).join("\n") };
  }
  const summaries = outputs.map((output) => callSummaryPayloadSchema.parse(output));
  if (!summaries.length || summaries.some(summary => summary.findings.length !== summaries[0]!.findings.length)) throw new TextProcessingError("TEXT_RESPONSE_INVALID");
  if (summaries.length === 1) return summaries[0]!;
  const findings = summaries[0]!.findings.map((first, index) => {
    const candidates = summaries.map(summary => summary.findings[index]);
    if (candidates.some(finding => !finding || finding.id !== first.id)) throw new TextProcessingError("TEXT_RESPONSE_INVALID");
    const present = candidates as CallSummaryPayload["findings"];
    const reported = present.filter(finding => finding.certainty !== "unknown");
    const unique = new Set(reported.map(finding => `${finding.certainty}:${finding.text.trim()}`));
    if (unique.size === 1 && !present.some(finding => finding.certainty === "unknown" && finding.sourceSegmentIds.length)) {
      return { ...reported[0]!, sourceSegmentIds: [...new Set(reported.flatMap((answer) => answer.sourceSegmentIds))].slice(0, 30) };
    }
    if (unique.size === 0) {
      const sourceSegmentIds = [...new Set(present.flatMap(finding => finding.sourceSegmentIds))].slice(0, 30);
      return { ...first, text: sourceSegmentIds.length && new Set(present.map(finding => finding.text)).size > 1 ? multiPartUncertainty[language] : first.text, sourceSegmentIds };
    }
    return { ...first, text: multiPartUncertainty[language], certainty: "unknown" as const,
      sourceSegmentIds: [...new Set(present.flatMap(finding => finding.sourceSegmentIds))].slice(0, 30) };
  });
  const unresolvedAnswers = findings.some((finding, index) => finding.certainty === "unknown" && summaries.some(summary => summary.findings[index]?.certainty !== "unknown"));
  const mergedSteps = new Map<string, CallSummaryPayload["nextSteps"][number]>();
  for (const step of summaries.flatMap((summary) => summary.nextSteps)) {
    const prior = mergedSteps.get(step.text.trim());
    mergedSteps.set(step.text.trim(), { text: step.text, sourceSegmentIds: [...new Set([...(prior?.sourceSegmentIds ?? []), ...step.sourceSegmentIds])].slice(0, 30) });
  }
  // Keep cited steps where the chunk answers agree; conflicting evidence stays explicitly unresolved.
  return { schemaVersion: 2, overview: [], findings, nextSteps: unresolvedAnswers ? [] : [...mergedSteps.values()].slice(0, 30),
    unresolved: [...new Set([...summaries.flatMap((summary) => summary.unresolved), ...(unresolvedAnswers ? [multiPartUncertainty[language]] : [])])].slice(0, 30) } satisfies CallSummaryPayload;
}

const multiPartUncertainty: Record<TextLanguage, string> = {
  en: "The transcript spans several parts. Review the cited original passages to resolve differences and confirm next steps.",
  de: "Das Transkript umfasst mehrere Teile. Prüfen Sie die zitierten Originalstellen, um Unterschiede zu klären und nächste Schritte zu bestätigen.",
  fr: "La transcription comprend plusieurs parties. Consultez les passages originaux cités pour clarifier les différences et confirmer les prochaines étapes.",
  it: "La trascrizione comprende più parti. Consulta i passaggi originali citati per chiarire le differenze e confermare i prossimi passi.",
  ru: "Расшифровка состоит из нескольких частей. Проверьте приведённые фрагменты оригинала, чтобы уточнить различия и подтвердить следующие шаги.",
  uk: "Розшифровка складається з кількох частин. Перевірте наведені фрагменти оригіналу, щоб уточнити відмінності й підтвердити наступні кроки."
};
