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
  it("uses dual recording channels as the only authority for roles", async () => {
    const waveMedia = {
      bytes: stereoWave(8_000, 3, [
        { channel: 1 as const, start: 0.3, end: 0.9 },
        { channel: 0 as const, start: 1.3, end: 1.8 },
        { channel: 1 as const, start: 2.2, end: 2.7 }
      ]),
      contentType: "audio/wav",
      fileName: "RE123.wav",
      channels: 2 as const
    };
    const replies = ["Guten Tag.", "Ja, gern.", "Vielen Dank."];
    const fetchImplementation = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      const index = Number(file.name.match(/(\d+)\.wav$/)?.[1]) - 1;
      return new Response(JSON.stringify({ text: replies[index] }), { status: 200 });
    });
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      utteranceModel: "gpt-4o-transcribe",
      fetchImplementation: fetchImplementation as typeof fetch
    });

    const result = await transcriber.transcribe(
      waveMedia,
      brief,
      [{ ...liveTranscript[0], role: "assistant", text: "Wrong role and wording" }],
      { recordingStartedAt: brief.createdAt, durationSeconds: 3 }
    );

    expect(result.text).toBe("Guten Tag. Ja, gern. Vielen Dank.");
    expect(result.segments.map(({ role }) => role)).toEqual([
      "assistant",
      "recipient",
      "assistant"
    ]);
    expect(result.segments.some(({ role }) => role === "unknown")).toBe(false);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect((init?.body as FormData).get("model")).toBe("gpt-4o-transcribe");
    }
  });

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

function stereoWave(
  sampleRate: number,
  durationSeconds: number,
  ranges: Array<{ channel: 0 | 1; start: number; end: number }>
) {
  const frameCount = sampleRate * durationSeconds;
  const channels = [new Int16Array(frameCount), new Int16Array(frameCount)];
  for (const range of ranges) {
    for (let frame = range.start * sampleRate; frame < range.end * sampleRate; frame += 1) {
      channels[range.channel][frame] = Math.round(
        8_000 * Math.sin(2 * Math.PI * 220 * frame / sampleRate)
      );
    }
  }
  const bytes = new Uint8Array(44 + frameCount * 4);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, bytes.byteLength - 44, true);
  for (let frame = 0; frame < frameCount; frame += 1) {
    view.setInt16(44 + frame * 4, channels[0][frame], true);
    view.setInt16(46 + frame * 4, channels[1][frame], true);
  }
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

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
