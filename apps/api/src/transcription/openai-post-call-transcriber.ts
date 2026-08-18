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

export interface PostCallTranscriber {
  readonly model: string;
  transcribe(
    media: RecordingMedia,
    brief: CallBrief,
    liveTranscript?: TranscriptSegment[],
    timing?: FinalTranscriptTiming
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
    timing?: FinalTranscriptTiming
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
        this.#fullRecordingModel
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
          brief
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
          previousAssistant
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
    previousAssistant?: string
  ) {
    return {
      utterance,
      text: await this.#transcribeAudio(
        utterance.wavBytes,
        "audio/wav",
        `utterance-${String(index + 1).padStart(3, "0")}.wav`,
        brief,
        buildUtteranceTranscriptionPrompt(brief, utterance, previousAssistant),
        this.#utteranceModel
      )
    };
  }

  async #transcribeAudio(
    bytes: Uint8Array,
    contentType: string,
    fileName: string,
    brief: CallBrief,
    prompt: string,
    model = this.model
  ) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes).buffer], { type: contentType }),
      fileName
    );
    form.append("model", model);
    form.append("prompt", prompt);
    if (model.startsWith("gpt-4o-")) {
      form.append("language", brief.locale.split("-")[0]);
    } else {
      for (const keyword of buildPostCallTranscriptionKeywords(brief)) {
        form.append("keywords[]", keyword);
      }
      for (const language of buildPostCallTranscriptionLanguages(brief)) {
        form.append("languages[]", language);
      }
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        body: form,
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new PostCallTranscriptionError("OPENAI_REQUEST_FAILED", {
        cause: error
      });
    }
    if (!response.ok) {
      throw new PostCallTranscriptionError("OPENAI_REQUEST_FAILED");
    }
    const payload = (await response.json().catch(() => null)) as
      | { text?: unknown }
      | null;
    if (!payload || typeof payload.text !== "string") {
      throw new PostCallTranscriptionError("OPENAI_RESPONSE_INVALID");
    }
    return payload.text.trim();
  }
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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await map(values[index], index);
      }
    })
  );
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
