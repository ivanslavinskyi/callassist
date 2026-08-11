import type {
  CallBrief,
  FinalTranscriptSegment,
  TranscriptSegment
} from "@callassist/contracts";
import type { RecordingMedia } from "../telephony/telephony-provider";
import {
  FfmpegRecordingAudioSegmenter,
  type ChannelAudioSegment,
  type RecordingAudioSegmenter
} from "./ffmpeg-audio-segmenter";

const maximumUploadBytes = 25 * 1024 * 1024;
const maximumPromptCharacters = 3_000;
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
    liveTranscript?: TranscriptSegment[]
  ): Promise<PostCallTranscriptionResult>;
}

export class PostCallTranscriptionError extends Error {
  constructor(
    readonly code:
      | "AUDIO_EMPTY"
      | "AUDIO_TOO_LARGE"
      | "AUDIO_SEGMENTATION_FAILED"
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
  audioSegmenter?: RecordingAudioSegmenter;
};

export class OpenAIPostCallTranscriber implements PostCallTranscriber {
  readonly model: string;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #audioSegmenter: RecordingAudioSegmenter;

  constructor(options: OpenAIPostCallTranscriberOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model?.trim() || "gpt-transcribe";
    this.#endpoint =
      options.endpoint?.trim() ||
      "https://api.openai.com/v1/audio/transcriptions";
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#audioSegmenter =
      options.audioSegmenter ?? new FfmpegRecordingAudioSegmenter();
  }

  async transcribe(
    media: RecordingMedia,
    brief: CallBrief,
    liveTranscript: TranscriptSegment[] = []
  ) {
    if (media.bytes.byteLength === 0) {
      throw new PostCallTranscriptionError("AUDIO_EMPTY");
    }
    if (media.bytes.byteLength > maximumUploadBytes) {
      throw new PostCallTranscriptionError("AUDIO_TOO_LARGE");
    }

    let audioSegments: ChannelAudioSegment[];
    try {
      audioSegments = await this.#audioSegmenter.segment(media);
    } catch (error) {
      throw new PostCallTranscriptionError("AUDIO_SEGMENTATION_FAILED", {
        cause: error
      });
    }
    if (audioSegments.length === 0) {
      throw new PostCallTranscriptionError("AUDIO_EMPTY");
    }

    const transcribed = (
      await mapConcurrent(
        audioSegments,
        transcriptionConcurrency,
        async (segment) => ({
          ...segment,
          text: await this.#transcribeSegment(segment, brief)
        })
      )
    ).filter(hasTranscribedText);
    if (transcribed.length === 0) {
      throw new PostCallTranscriptionError("AUDIO_EMPTY");
    }
    const roles = assignChannelRoles(transcribed, liveTranscript);
    const segments = transcribed
      .map<FinalTranscriptSegment>((segment) => ({
        role: roles.get(segment.channel) ?? "unknown",
        text: segment.text,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds
      }))
      .sort((left, right) => left.startSeconds - right.startSeconds);

    return {
      text: segments.map((segment) => segment.text).join(" "),
      segments,
      model: this.model
    };
  }

  async #transcribeSegment(segment: ChannelAudioSegment, brief: CallBrief) {
    const form = new FormData();
    const bytes = new Uint8Array(segment.bytes).buffer;
    form.append(
      "file",
      new Blob([bytes], { type: segment.contentType }),
      segment.fileName
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
    return payload.text.trim() || null;
  }
}

function hasTranscribedText(
  segment: ChannelAudioSegment & { text: string | null }
): segment is ChannelAudioSegment & { text: string } {
  return segment.text !== null;
}

export function assignChannelRoles(
  segments: Array<Pick<ChannelAudioSegment, "channel"> & { text: string }>,
  liveTranscript: TranscriptSegment[]
) {
  const channels = [...new Set(segments.map((segment) => segment.channel))];
  const roles = new Map<number, FinalTranscriptSegment["role"]>();
  if (channels.length !== 2) {
    for (const channel of channels) roles.set(channel, "unknown");
    return roles;
  }

  const textByChannel = new Map(
    channels.map((channel) => [
      channel,
      segments
        .filter((segment) => segment.channel === channel)
        .map((segment) => segment.text)
        .join(" ")
    ])
  );
  const liveAssistant = liveTranscript
    .filter((segment) => segment.role === "assistant" && segment.final)
    .map((segment) => segment.text)
    .join(" ");
  const liveRecipient = liveTranscript
    .filter((segment) => segment.role === "recipient" && segment.final)
    .map((segment) => segment.text)
    .join(" ");
  const [first, second] = channels;
  const directScore =
    textSimilarity(textByChannel.get(first) ?? "", liveAssistant) +
    textSimilarity(textByChannel.get(second) ?? "", liveRecipient);
  const swappedScore =
    textSimilarity(textByChannel.get(second) ?? "", liveAssistant) +
    textSimilarity(textByChannel.get(first) ?? "", liveRecipient);
  const assistantChannel =
    directScore === swappedScore
      ? [...channels].sort(
          (left, right) =>
            (textByChannel.get(right)?.length ?? 0) -
            (textByChannel.get(left)?.length ?? 0)
        )[0]
      : directScore > swappedScore
        ? first
        : second;
  roles.set(assistantChannel, "assistant");
  roles.set(
    channels.find((channel) => channel !== assistantChannel)!,
    "recipient"
  );
  return roles;
}

export function buildPostCallTranscriptionPrompt(brief: CallBrief) {
  const fallback = brief.allowLanguageSwitch
    ? ` A fallback language may be ${brief.fallbackLocale}.`
    : "";
  const context = brief.context
    .replace(/[<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumContextCharacters);
  const prompt = [
    "This is one isolated speaker turn from a telephone call. Transcribe only speech that is audible. Do not add, infer, complete, or summarise anything from the metadata below. Use it only to spell words that were actually spoken.",
    `Telephone call in ${brief.locale}.${fallback}`,
    `AI assistant: ${brief.agentName}.`,
    `Represented person: ${brief.representedPerson}.`,
    `Recipient or organisation: ${brief.recipientName}.`,
    `Call objective: ${brief.objective}.`,
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
    const keyword = candidate
      .replace(/[<>\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maximumKeywordCharacters);
    const normalized = keyword.toLocaleLowerCase("en");
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

function textSimilarity(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function tokenize(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("de")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

async function mapConcurrent<Input, Output>(
  items: Input[],
  concurrency: number,
  operation: (item: Input) => Promise<Output>
) {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await operation(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
