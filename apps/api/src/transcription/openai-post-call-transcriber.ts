import { createHash, randomUUID } from "node:crypto";
import type {
  CallBrief,
  FinalTranscriptSegment,
  TranscriptSegment
} from "@callassist/contracts";
import type { RecordingMedia } from "../telephony/telephony-provider";
import type { FinalTranscriptTiming } from "./final-transcript-structure";
import {
  extractChannelUtterances,
  mergeChannelTranscriptSegments,
  type ChannelUtterance
} from "./channel-aware-audio";

const maximumUploadBytes = 25 * 1024 * 1024;
const maximumPromptCharacters = 6_000;
const maximumContextCharacters = 1_500;
const maximumKeywords = 24;
const maximumKeywordCharacters = 80;
const transcriptionConcurrency = 4;

export type PostCallTranscriptionResult = {
  text: string;
  segments: FinalTranscriptSegment[];
  model: string;
};

export type PostCallTranscriptionProviderStage =
  | "full_recording"
  | "assistant_utterance"
  | "recipient_utterance";

export type PostCallTranscriptionChunk = {
  stage: PostCallTranscriptionProviderStage;
  chunkKey: string;
  inputFingerprint: string;
  model: string;
};

export type PostCallTranscriptionProviderRequest =
  PostCallTranscriptionChunk & {
    clientRequestId: string;
    startedAt: string;
  };

export type PostCallTranscriptionProviderUsage = {
  requestCount: 1;
  inputTextTokens: number | null;
  cachedInputTextTokens: null;
  cacheWriteInputTextTokens: null;
  outputTextTokens: number | null;
  reasoningOutputTokens: null;
  inputAudioTokens: number | null;
  cachedInputAudioTokens: null;
  outputAudioTokens: null;
  totalTokens: number | null;
  durationSeconds: number | null;
  billableSeconds: null;
  rawUsage: Record<string, unknown>;
};

export type PostCallTranscriptionProviderResult = {
  clientRequestId: string;
  stage: PostCallTranscriptionProviderStage;
  chunkKey: string;
  inputFingerprint: string;
  outcome: "succeeded" | "provider_error" | "network_error" | "invalid_response";
  providerRequestId: string | null;
  providerResponseId: null;
  providerModel: null;
  statusCode: number | null;
  completedAt: string;
  durationMs: number;
  usage: PostCallTranscriptionProviderUsage | null;
  transcriptText: string | null;
};

export type PostCallTranscriptionRuntime = {
  findCompletedChunk?: (
    chunk: PostCallTranscriptionChunk
  ) => Promise<string | null>;
  beforeProviderRequest?: (
    request: PostCallTranscriptionProviderRequest
  ) => Promise<void>;
  afterProviderRequest?: (
    result: PostCallTranscriptionProviderResult
  ) => Promise<void>;
};

export interface PostCallTranscriber {
  readonly model: string;
  transcribe(
    media: RecordingMedia,
    brief: CallBrief,
    liveTranscript?: TranscriptSegment[],
    timing?: FinalTranscriptTiming,
    runtime?: PostCallTranscriptionRuntime
  ): Promise<PostCallTranscriptionResult>;
}

export class PostCallTranscriptionError extends Error {
  constructor(
    readonly code:
      | "AUDIO_EMPTY"
      | "AUDIO_TOO_LARGE"
      | "OPENAI_REQUEST_FAILED"
      | "OPENAI_RESPONSE_INVALID",
    options?: { cause?: unknown }
  ) {
    super(code, options);
    this.name = "PostCallTranscriptionError";
  }
}

type OpenAIPostCallTranscriberOptions = {
  apiKey: string;
  model?: string;
  utteranceModel?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
};

export class OpenAIPostCallTranscriber implements PostCallTranscriber {
  readonly model: string;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #fullRecordingModel: string;
  readonly #utteranceModel: string;

  constructor(options: OpenAIPostCallTranscriberOptions) {
    this.#apiKey = options.apiKey;
    this.#fullRecordingModel = options.model?.trim() || "gpt-transcribe";
    this.#utteranceModel =
      options.utteranceModel?.trim() || this.#fullRecordingModel;
    // Dual-channel utterance transcription is the normal production path and
    // therefore the model persisted with the final transcript job.
    this.model = this.#utteranceModel;
    this.#endpoint =
      options.endpoint?.trim() ||
      "https://api.openai.com/v1/audio/transcriptions";
    this.#timeoutMs = options.timeoutMs ?? 180_000;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async transcribe(
    media: RecordingMedia,
    brief: CallBrief,
    _liveTranscript: TranscriptSegment[] = [],
    timing?: FinalTranscriptTiming,
    runtime: PostCallTranscriptionRuntime = {}
  ) {
    if (media.bytes.byteLength === 0) {
      throw new PostCallTranscriptionError("AUDIO_EMPTY");
    }
    if (media.bytes.byteLength > maximumUploadBytes) {
      throw new PostCallTranscriptionError("AUDIO_TOO_LARGE");
    }

    const utterances = media.channels === 2
      ? safelyExtractChannelUtterances(media.bytes)
      : [];
    if (utterances.length === 0) {
      const text = await this.#transcribeAudio(
        media.bytes,
        media.contentType,
        media.fileName,
        brief,
        buildPostCallTranscriptionPrompt(brief),
        this.#fullRecordingModel,
        "full_recording",
        "full_recording",
        runtime
      );
      if (!text) throw new PostCallTranscriptionError("AUDIO_EMPTY");
      return { text, segments: [], model: this.#fullRecordingModel };
    }

    const recognized = new Array<{ utterance: ChannelUtterance; text: string }>(
      utterances.length
    );
    const assistantIndexes = utterances
      .map((utterance, index) => ({ utterance, index }))
      .filter(({ utterance }) => utterance.role === "assistant")
      .map(({ index }) => index);
    await mapWithConcurrency(
      assistantIndexes,
      transcriptionConcurrency,
      async (index) => {
        recognized[index] = await this.#transcribeUtterance(
          utterances[index],
          index,
          brief,
          undefined,
          runtime
        );
      }
    );
    const recipientIndexes = utterances
      .map((utterance, index) => ({ utterance, index }))
      .filter(({ utterance }) => utterance.role === "recipient")
      .map(({ index }) => index);
    await mapWithConcurrency(
      recipientIndexes,
      transcriptionConcurrency,
      async (index) => {
        const previousAssistant = findPreviousAssistantText(recognized, index);
        recognized[index] = await this.#transcribeUtterance(
          utterances[index],
          index,
          brief,
          previousAssistant,
          runtime
        );
      }
    );
    if (recognized.some(({ text }) => !text)) {
      throw new PostCallTranscriptionError("AUDIO_EMPTY");
    }
    const segments = mergeChannelTranscriptSegments(
      recognized.map(({ utterance, text }) => ({
        role: utterance.role,
        text,
        startSeconds: clampTime(utterance.startSeconds, timing),
        endSeconds: clampTime(utterance.endSeconds, timing)
      }))
    );
    if (segments.length === 0) {
      throw new PostCallTranscriptionError("AUDIO_EMPTY");
    }
    return {
      text: segments.map((segment) => segment.text).join(" "),
      segments,
      model: this.model
    };
  }

  async #transcribeUtterance(
    utterance: ChannelUtterance,
    index: number,
    brief: CallBrief,
    previousAssistant?: string,
    runtime: PostCallTranscriptionRuntime = {}
  ) {
    return {
      utterance,
      text: await this.#transcribeAudio(
        utterance.wavBytes,
        "audio/wav",
        `utterance-${String(index + 1).padStart(3, "0")}.wav`,
        brief,
        buildUtteranceTranscriptionPrompt(brief, utterance, previousAssistant),
        this.#utteranceModel,
        utterance.role === "assistant"
          ? "assistant_utterance"
          : "recipient_utterance",
        `utterance_${String(index + 1).padStart(3, "0")}`,
        runtime
      )
    };
  }

  async #transcribeAudio(
    bytes: Uint8Array,
    contentType: string,
    fileName: string,
    brief: CallBrief,
    prompt: string,
    model = this.model,
    stage: PostCallTranscriptionProviderStage,
    chunkKey: string,
    runtime: PostCallTranscriptionRuntime
  ) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes).buffer], { type: contentType }),
      fileName
    );
    form.append("model", model);
    form.append("prompt", prompt);
    const language = model.startsWith("gpt-4o-")
      ? brief.locale.split("-")[0]
      : null;
    const keywords = language ? [] : buildPostCallTranscriptionKeywords(brief);
    const languages = language ? [] : buildPostCallTranscriptionLanguages(brief);
    if (language) {
      form.append("language", language);
    } else {
      for (const keyword of keywords) {
        form.append("keywords[]", keyword);
      }
      for (const requestedLanguage of languages) {
        form.append("languages[]", requestedLanguage);
      }
    }

    const inputFingerprint = createTranscriptionInputFingerprint({
      bytes,
      contentType,
      prompt,
      model,
      stage,
      chunkKey,
      language,
      keywords,
      languages
    });
    const cached = await runtime.findCompletedChunk?.({
      stage,
      chunkKey,
      inputFingerprint,
      model
    });
    if (cached !== undefined && cached !== null) return cached;

    const clientRequestId = randomUUID();
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    await runtime.beforeProviderRequest?.({
      clientRequestId,
      stage,
      chunkKey,
      inputFingerprint,
      model,
      startedAt
    });

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        body: form,
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      await reportProviderResult(runtime, {
        clientRequestId,
        stage,
        chunkKey,
        inputFingerprint,
        outcome: "network_error",
        providerRequestId: null,
        statusCode: null,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        usage: null,
        transcriptText: null
      });
      throw new PostCallTranscriptionError("OPENAI_REQUEST_FAILED", {
        cause: error
      });
    }
    const providerRequestId = response.headers.get("x-request-id");
    if (!response.ok) {
      await reportProviderResult(runtime, {
        clientRequestId,
        stage,
        chunkKey,
        inputFingerprint,
        outcome: "provider_error",
        providerRequestId,
        statusCode: response.status,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        usage: null,
        transcriptText: null
      });
      throw new PostCallTranscriptionError("OPENAI_REQUEST_FAILED");
    }
    const payload = (await response.json().catch(() => null)) as
      | { text?: unknown; usage?: unknown }
      | null;
    const usage = parsePostCallTranscriptionUsage(payload?.usage);
    if (!payload || typeof payload.text !== "string") {
      await reportProviderResult(runtime, {
        clientRequestId,
        stage,
        chunkKey,
        inputFingerprint,
        outcome: "invalid_response",
        providerRequestId,
        statusCode: response.status,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        usage,
        transcriptText: null
      });
      throw new PostCallTranscriptionError("OPENAI_RESPONSE_INVALID");
    }
    const transcriptText = payload.text.trim();
    await reportProviderResult(runtime, {
      clientRequestId,
      stage,
      chunkKey,
      inputFingerprint,
      outcome: "succeeded",
      providerRequestId,
      statusCode: response.status,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      usage,
      transcriptText: transcriptText || null
    });
    return transcriptText;
  }
}

function createTranscriptionInputFingerprint(input: {
  bytes: Uint8Array;
  contentType: string;
  prompt: string;
  model: string;
  stage: PostCallTranscriptionProviderStage;
  chunkKey: string;
  language: string | null;
  keywords: string[];
  languages: string[];
}) {
  const hash = createHash("sha256");
  hash.update(input.bytes);
  hash.update("\0");
  hash.update(JSON.stringify({
    contentType: input.contentType,
    prompt: input.prompt,
    model: input.model,
    stage: input.stage,
    chunkKey: input.chunkKey,
    language: input.language,
    keywords: input.keywords,
    languages: input.languages
  }));
  return hash.digest("hex");
}

async function reportProviderResult(
  runtime: PostCallTranscriptionRuntime,
  result: Omit<
    PostCallTranscriptionProviderResult,
    "providerResponseId" | "providerModel"
  >
) {
  await runtime.afterProviderRequest?.({
    ...result,
    providerResponseId: null,
    providerModel: null
  });
}

export function parsePostCallTranscriptionUsage(
  raw: unknown
): PostCallTranscriptionProviderUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  if (usage.type === "duration") {
    const seconds = nonNegativeNumber(usage.seconds);
    if (seconds === null) return null;
    return {
      requestCount: 1,
      inputTextTokens: null,
      cachedInputTextTokens: null,
      cacheWriteInputTextTokens: null,
      outputTextTokens: null,
      reasoningOutputTokens: null,
      inputAudioTokens: null,
      cachedInputAudioTokens: null,
      outputAudioTokens: null,
      totalTokens: null,
      durationSeconds: seconds,
      billableSeconds: null,
      rawUsage: { type: "duration", seconds }
    };
  }
  if (usage.type !== "tokens") return null;
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const totalTokens = nonNegativeInteger(usage.total_tokens);
  const details = usage.input_token_details &&
      typeof usage.input_token_details === "object"
    ? usage.input_token_details as Record<string, unknown>
    : null;
  const textTokens = nonNegativeInteger(details?.text_tokens);
  const audioTokens = nonNegativeInteger(details?.audio_tokens);
  if (
    [usage.input_tokens, usage.output_tokens, usage.total_tokens]
      .some((value, index) => value != null &&
        [inputTokens, outputTokens, totalTokens][index] === null) ||
    [details?.text_tokens, details?.audio_tokens]
      .some((value, index) => value != null &&
        [textTokens, audioTokens][index] === null)
  ) {
    return null;
  }
  if (
    inputTokens === null && outputTokens === null && totalTokens === null &&
    textTokens === null && audioTokens === null
  ) {
    return null;
  }
  return {
    requestCount: 1,
    inputTextTokens: textTokens,
    cachedInputTextTokens: null,
    cacheWriteInputTextTokens: null,
    outputTextTokens: outputTokens,
    reasoningOutputTokens: null,
    inputAudioTokens: audioTokens,
    cachedInputAudioTokens: null,
    outputAudioTokens: null,
    totalTokens,
    durationSeconds: null,
    billableSeconds: null,
    rawUsage: {
      type: "tokens",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      input_token_details: {
        text_tokens: textTokens,
        audio_tokens: audioTokens
      }
    }
  };
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function safelyExtractChannelUtterances(bytes: Uint8Array) {
  try {
    return extractChannelUtterances(bytes);
  } catch {
    return [];
  }
}

function buildUtteranceTranscriptionPrompt(
  brief: CallBrief,
  utterance: ChannelUtterance,
  previousAssistant?: string
) {
  const context = previousAssistant
    ? ` The preceding AI assistant utterance was: "${sanitizePromptText(previousAssistant, 500)}". This is context only and is not proof of the words in the attached audio.`
    : "";
  return `${buildPostCallTranscriptionPrompt(brief)} This file contains one isolated ${utterance.role} utterance from that conversation.${context} Transcribe only speech audible in this file.`
    .slice(0, maximumPromptCharacters);
}

function findPreviousAssistantText(
  recognized: Array<{ utterance: ChannelUtterance; text: string } | undefined>,
  beforeIndex: number
) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (recognized[index]?.utterance.role === "assistant") {
      return recognized[index]!.text;
    }
  }
  return undefined;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await map(values[index], index);
      }
    })
  );
  const failed = workers.find(
    (worker): worker is PromiseRejectedResult => worker.status === "rejected"
  );
  if (failed) throw failed.reason;
  return results;
}

function clampTime(value: number, timing?: FinalTranscriptTiming) {
  const duration = timing?.durationSeconds;
  const clamped =
    duration && duration > 0
      ? Math.min(duration, Math.max(0, value))
      : Math.max(0, value);
  return Math.round(clamped * 100) / 100;
}

export function buildPostCallTranscriptionPrompt(brief: CallBrief) {
  const context = sanitizePromptText(brief.context, maximumContextCharacters);
  const prompt = [
    "This audio is the complete consented recording of one telephone conversation. Transcribe every audible utterance faithfully and in chronological order.",
    "Do not translate, add, infer, reconstruct, complete, or summarise unclear speech. Omit speech that is not intelligible.",
    languageInstruction(brief),
    `Use ${preferredWritingSystem(brief)}. Do not render speech phonetically in another alphabet.`,
    "Preserve short replies, questions, names, dates, and numbers exactly as spoken.",
    "The metadata below is spelling context only and is not proof that a word was spoken.",
    `AI assistant: ${sanitizePromptText(brief.agentName, 160)}.`,
    `Represented person: ${sanitizePromptText(brief.representedPerson, 160)}.`,
    `Recipient or organisation: ${sanitizePromptText(brief.recipientName, 160)}.`,
    `Call objective: ${sanitizePromptText(brief.objective, 2_000)}.`,
    context ? `Background context: ${context}` : ""
  ]
    .filter(Boolean)
    .join(" ");
  return prompt.slice(0, maximumPromptCharacters);
}

export function buildPostCallTranscriptionKeywords(brief: CallBrief) {
  const candidates = [
    brief.agentName,
    brief.representedPerson,
    brief.recipientName,
    ...brief.allowedFacts
  ];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const candidate of candidates) {
    const keyword = sanitizePromptText(candidate, maximumKeywordCharacters);
    const normalized = keyword.toLocaleLowerCase("und");
    if (!keyword || seen.has(normalized)) continue;
    seen.add(normalized);
    keywords.push(keyword);
    if (keywords.length >= maximumKeywords) break;
  }
  return keywords;
}

export function buildPostCallTranscriptionLanguages(brief: CallBrief) {
  const languages = [brief.locale.split("-")[0]];
  if (brief.allowLanguageSwitch && brief.fallbackLocale) {
    languages.push(brief.fallbackLocale.split("-")[0]);
  }
  return [...new Set(languages)];
}

function languageInstruction(brief: CallBrief) {
  if (brief.allowLanguageSwitch && brief.fallbackLocale) {
    return `The primary call language is ${brief.locale}. The only permitted fallback language is ${brief.fallbackLocale}.`;
  }
  return `The call language is ${brief.locale}. No language switch is permitted.`;
}

function preferredWritingSystem(brief: CallBrief) {
  const languages = buildPostCallTranscriptionLanguages(brief);
  const usesLatin = languages.some((language) =>
    ["de", "en", "fr", "it"].includes(language)
  );
  const usesCyrillic = languages.some((language) =>
    ["ru", "uk"].includes(language)
  );
  if (usesLatin && usesCyrillic) {
    return "the conventional Latin or Cyrillic writing system of the language actually spoken";
  }
  if (usesCyrillic) return "the Cyrillic alphabet";
  if (usesLatin) return "the Latin alphabet";
  return "the conventional writing system of the selected call language";
}

function sanitizePromptText(value: string, maximum: number) {
  return value
    .replace(/[<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}
