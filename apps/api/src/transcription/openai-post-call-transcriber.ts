import type {
  CallBrief,
  FinalTranscriptSegment,
  TranscriptSegment
} from "@callassist/contracts";
import type { RecordingMedia } from "../telephony/telephony-provider";
import {
  structureFinalTranscript,
  type FinalTranscriptTiming
} from "./final-transcript-structure";

const maximumUploadBytes = 25 * 1024 * 1024;
const maximumPromptCharacters = 6_000;
const maximumContextCharacters = 1_500;
const maximumKeywords = 24;
const maximumKeywordCharacters = 80;

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

  constructor(options: OpenAIPostCallTranscriberOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model?.trim() || "gpt-transcribe";
    this.#endpoint =
      options.endpoint?.trim() ||
      "https://api.openai.com/v1/audio/transcriptions";
    this.#timeoutMs = options.timeoutMs ?? 180_000;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async transcribe(
    media: RecordingMedia,
    brief: CallBrief,
    liveTranscript: TranscriptSegment[] = [],
    timing?: FinalTranscriptTiming
  ) {
    if (media.bytes.byteLength === 0) {
      throw new PostCallTranscriptionError("AUDIO_EMPTY");
    }
    if (media.bytes.byteLength > maximumUploadBytes) {
      throw new PostCallTranscriptionError("AUDIO_TOO_LARGE");
    }

    const form = new FormData();
    const bytes = new Uint8Array(media.bytes).buffer;
    form.append(
      "file",
      new Blob([bytes], { type: media.contentType }),
      media.fileName
    );
    form.append("model", this.model);
    form.append("prompt", buildPostCallTranscriptionPrompt(brief));
    for (const keyword of buildPostCallTranscriptionKeywords(brief)) {
      form.append("keywords[]", keyword);
    }
    for (const language of buildPostCallTranscriptionLanguages(brief)) {
      form.append("languages[]", language);
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
    const text = payload.text.trim();
    if (!text) throw new PostCallTranscriptionError("AUDIO_EMPTY");

    return {
      text,
      segments: timing
        ? structureFinalTranscript(text, liveTranscript, timing)
        : [],
      model: this.model
    };
  }
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
