import type { CallBrief, TranscriptSegment } from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  OpenAIPostCallTranscriber,
  buildPostCallTranscriptionKeywords,
  buildPostCallTranscriptionLanguages,
  buildPostCallTranscriptionPrompt
} from "./openai-post-call-transcriber";

const brief: CallBrief = {
  id: "4da71bb4-6404-4646-8aa1-2af232268780",
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Ask whether Ivan Slavinskyi's application was received",
  assistantProfileId: "sebastian",
  agentName: "Sebastian",
  representedPerson: "Ivan Slavinskyi",
  assistanceReason: "speech_impairment",
  assistanceDisclosure: "Mr Slavinskyi has a speech impairment.",
  context: "The application concerns the Einwohnerdienste in Aadorf.",
  locale: "de-CH",
  voiceGender: "male",
  audioRetentionDays: 7,
  allowLanguageSwitch: true,
  fallbackLocale: "en-GB",
  allowedFacts: ["Application sent: 12 July", "Gemeinde Aadorf"],
  status: "completed",
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:05:00.000Z"
};

const liveTranscript: TranscriptSegment[] = [
  {
    id: "067a0cbb-df00-4f65-b672-b50787d36ad0",
    role: "recipient",
    text: "A deliberately different live draft.",
    locale: "de-CH",
    final: true,
    createdAt: "2026-08-10T08:01:00.000Z"
  }
];

const media = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "audio/mpeg" as const,
  fileName: "RE123.mp3",
  channels: 2 as const
};

describe("OpenAIPostCallTranscriber", () => {
  it("transcribes the complete recording in one request", async () => {
    const fetchImplementation = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("gpt-transcribe");
      expect((form.get("file") as File).name).toBe("RE123.mp3");
      expect(form.get("prompt")).toContain(
        "complete consented recording"
      );
      expect(form.get("prompt")).toContain("Use the Latin alphabet");
      expect(form.getAll("keywords[]")).toContain("Ivan Slavinskyi");
      expect(form.getAll("languages[]")).toEqual(["de", "en"]);
      return new Response(
        JSON.stringify({
          text: "Spreche ich mit Elena? Ja. Wie bitte?"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(
      transcriber.transcribe(media, brief, liveTranscript)
    ).resolves.toEqual({
      text: "Spreche ich mit Elena? Ja. Wie bitte?",
      segments: [],
      model: "gpt-transcribe"
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("does not promote wording from the live draft", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Recording-derived text." }), {
        status: 200
      })
    );
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      fetchImplementation: fetchImplementation as typeof fetch
    });

    const result = await transcriber.transcribe(media, brief, liveTranscript);
    expect(result.text).toBe("Recording-derived text.");
    expect(result.text).not.toContain(liveTranscript[0].text);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("rejects an empty recording before calling OpenAI", async () => {
    const fetchImplementation = vi.fn();
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(
      transcriber.transcribe({ ...media, bytes: new Uint8Array() }, brief)
    ).rejects.toMatchObject({ code: "AUDIO_EMPTY" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects a recording larger than the upload limit", async () => {
    const fetchImplementation = vi.fn();
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(
      transcriber.transcribe(
        { ...media, bytes: new Uint8Array(25 * 1024 * 1024 + 1) },
        brief
      )
    ).rejects.toMatchObject({ code: "AUDIO_TOO_LARGE" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects empty or malformed model responses", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "   " }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 })
      );
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(transcriber.transcribe(media, brief)).rejects.toMatchObject({
      code: "AUDIO_EMPTY"
    });
    await expect(transcriber.transcribe(media, brief)).rejects.toMatchObject({
      code: "OPENAI_RESPONSE_INVALID"
    });
  });
});

describe("post-call transcription context", () => {
  it("keeps bounded approved context and explicit languages", () => {
    const prompt = buildPostCallTranscriptionPrompt(brief);
    expect(prompt).toContain(brief.objective);
    expect(prompt).toContain("Do not translate, add, infer");
    expect(prompt).toContain("Omit speech that is not intelligible");
    expect(buildPostCallTranscriptionKeywords(brief)).toEqual(
      expect.arrayContaining(["Sebastian", "Ivan Slavinskyi", "Gemeinde Aadorf"])
    );
    expect(buildPostCallTranscriptionLanguages(brief)).toEqual(["de", "en"]);
  });
});
