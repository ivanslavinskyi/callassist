import type { CallBrief } from "@callassist/contracts";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import {
  OpenAIRealtimeBridge,
  buildConsentAnnouncementInstructions,
  buildInitialResponseInstructions,
  buildRealtimeInstructions
} from "./openai-realtime-bridge";

const brief: CallBrief = {
  id: "4da71bb4-6404-4646-8aa1-2af232268780",
  recipientName: "Example AG",
  phoneNumber: "+41710000001",
  objective: "Ask whether the application sent on 12 July was received",
  assistantProfileId: "anna",
  agentName: "Anna",
  representedPerson: "Ivan Slavinskyi",
  assistanceReason: "speech_impairment",
  assistanceDisclosure: "Disability disclosure",
  context: "The company works in logistics. An unverified salary note says CHF 99,999.",
  locale: "de-CH",
  voiceGender: "female",
  audioRetentionDays: 7,
  allowLanguageSwitch: false,
  allowedFacts: ["Application sent: 12 July", "Applicant: Ivan Slavinskyi"],
  status: "ready",
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z"
};

describe("buildRealtimeInstructions", () => {
  it("separates background context from approved facts and forbids guessing", () => {
    const prompt = buildRealtimeInstructions(brief);
    expect(prompt).toContain("# Background context");
    expect(prompt).toContain("# Facts explicitly approved for disclosure");
    expect(prompt).toContain("Application sent: 12 July");
    expect(prompt).toContain("Never invent or infer missing facts");
    expect(prompt).toContain("Do not switch to another language");
    expect(prompt).toContain("Only if the repeated answer is still unclear");
    expect(prompt).toContain("something was bought does not confirm that it was sent");
    expect(prompt).toContain("# Mandatory conversation opening");
    expect(prompt).toContain(
      "Do not include the first substantive objective question or message"
    );
  });

  it("instructs the realtime model to speak Russian", () => {
    const prompt = buildRealtimeInstructions({ ...brief, locale: "ru-RU" });
    expect(prompt).toContain("Speak Russian naturally and politely");
  });
});

describe("buildInitialResponseInstructions", () => {
  it("reads the compiled opening exactly and waits before the first objective question", () => {
    const objective =
      "Уточнить, купил ли Иван билеты жене и детям для поездки в Констанс";
    const opening = {
      recipientAddress: "Спасибо, Елена.",
      purposeStatement:
        "Я звоню от имени Ивана Славинского, чтобы уточнить вопрос о билетах для поездки в Констанс.",
      readinessQuestion: "Вам сейчас удобно коротко поговорить?"
    };
    const prompt = buildInitialResponseInstructions({
      ...brief,
      locale: "ru-RU",
      objective
    }, opening);

    expect(prompt).toContain(
      JSON.stringify([brief.assistanceDisclosure, ...Object.values(opening)].join(" "))
    );
    expect(prompt).toContain(
      "Do not begin any substantive objective question or message yet"
    );
    expect(prompt).toContain("wait for the recipient");
    expect(prompt).not.toContain("Immediately ask");
  });

  it("provides a bounded opening fallback for legacy briefs", () => {
    const prompt = buildInitialResponseInstructions(brief, null);

    expect(prompt).toContain(brief.recipientName);
    expect(prompt).toContain(brief.representedPerson);
    expect(prompt).toContain(brief.objective);
    expect(prompt).toContain("Do not begin the first substantive objective step yet");
  });

  it("omits assistance disclosure entirely when the reason is none", () => {
    const prompt = buildInitialResponseInstructions(
      { ...brief, assistanceReason: "none", assistanceDisclosure: "" },
      {
        recipientAddress: "Hello Example AG.",
        purposeStatement: "I am calling on behalf of Ivan Slavinskyi about the application.",
        readinessQuestion: "Is now a convenient time?"
      }
    );

    expect(prompt).not.toContain("Disability disclosure");
    expect(prompt).toContain("I am calling on behalf of Ivan Slavinskyi");
  });
});

describe("buildConsentAnnouncementInstructions", () => {
  it("keeps assistance reason, persona, retention, and DTMF out of legal consent", () => {
    const prompt = buildConsentAnnouncementInstructions({
      ...brief,
      locale: "ru-RU",
      assistanceDisclosure:
        "Господин Славинский испытывает затруднения при телефонных разговорах из-за нарушения речи."
    });

    expect(prompt).toContain("ИИ-ассистент");
    expect(prompt).toContain("записать и автоматически расшифровать");
    expect(prompt).not.toContain("нарушения речи");
    expect(prompt).not.toContain(brief.agentName);
    expect(prompt).not.toContain("7");
    expect(prompt).not.toContain("нажмите 1");
    expect(prompt).toContain("Do not begin the call objective");
  });
});

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: Record<string, unknown>[] = [];

  send(value: string) {
    this.sent.push(JSON.parse(value) as Record<string, unknown>);
  }

  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1000);
  }
}

describe("OpenAIRealtimeBridge", () => {
  it("plays the mandatory opening before accepting audio and persists finalized transcripts", async () => {
    const service = new CallService(new InMemoryCallRepository());
    const created = await service.create({
      recipientName: brief.recipientName,
      phoneNumber: brief.phoneNumber,
      objective: brief.objective,
      assistantProfileId: brief.assistantProfileId!,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: brief.assistanceReason,
      context: brief.context,
      locale: brief.locale,
      allowLanguageSwitch: false,
      allowedFacts: brief.allowedFacts
    });
    const twilioSocket = new FakeSocket();
    const openAISocket = new FakeSocket();
    const consentSocket = new FakeSocket();
    let consentSocketUrl = "";
    const events: string[] = [];
    const unsubscribe = service.subscribe(created.id, (event) =>
      events.push(event.type)
    );
    const startRecording = vi.spyOn(service, "startRecordingAfterConsent").mockImplementation(
      async (id) => (await service.get(id))!
    );
    const bridge = new OpenAIRealtimeBridge({
      apiKey: "test-key",
      service,
      validateStreamToken: (_id, token) => token === "valid",
      createOpenAISocket: () => openAISocket as unknown as WebSocket,
      createConsentSocket: (url) => {
        consentSocketUrl = url;
        return consentSocket as unknown as WebSocket;
      }
    });

    bridge.handleTwilioSocket(twilioSocket as unknown as WebSocket);
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "start",
          start: {
            streamSid: "MZ123",
            customParameters: {
              callBriefId: created.id,
              streamToken: "valid"
            }
          }
        })
      )
    );
    await new Promise((resolve) => setImmediate(resolve));
    openAISocket.emit("open");
    consentSocket.emit("open");
    expect(consentSocketUrl).toBe(
      "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1"
    );
    expect(consentSocket.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1",
        output_modalities: ["text"],
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: {
              model: "gpt-realtime-whisper",
              delay: "high",
              language: "de"
            },
            turn_detection: {
              type: "server_vad",
              create_response: false,
              interrupt_response: false
            }
          }
        }
      }
    });
    expect(openAISocket.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: { delay: "high", language: "de" }
          },
          output: { format: { type: "audio/pcmu" }, voice: "marin" }
        }
      }
    });

    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "session.updated" }))
    );
    consentSocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "session.updated" }))
    );
    expect(openAISocket.sent[1]).toMatchObject({
      type: "response.create",
      response: {
        instructions: expect.stringContaining("aufzeichnen und automatisch transkribieren")
      }
    });
    expect(JSON.stringify(openAISocket.sent[1])).toContain(
      "eine KI-Assistentin"
    );
    expect(
      JSON.stringify(openAISocket.sent[1])
    ).not.toContain(brief.objective);
    expect(JSON.stringify(openAISocket.sent[1])).not.toContain(
      created.assistanceDisclosure
    );
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { payload: "before-consent" } })
      )
    );
    expect(openAISocket.sent).not.toContainEqual({
      type: "input_audio_buffer.append",
      audio: "before-consent"
    });
    expect(consentSocket.sent).not.toContainEqual({
      type: "input_audio_buffer.append",
      audio: "before-consent"
    });
    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.done" }))
    );
    expect(twilioSocket.sent).toContainEqual({
      event: "mark",
      streamSid: "MZ123",
      mark: { name: "callassist-consent-prompt-complete" }
    });
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "mark",
          mark: { name: "callassist-consent-prompt-complete" }
        })
      )
    );
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { payload: "voice-consent" } })
      )
    );
    expect(consentSocket.sent).toContainEqual({
      type: "input_audio_buffer.append",
      audio: "voice-consent"
    });
    expect(openAISocket.sent).not.toContainEqual({
      type: "input_audio_buffer.append",
      audio: "voice-consent"
    });
    consentSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "Ja, gerne"
        })
      )
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(startRecording).toHaveBeenCalledWith(created.id, {
      method: "voice",
      decision: "affirmative",
      locale: "de-CH"
    });
    expect(openAISocket.sent).toContainEqual({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: expect.stringContaining("Verified consent")
          }
        ]
      }
    });
    expect(openAISocket.sent).toContainEqual({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: expect.stringContaining(brief.objective)
      }
    });
    expect(JSON.stringify(openAISocket.sent)).toContain(
      created.assistanceDisclosure
    );
    expect(JSON.stringify(openAISocket.sent)).toContain(
      "Do not begin any substantive objective question or message yet"
    );
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { payload: "during-opening" } })
      )
    );
    expect(openAISocket.sent).not.toContainEqual({
      type: "input_audio_buffer.append",
      audio: "during-opening"
    });

    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.done" }))
    );
    expect(twilioSocket.sent).toContainEqual({
      event: "mark",
      streamSid: "MZ123",
      mark: { name: "callassist-opening-complete" }
    });
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { payload: "before-opening-mark" } })
      )
    );
    expect(openAISocket.sent).not.toContainEqual({
      type: "input_audio_buffer.append",
      audio: "before-opening-mark"
    });
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "mark",
          mark: { name: "callassist-opening-complete" }
        })
      )
    );
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ event: "media", media: { payload: "audio-in" } })
      )
    );
    expect(openAISocket.sent).toContainEqual({
      type: "input_audio_buffer.append",
      audio: "audio-in"
    });
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "dtmf",
          dtmf: { track: "inbound_track", digit: "1" }
        })
      )
    );
    expect(openAISocket.sent).toContainEqual({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: expect.stringContaining("Verified telephone keypad input: YES")
          }
        ]
      }
    });

    openAISocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_audio.delta",
          delta: "audio-out"
        })
      )
    );
    expect(twilioSocket.sent).toContainEqual({
      event: "media",
      streamSid: "MZ123",
      media: { payload: "audio-out" }
    });

    openAISocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.delta",
          item_id: "user-1",
          delta: "Guten "
        })
      )
    );
    openAISocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "user-1",
          transcript: "Guten Tag"
        })
      )
    );
    openAISocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_audio_transcript.done",
          response_id: "assistant-1",
          transcript: "Vielen Dank"
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    const snapshot = await service.get(created.id);
    expect(snapshot?.transcript.map(({ role, text }) => ({ role, text }))).toEqual([
      {
        role: "system",
        text: "[Einwilligung zur Aufzeichnung und Transkription erteilt]"
      },
      { role: "recipient", text: "Taste 1 — Ja" },
      { role: "recipient", text: "Guten Tag" },
      { role: "assistant", text: "Vielen Dank" }
    ]);
    expect(events).toContain("transcript.delta");
    unsubscribe();
    twilioSocket.close();
    await new Promise((resolve) => setImmediate(resolve));
    const telemetry = await service.listTelemetry(created.id);
    expect(telemetry.map(({ payload }) => payload.name)).toEqual(
      expect.arrayContaining([
        "realtime.ready",
        "disclosure.started",
        "conversation.started",
        "conversation.first_audio",
        "conversation.ended"
      ])
    );
    expect(
      telemetry.find(
        ({ payload }) => payload.name === "conversation.first_audio"
      )?.payload
    ).toEqual({
      name: "conversation.first_audio",
      metadata: { latencyMs: expect.any(Number) }
    });
    expect(
      telemetry.find(({ payload }) => payload.name === "conversation.ended")
        ?.payload
    ).toEqual({
      name: "conversation.ended",
      metadata: { reason: "socket_closed" }
    });
    await service.close();
  });

  it("ends the stream in the same OpenAI voice when consent times out", async () => {
    const service = new CallService(new InMemoryCallRepository());
    const created = await service.create({
      recipientName: brief.recipientName,
      phoneNumber: brief.phoneNumber,
      objective: brief.objective,
      assistantProfileId: brief.assistantProfileId!,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: brief.assistanceReason,
      context: brief.context,
      locale: brief.locale,
      allowLanguageSwitch: false,
      allowedFacts: brief.allowedFacts
    });
    const twilioSocket = new FakeSocket();
    const openAISocket = new FakeSocket();
    const consentSocket = new FakeSocket();
    const bridge = new OpenAIRealtimeBridge({
      apiKey: "test-key",
      service,
      validateStreamToken: (_id, token) => token === "valid",
      consentTimeoutMs: 1,
      createOpenAISocket: () => openAISocket as unknown as WebSocket,
      createConsentSocket: () => consentSocket as unknown as WebSocket
    });

    bridge.handleTwilioSocket(twilioSocket as unknown as WebSocket);
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "start",
          start: {
            streamSid: "MZ456",
            customParameters: {
              callBriefId: created.id,
              streamToken: "valid"
            }
          }
        })
      )
    );
    await new Promise((resolve) => setImmediate(resolve));
    openAISocket.emit("open");
    consentSocket.emit("open");
    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "session.updated" }))
    );
    consentSocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "session.updated" }))
    );
    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.done" }))
    );
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "mark",
          mark: { name: "callassist-consent-prompt-complete" }
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(openAISocket.sent).toContainEqual({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: expect.stringContaining("Entschuldigung")
      }
    });
    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.done" }))
    );
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "mark",
          mark: { name: "callassist-consent-prompt-complete" }
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(openAISocket.sent).toContainEqual({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: expect.stringContaining("1 drücken")
      }
    });
    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.done" }))
    );
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "mark",
          mark: { name: "callassist-consent-prompt-complete" }
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(openAISocket.sent).toContainEqual({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: expect.stringContaining("Ohne Ihre Zustimmung")
      }
    });
    openAISocket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.done" }))
    );
    expect(twilioSocket.sent).toContainEqual({
      event: "mark",
      streamSid: "MZ456",
      mark: { name: "callassist-no-consent-complete" }
    });
    twilioSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "mark",
          mark: { name: "callassist-no-consent-complete" }
        })
      )
    );
    expect(twilioSocket.readyState).toBe(WebSocket.CLOSED);
    expect(openAISocket.readyState).toBe(WebSocket.CLOSED);
    await new Promise((resolve) => setImmediate(resolve));
    const telemetry = await service.listTelemetry(created.id);
    expect(
      telemetry.filter(({ payload }) => payload.name === "consent.failed")
    ).toEqual([
      expect.objectContaining({
        payload: {
          name: "consent.failed",
          metadata: { reason: "timeout" }
        }
      })
    ]);
    expect(
      telemetry.some(({ payload }) => payload.name === "conversation.started")
    ).toBe(false);
    await service.close();
  });

  it("ends without recording or conversation on clear negative voice consent", async () => {
    const harness = await createConsentHarness();
    completeConsentPlayback(harness);

    emitJson(harness.consentSocket, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Nein, lieber nicht"
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.startRecording).not.toHaveBeenCalled();
    expect(harness.openAISocket.sent).toContainEqual({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: expect.stringContaining("Ohne Ihre Zustimmung")
      }
    });
    expect((await harness.service.get(harness.created.id))?.recording).toBeNull();
    expect(
      (await harness.service.listTelemetry(harness.created.id)).some(
        ({ payload }) => payload.name === "conversation.started"
      )
    ).toBe(false);
    await harness.service.close();
  });

  it("offers DTMF only after two unclear voice attempts and accepts key 1", async () => {
    const harness = await createConsentHarness();
    completeConsentPlayback(harness);

    emitJson(harness.consentSocket, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Vielleicht"
    });
    expect(JSON.stringify(harness.openAISocket.sent)).toContain("Entschuldigung");
    completeConsentPlayback(harness);
    emitJson(harness.consentSocket, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Ich weiß nicht"
    });
    expect(JSON.stringify(harness.openAISocket.sent)).toContain("1 drücken");
    completeConsentPlayback(harness);

    emitJson(harness.twilioSocket, {
      event: "dtmf",
      dtmf: { track: "inbound_track", digit: "1" }
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.startRecording).toHaveBeenCalledWith(harness.created.id, {
      method: "dtmf",
      digit: "1",
      locale: "de-CH"
    });
    expect(JSON.stringify(harness.openAISocket.sent)).toContain(
      "Verified consent"
    );
    await harness.service.close();
  });

  it("fails closed when recording startup fails after voice consent", async () => {
    const harness = await createConsentHarness(true);
    completeConsentPlayback(harness);
    emitJson(harness.consentSocket, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Ja"
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(JSON.stringify(harness.openAISocket.sent)).toContain(
      "Die Aufnahme konnte nicht gestartet werden"
    );
    expect(
      (await harness.service.listTelemetry(harness.created.id)).some(
        ({ payload }) => payload.name === "conversation.started"
      )
    ).toBe(false);
    await harness.service.close();
  });
});

async function createConsentHarness(failRecording = false) {
  const service = new CallService(new InMemoryCallRepository());
  const created = await service.create({
    recipientName: brief.recipientName,
    phoneNumber: brief.phoneNumber,
    objective: brief.objective,
    assistantProfileId: brief.assistantProfileId!,
    representedPersonFirstName: "Nina",
    representedPersonLastName: "Keller",
    assistanceReason: "none",
    context: brief.context,
    locale: brief.locale,
    allowLanguageSwitch: false,
    allowedFacts: brief.allowedFacts
  });
  const twilioSocket = new FakeSocket();
  const openAISocket = new FakeSocket();
  const consentSocket = new FakeSocket();
  const startRecording = vi
    .spyOn(service, "startRecordingAfterConsent")
    .mockImplementation(async (id) => {
      if (failRecording) throw new Error("recording failed");
      return (await service.get(id))!;
    });
  const bridge = new OpenAIRealtimeBridge({
    apiKey: "test-key",
    service,
    validateStreamToken: (_id, token) => token === "valid",
    createOpenAISocket: () => openAISocket as unknown as WebSocket,
    createConsentSocket: () => consentSocket as unknown as WebSocket
  });
  bridge.handleTwilioSocket(twilioSocket as unknown as WebSocket);
  emitJson(twilioSocket, {
    event: "start",
    start: {
      streamSid: "MZ-HARNESS",
      customParameters: { callBriefId: created.id, streamToken: "valid" }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  openAISocket.emit("open");
  consentSocket.emit("open");
  emitJson(openAISocket, { type: "session.updated" });
  emitJson(consentSocket, { type: "session.updated" });
  return {
    service,
    created,
    twilioSocket,
    openAISocket,
    consentSocket,
    startRecording
  };
}

function completeConsentPlayback(harness: {
  openAISocket: FakeSocket;
  twilioSocket: FakeSocket;
}) {
  emitJson(harness.openAISocket, { type: "response.done" });
  emitJson(harness.twilioSocket, {
    event: "mark",
    mark: { name: "callassist-consent-prompt-complete" }
  });
}

function emitJson(socket: FakeSocket, payload: object) {
  socket.emit("message", Buffer.from(JSON.stringify(payload)));
}
