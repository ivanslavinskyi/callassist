import type {
  CallSummaryPayload,
  CallAssessmentDecision,
  PlanReviewPayload,
  SourceSegment,
  TextArtifactKind,
  TextLanguage,
  TranscriptTranslationPayload
} from "@callassist/contracts";
import type { SummarySourceContext } from "@callassist/contracts";
import type { OpenAITextTokenUsage } from "../brief-compiler/brief-compiler";
import { MockTextProcessor } from "./mock-text-processor";
import { OpenAITextProcessor } from "./openai-text-processor";

export const TEXT_PROCESSOR_VERSION = "text-processing-v2";
export const SUMMARY_PROCESSOR_VERSION = "summary-v4";
export const MAX_TEXT_PROCESSING_SOURCE_CHARACTERS = 60_000;

export type TextProcessingInput = (
  | { kind: "plan_review"; fields: Array<{ id: string; text: string }> }
  | { kind: "clarification_review"; fields: Array<{ id: string; text: string }> }
  | { kind: "transcript_translation"; segments: SourceSegment[] }
  | { kind: "call_summary"; segments: SourceSegment[]; checks: Array<{ id: string; text: string }>;
      context: { objective: string; taskType: string; recipient: string; representedPerson: string };
      sourceContext?: SummarySourceContext;
      extraction?: CallSummaryPayload;
      applicationFacts?: { transcriptPersisted: true; resultHandling: "capture_in_callassist" | "request_external_delivery" | "message_only" };
      assessmentMode?: "evaluate" | "preserve"; fixedAssessment?: CallAssessmentDecision }
) & { targetLanguage: TextLanguage };

export type TextProcessingPayload = PlanReviewPayload | TranscriptTranslationPayload | CallSummaryPayload;
export type TextProcessingProviderRequest = {
  clientRequestId: string;
  kind: TextArtifactKind;
  operationType: "text_translation" | "call_summary";
  provider: "openai";
  model: string;
  startedAt: string;
};
export type TextProcessingProviderRequestResult = {
  clientRequestId: string;
  kind: TextArtifactKind;
  outcome: "succeeded" | "provider_error" | "network_error" | "invalid_response";
  providerRequestId: string | null;
  providerResponseId: string | null;
  providerModel: string | null;
  statusCode: number | null;
  completedAt: string;
  durationMs: number;
  usage: OpenAITextTokenUsage | null;
  errorCode?: TextProcessingError["code"] | null;
  validationCode?: string;
};
export type TextProcessingRunOptions = {
  maxProviderRequests?: number;
  signal?: AbortSignal;
  beforeProviderRequest?: (request: TextProcessingProviderRequest) => Promise<boolean>;
  afterProviderRequest?: (result: TextProcessingProviderRequestResult) => Promise<void>;
};

export interface TextProcessor {
  readonly driver: "mock" | "openai";
  readonly model: string;
  readonly generatorVersion: string;
  process(input: TextProcessingInput, options?: TextProcessingRunOptions): Promise<TextProcessingPayload>;
}

/** Summary changes must not invalidate queued translations or their reusable chunks. */
export function textGeneratorVersion(processor: Pick<TextProcessor, "generatorVersion">, kind: TextArtifactKind) {
  return kind === "call_summary" ? `${SUMMARY_PROCESSOR_VERSION}:grounded-v3:${processor.generatorVersion}` : processor.generatorVersion;
}

export class TextProcessingError extends Error {
  readonly retryAfterMs?: number;
  get retryable() {
    return ["TEXT_REQUEST_FAILED", "TEXT_REQUEST_TIMEOUT", "TEXT_PROVIDER_UNAVAILABLE", "TEXT_RATE_LIMITED", "TEXT_RESPONSE_INVALID"].includes(this.code);
  }
  constructor(
    readonly code:
      | "TEXT_INPUT_INVALID"
      | "TEXT_INPUT_TOO_LARGE"
      | "TEXT_REQUEST_BUDGET_EXHAUSTED"
      | "TEXT_REQUEST_FAILED"
      | "TEXT_REQUEST_TIMEOUT"
      | "TEXT_REQUEST_CANCELLED"
      | "TEXT_PROVIDER_UNAVAILABLE"
      | "TEXT_RATE_LIMITED"
      | "TEXT_REQUEST_REJECTED"
      | "TEXT_RESPONSE_INVALID",
    options?: { cause?: unknown; retryAfterMs?: number }
  ) {
    super(code, options);
    this.name = "TextProcessingError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class TextValidationError extends TextProcessingError {
  constructor(readonly validationCode: "TEXT_INVALID_SCHEMA" | "TEXT_INVALID_ASSESSMENT" | "TEXT_INVALID_FIXED_ASSESSMENT" | "TEXT_INVALID_REFERENCES" | "TEXT_INVALID_GROUNDING") {
    super("TEXT_RESPONSE_INVALID");
  }
}

export function createTextProcessorFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): TextProcessor {
  const driver = environment.TEXT_PROCESSOR_DRIVER?.trim() ||
    environment.BRIEF_COMPILER_DRIVER?.trim() || "mock";
  if (driver === "mock") return new MockTextProcessor();
  if (driver !== "openai") throw new Error(`Unsupported TEXT_PROCESSOR_DRIVER: ${driver}`);
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing required environment variable: OPENAI_API_KEY");
  const configuredTimeout = environment.TEXT_PROCESSOR_TIMEOUT_MS?.trim();
  const timeoutMs = configuredTimeout ? Number(configuredTimeout) : undefined;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)) {
    throw new Error("TEXT_PROCESSOR_TIMEOUT_MS must be an integer between 1 and 120000");
  }
  return new OpenAITextProcessor({
    apiKey,
    model: environment.TEXT_PROCESSOR_MODEL?.trim() || environment.OPENAI_BRIEF_COMPILER_MODEL,
    timeoutMs,
    summaryTimeoutMs: environment.TEXT_SUMMARY_TIMEOUT_MS?.trim() ? Number(environment.TEXT_SUMMARY_TIMEOUT_MS) : undefined
  });
}
