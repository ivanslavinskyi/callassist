import type { CallBrief, TranscriptSegment } from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  OpenAIPostCallTranscriber,
  assignChannelRoles,
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
    role: "assistant",
    text: "Guten Tag. Ist die Bewerbung angekommen?",
    locale: "de-CH",
    final: true,
    createdAt: "2026-08-10T08:01:00.000Z"
  },
  {
    id: "d3585611-32c7-4a61-a0e4-385f822981ce",
    role: "recipient",
    text: "Ja, sie ist angekommen.",
    locale: "de-CH",
    final: true,
    createdAt: "2026-08-10T08:01:03.000Z"
  }
];

describe("OpenAIPostCallTranscriber", () => {
  it("transcribes isolated dual-channel turns and returns roles with timestamps", async () => {
    const audioSegmenter = {
      segment: vi.fn().mockResolvedValue([
        {
          channel: 2,
          bytes: new Uint8Array([1]),
          contentType: "audio/wav" as const,
          fileName: "assistant.wav",
          startSeconds: 1.2,
          endSeconds: 3.8
        },
        {
          channel: 1,
          bytes: new Uint8Array([2]),
          contentType: "audio/wav" as const,
          fileName: "recipient.wav",
          startSeconds: 4.1,
          endSeconds: 5.7
        }
      ])
    };
    const fetchImplementation = vi
      .fn()
      .mockImplementationOnce(async (_url, init) => {
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("gpt-transcribe");
        expect(form.get("prompt")).toContain("Gemeinde Aadorf");
        expect(form.getAll("keywords[]")).toContain("Ivan Slavinskyi");
        expect(form.getAll("languages[]")).toEqual(["de", "en"]);
        expect(form.get("file")).toBeInstanceOf(Blob);
        return new Response(
          JSON.stringify({ text: "Ist die Bewerbung angekommen?" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ text: "Ja, sie ist angekommen." }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      audioSegmenter,
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(
      transcriber.transcribe(
        {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "audio/mpeg",
          fileName: "RE123.mp3",
          channels: 2
        },
        brief,
        liveTranscript
      )
    ).resolves.toEqual({
      text: "Ist die Bewerbung angekommen? Ja, sie ist angekommen.",
      segments: [
        {
          role: "assistant",
          text: "Ist die Bewerbung angekommen?",
          startSeconds: 1.2,
          endSeconds: 3.8
        },
        {
          role: "recipient",
          text: "Ja, sie ist angekommen.",
          startSeconds: 4.1,
          endSeconds: 5.7
        }
      ],
      model: "gpt-transcribe"
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty provider recording before segmenting audio", async () => {
    const audioSegmenter = { segment: vi.fn() };
    const fetchImplementation = vi.fn();
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      audioSegmenter,
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(
      transcriber.transcribe(
        {
          bytes: new Uint8Array(),
          contentType: "audio/mpeg",
          fileName: "empty.mp3"
        },
        brief
      )
    ).rejects.toMatchObject({ code: "AUDIO_EMPTY" });
    expect(audioSegmenter.segment).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("skips an empty noise segment without failing the complete transcript", async () => {
    const audioSegmenter = {
      segment: vi.fn().mockResolvedValue([
        {
          channel: 1,
          bytes: new Uint8Array([1]),
          contentType: "audio/wav" as const,
          fileName: "noise.wav",
          startSeconds: 0.4,
          endSeconds: 0.6
        },
        {
          channel: 2,
          bytes: new Uint8Array([2]),
          contentType: "audio/wav" as const,
          fileName: "assistant.wav",
          startSeconds: 1.2,
          endSeconds: 3.8
        },
        {
          channel: 1,
          bytes: new Uint8Array([3]),
          contentType: "audio/wav" as const,
          fileName: "recipient.wav",
          startSeconds: 4.1,
          endSeconds: 5.7
        }
      ])
    };
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "   " }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "Ist die Bewerbung angekommen?" }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "Ja, sie ist angekommen." }), {
          status: 200
        })
      );
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      audioSegmenter,
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(
      transcriber.transcribe(
        {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "audio/mpeg",
          fileName: "RE123.mp3",
          channels: 2
        },
        brief,
        liveTranscript
      )
    ).resolves.toMatchObject({
      text: "Ist die Bewerbung angekommen? Ja, sie ist angekommen.",
      segments: [
        expect.objectContaining({ role: "assistant", startSeconds: 1.2 }),
        expect.objectContaining({ role: "recipient", startSeconds: 4.1 })
      ]
    });
  });

  it("fails only when every detected segment contains no speech", async () => {
    const audioSegmenter = {
      segment: vi.fn().mockResolvedValue([
        {
          channel: 1,
          bytes: new Uint8Array([1]),
          contentType: "audio/wav" as const,
          fileName: "noise-1.wav",
          startSeconds: 0.4,
          endSeconds: 0.6
        },
        {
          channel: 2,
          bytes: new Uint8Array([2]),
          contentType: "audio/wav" as const,
          fileName: "noise-2.wav",
          startSeconds: 1.2,
          endSeconds: 1.4
        }
      ])
    };
    const fetchImplementation = vi
      .fn()
      .mockImplementation(async () =>
        new Response(JSON.stringify({ text: "" }), { status: 200 })
      );
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      audioSegmenter,
      fetchImplementation: fetchImplementation as typeof fetch
    });

    await expect(
      transcriber.transcribe(
        {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "audio/mpeg",
          fileName: "RE123.mp3",
          channels: 2
        },
        brief,
        liveTranscript
      )
    ).rejects.toMatchObject({ code: "AUDIO_EMPTY" });
  });

  it("still rejects a malformed OpenAI response", async () => {
    const audioSegmenter = {
      segment: vi.fn().mockResolvedValue([
        {
          channel: 1,
          bytes: new Uint8Array([1]),
          contentType: "audio/wav" as const,
          fileName: "speech.wav",
          startSeconds: 0.4,
          endSeconds: 1.6
        }
      ])
    };
    const transcriber = new OpenAIPostCallTranscriber({
      apiKey: "test-key",
      audioSegmenter,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ unexpected: true }), { status: 200 })
        ) as typeof fetch
    });

    await expect(
      transcriber.transcribe(
        {
          bytes: new Uint8Array([1]),
          contentType: "audio/mpeg",
          fileName: "RE123.mp3",
          channels: 1
        },
        brief
      )
    ).rejects.toMatchObject({ code: "OPENAI_RESPONSE_INVALID" });
  });
});

describe("post-call speaker mapping", () => {
  it("maps physical channels to roles using the independent live references", () => {
    const roles = assignChannelRoles(
      [
        { channel: 1, text: "Ja, sie ist angekommen." },
        { channel: 2, text: "Ist die Bewerbung angekommen?" }
      ],
      liveTranscript
    );
    expect(roles.get(1)).toBe("recipient");
    expect(roles.get(2)).toBe("assistant");
  });

  it("keeps the role unknown for a mono recording", () => {
    const roles = assignChannelRoles(
      [{ channel: 1, text: "Mixed conversation" }],
      liveTranscript
    );
    expect(roles.get(1)).toBe("unknown");
  });
});

describe("post-call transcription context", () => {
  it("keeps locale, objective, approved names, and fallback language", () => {
    const prompt = buildPostCallTranscriptionPrompt(brief);
    expect(prompt).toContain(brief.objective);
    expect(prompt).toContain("Transcribe only speech that is audible");
    expect(prompt).toContain("Do not add, infer, complete, or summarise");
    expect(buildPostCallTranscriptionKeywords(brief)).toEqual(
      expect.arrayContaining(["Sebastian", "Ivan Slavinskyi", "Gemeinde Aadorf"])
    );
    expect(buildPostCallTranscriptionLanguages(brief)).toEqual(["de", "en"]);
  });
});
