import type {
  CallSummaryPayload,
  PlanReviewPayload,
  SourceSegment,
  TextArtifactKind,
  TextLanguage,
  TranscriptTranslationPayload
} from "@callassist/contracts";
import type { OpenAITextTokenUsage } from "../brief-compiler/brief-compiler";
import { MockTextProcessor } from "./mock-text-processor";
import { OpenAITextProcessor } from "./openai-text-processor";

export const TEXT_PROCESSOR_VERSION = "text-processing-v1";
export const MAX_TEXT_PROCESSING_SOURCE_CHARACTERS = 60_000;

export type TextProcessingInput = (
  | { kind: "plan_review"; fields: Array<{ id: string; text: string }> }
  | { kind: "clarification_review"; fields: Array<{ id: string; text: string }> }
  | { kind: "transcript_translation"; segments: SourceSegment[] }
  | { kind: "call_summary"; segments: SourceSegment[]; questions: string[] }
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

export class TextProcessingError extends Error {
  constructor(
    readonly code:
      | "TEXT_INPUT_INVALID"
      | "TEXT_INPUT_TOO_LARGE"
      | "TEXT_REQUEST_BUDGET_EXHAUSTED"
      | "TEXT_REQUEST_FAILED"
      | "TEXT_RESPONSE_INVALID",
    options?: { cause?: unknown }
  ) {
    super(code, options);
    this.name = "TextProcessingError";
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
    timeoutMs
  });
}
