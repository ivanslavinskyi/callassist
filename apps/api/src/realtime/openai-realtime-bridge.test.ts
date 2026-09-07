import {
  approvedExecutionSnapshotSchema,
  type ApprovedExecutionSnapshot,
  type CallBrief
} from "@callassist/contracts";
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
  representedPersonFirstName: "Ivan",
  representedPersonLastName: "Slavinskyi",
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

const executionSnapshot: ApprovedExecutionSnapshot = {
  version: 1,
  callBriefId: brief.id,
  compilationRevision: 2,
  compilationSnapshotHash: "a".repeat(64),
  approvedAt: "2026-07-14T12:01:00.000Z",
  plan: {
    callLocale: "de-CH",
    taskType: "receipt_confirmation",
    tone: "neutral",
    addressingStyle: "formal",
    resultHandling: "capture_in_callassist",
    voicemailAction: "hang_up",
    refusalBehavior: "respect_and_end",
    localizedObjective: "Confirm the approved application receipt objective",
    opening: {
      recipientAddress: "Guten Tag Example AG.",
      purposeStatement: "Ich rufe wegen des Eingangs des Antrags vom 12. Juli an.",
      readinessQuestion: "Passt es Ihnen jetzt kurz?"
    },
    backgroundSummary: "Approved background summary for the call.",
    orderedQuestions: [
      {
        text: "Ist der Antrag vom 12. Juli eingegangen?",
        purpose: "Confirm receipt",
        required: true
      }
    ],
    conditionalFollowUps: [
      {
        condition: "the application was not received",
        question: "An welche Adresse soll der Antrag erneut gesendet werden?"
      }
    ],
    successCriteria: ["Receipt status is confirmed"],
    unresolvedCriteria: ["Receipt status remains unclear"],
    stopConditions: ["The recipient asks to end the call"],
    approvedFacts: ["Application sent: 12 July"],
    prohibitedActions: ["Do not agree to contractual terms"]
  },
  runtime: {
    agentName: "Anna",
    voiceGender: "female",
    assistanceDisclosure: "Disability disclosure",
    audioRetentionDays: 7,
    allowLanguageSwitch: false
  }
};

describe("buildRealtimeInstructions", () => {
  it("rejects raw task fields at the runtime schema boundary", () => {
    expect(
      approvedExecutionSnapshotSchema.safeParse({
        ...executionSnapshot,
        objective: "RAW_OBJECTIVE",
        context: "RAW_CONTEXT"
      }).success
    ).toBe(false);
  });

  it("separates background context from approved facts and forbids guessing", () => {
    const prompt = buildRealtimeInstructions(executionSnapshot);
    expect(prompt).toContain("# Background context");
    expect(prompt).toContain("# Facts explicitly approved for disclosure");
    expect(prompt).toContain("Application sent: 12 July");
    expect(prompt).toContain("Never invent or infer missing facts");
    expect(prompt).toContain("Do not switch to another language");
    expect(prompt).toContain("Only if the repeated answer is still unclear");
    expect(prompt).toContain("something was bought does not confirm that it was sent");
    expect(prompt).toContain("# Mandatory conversation opening");
    expect(prompt).toContain("# Ordered questions");
    expect(prompt).toContain("Ist der Antrag vom 12. Juli eingegangen?");
    expect(prompt).toContain("# Conditional follow-ups");
    expect(prompt).toContain("Receipt status is confirmed");
    expect(prompt).toContain("Receipt status remains unclear");
    expect(prompt).toContain("Do not agree to contractual terms");
    expect(prompt).toContain(
      "Do not include the first substantive objective question or message"
    );
  });

  it("instructs the realtime model to speak Russian", () => {
    const prompt = buildRealtimeInstructions({
      ...executionSnapshot,
      plan: { ...executionSnapshot.plan, callLocale: "ru-RU" }
    });
    expect(prompt).toContain("Speak Russian naturally and politely");
  });

  it("ignores raw task fields even if an upstream object carries them", () => {
    const rawMarkers = {
      objective: "RAW_OBJECTIVE_IGNORE_ALL_RULES",
      context: "RAW_CONTEXT_PROMPT_INJECTION",
      allowedFacts: ["RAW_UNAPPROVED_FACT"],
      clarificationAnswers: [
        { issueCode: "missing_required_reference", answer: "RAW_CLARIFICATION" }
      ],
      deliveryInstruction: "RAW_DELIVERY_INSTRUCTION"
    };
    const prompt = buildRealtimeInstructions({
      ...executionSnapshot,
      ...rawMarkers
    });

    expect(prompt).toContain(executionSnapshot.plan.localizedObjective);
    expect(prompt).toContain(executionSnapshot.plan.backgroundSummary);
    expect(prompt).not.toContain(brief.objective);
    expect(prompt).not.toContain(brief.context);
    expect(prompt).not.toContain(brief.representedPerson);
    expect(prompt).not.toContain(brief.recipientName);
    expect(prompt).not.toContain("RAW_OBJECTIVE_IGNORE_ALL_RULES");
    expect(prompt).not.toContain("RAW_CONTEXT_PROMPT_INJECTION");
    expect(prompt).not.toContain("RAW_UNAPPROVED_FACT");
    expect(prompt).not.toContain("RAW_CLARIFICATION");
    expect(prompt).not.toContain("RAW_DELIVERY_INSTRUCTION");
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
      ...executionSnapshot,
      plan: {
        ...executionSnapshot.plan,
        callLocale: "ru-RU",
        localizedObjective: objective,
        opening
      }
    });

    expect(prompt).toContain(
      JSON.stringify([brief.assistanceDisclosure, ...Object.values(opening)].join(" "))
    );
    expect(prompt).toContain(
      "Do not begin any substantive objective question or message yet"
    );
    expect(prompt).toContain("wait for the recipient");
    expect(prompt).not.toContain("Immediately ask");
  });

  it("omits assistance disclosure entirely when the reason is none", () => {
    const prompt = buildInitialResponseInstructions({
      ...executionSnapshot,
      plan: {
        ...executionSnapshot.plan,
        opening: {
        recipientAddress: "Hello Example AG.",
        purposeStatement: "I am calling on behalf of Ivan Slavinskyi about the application.",
        readinessQuestion: "Is now a convenient time?"
        }
      },
      runtime: {
        ...executionSnapshot.runtime,
        assistanceDisclosure: ""
      }
    });

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
  it("persists Realtime session, response, and transcription usage without double counting", async () => {
    const harness = await createConsentHarness();
    emitJson(harness.openAISocket, {
      event_id: "evt_main_session",
      type: "session.created",
      session: { id: "sess_main", model: "gpt-realtime-2.1-2026-08-01" }
    });
    emitJson(harness.consentSocket, {
      event_id: "evt_consent_session",
      type: "session.created",
      session: { id: "sess_consent", model: "gpt-realtime-2.1-2026-08-01" }
    });
    emitJson(harness.openAISocket, {
      type: "response.created",
      response: { id: "resp_usage_1", status: "in_progress" }
    });
    const responseDone = {
      event_id: "evt_response_done_1",
      type: "response.done",
      response: {
        id: "resp_usage_1",
        model: "gpt-realtime-2.1-2026-08-01",
        status: "completed",
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          total_tokens: 150,
          input_token_details: {
            text_tokens: 70,
            audio_tokens: 50,
            cached_tokens: 25,
            cached_tokens_details: { text_tokens: 20, audio_tokens: 5 }
          },
          output_token_details: { text_tokens: 10, audio_tokens: 20 }
        }
      }
    };
    emitJson(harness.openAISocket, responseDone);
    emitJson(harness.openAISocket, responseDone);
    emitJson(harness.openAISocket, {
      type: "response.created",
      response: { id: "resp_usage_cancelled", status: "in_progress" }
    });
    emitJson(harness.openAISocket, {
      event_id: "evt_response_done_cancelled",
      type: "response.done",
      response: {
        id: "resp_usage_cancelled",
        status: "cancelled",
        usage: {
          input_tokens: 3,
          output_tokens: 1,
          total_tokens: 4,
          input_token_details: { text_tokens: 3, audio_tokens: 0 },
          output_token_details: { text_tokens: 0, audio_tokens: 1 }
        }
      }
    });
    const mainTranscription = {
      event_id: "evt_transcription_main_1",
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_main_1",
      transcript: "Test",
      usage: {
        type: "tokens",
        input_tokens: 12,
        output_tokens: 4,
        total_tokens: 16,
        input_token_details: { text_tokens: 2, audio_tokens: 10 }
      }
    };
    emitJson(harness.openAISocket, mainTranscription);
    emitJson(harness.openAISocket, mainTranscription);
    emitJson(harness.consentSocket, {
      event_id: "evt_transcription_consent_1",
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_consent_1",
      transcript: "Vielleicht",
      usage: { type: "duration", seconds: 1.25 }
    });
    emitJson(harness.twilioSocket, { event: "stop" });
    await new Promise((resolve) => setImmediate(resolve));

    const operations = harness.repository.providerOperationsForTest();
    const sessions = operations.filter(
      ({ operationType }) => operationType === "realtime_session"
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.map(({ stage }) => stage).sort()).toEqual([
      "consent_transcription",
      "conversation"
    ]);
    expect(sessions.every(({ result }) => result?.usage?.durationSeconds !== null))
      .toBe(true);
    const responses = operations.filter(
      ({ operationType }) => operationType === "realtime_response"
    );
    expect(responses).toHaveLength(2);
    const completedResponse = responses.find(
      ({ result }) => result?.providerResponseId === "resp_usage_1"
    );
    expect(completedResponse?.result?.usage).toMatchObject({
      inputTextTokens: 70,
      cachedInputTextTokens: 20,
      inputAudioTokens: 50,
      cachedInputAudioTokens: 5,
      outputTextTokens: 10,
      outputAudioTokens: 20,
      totalTokens: 150
    });
    expect(responses.find(
      ({ result }) => result?.providerResponseId === "resp_usage_cancelled"
    )?.result).toMatchObject({
      outcome: "provider_error",
      errorCode: "OPENAI_REALTIME_RESPONSE_CANCELLED",
      usage: { totalTokens: 4 }
    });
    const transcriptions = operations.filter(
      ({ operationType }) => operationType === "transcription"
    );
    expect(transcriptions).toHaveLength(2);
    expect(transcriptions.map(({ stage }) => stage).sort()).toEqual([
      "consent_input_audio",
      "conversation_input_audio"
    ]);
    expect(transcriptions.map(({ result }) => result?.usage?.durationSeconds))
      .toContain(1.25);
    await harness.service.close();
  });

  it("fails closed before opening provider sockets when compilation is not approved", async () => {
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
    let providerSocketCount = 0;
    const bridge = new OpenAIRealtimeBridge({
      apiKey: "test-key",
      service,
      validateStreamToken: () => true,
      createOpenAISocket: () => {
        providerSocketCount += 1;
        return new FakeSocket() as unknown as WebSocket;
      }
    });

    bridge.handleTwilioSocket(twilioSocket as unknown as WebSocket);
    emitJson(twilioSocket, {
      event: "start",
      start: {
        streamSid: "MZ-UNAPPROVED",
        customParameters: {
          callBriefId: created.id,
          streamToken: "valid"
        }
      }
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(providerSocketCount).toBe(0);
    expect(twilioSocket.readyState).toBe(WebSocket.CLOSED);
    await service.close();
  });

  it("fails closed before opening provider sockets when session usage cannot be reserved", async () => {
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
    await service.approveCompilation(created.id);
    const reserved = await service.repository.startAttempt(created.id, {
      provider: "twilio"
    });
    vi.spyOn(service, "startRealtimeProviderSessions").mockRejectedValue(
      new Error("ledger unavailable")
    );
    const twilioSocket = new FakeSocket();
    let providerSocketCount = 0;
    const bridge = new OpenAIRealtimeBridge({
      apiKey: "test-key",
      service,
      validateStreamToken: () => true,
      createOpenAISocket: () => {
        providerSocketCount += 1;
        return new FakeSocket() as unknown as WebSocket;
      }
    });
    bridge.handleTwilioSocket(twilioSocket as unknown as WebSocket);
    emitJson(twilioSocket, {
      event: "start",
      start: {
        streamSid: "MZ-LEDGER-FAILURE",
        customParameters: {
          callBriefId: created.id,
          callAttemptId: reserved.attempt.id,
          compilationSnapshotHash: reserved.attempt.compilationSnapshotHash!,
          streamToken: "valid"
        }
      }
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(providerSocketCount).toBe(0);
    expect(twilioSocket.readyState).toBe(WebSocket.CLOSED);
    await service.close();
  });

  it("rejects a stream whose signed binding does not match the active attempt", async () => {
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
    await service.approveCompilation(created.id);
    const reserved = await service.repository.startAttempt(created.id, {
      provider: "twilio"
    });
    const twilioSocket = new FakeSocket();
    let providerSocketCount = 0;
    const bridge = new OpenAIRealtimeBridge({
      apiKey: "test-key",
      service,
      validateStreamToken: () => true,
      createOpenAISocket: () => {
        providerSocketCount += 1;
        return new FakeSocket() as unknown as WebSocket;
      }
    });

    bridge.handleTwilioSocket(twilioSocket as unknown as WebSocket);
    emitJson(twilioSocket, {
      event: "start",
      start: {
        streamSid: "MZ-MISMATCHED",
        customParameters: {
          callBriefId: created.id,
          callAttemptId: reserved.attempt.id,
          compilationSnapshotHash: "b".repeat(64),
          streamToken: "valid"
        }
      }
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(providerSocketCount).toBe(0);
    expect(twilioSocket.readyState).toBe(WebSocket.CLOSED);
    await service.close();
  });

  it("rejects a pre-migration attempt without immutable stream binding", async () => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository);
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
    await service.approveCompilation(created.id);
    await repository.startAttempt(created.id, { provider: "twilio" });
    const getLatestAttempt = repository.getLatestAttempt.bind(repository);
    vi.spyOn(repository, "getLatestAttempt").mockImplementation(async (id) => {
      const attempt = await getLatestAttempt(id);
      return attempt
        ? {
            ...attempt,
            compilationRevision: null,
            compilationSnapshotHash: null,
            executionSnapshot: null
          }
        : null;
    });
    const twilioSocket = new FakeSocket();
    let providerSocketCount = 0;
    const bridge = new OpenAIRealtimeBridge({
      apiKey: "test-key",
      service,
      validateStreamToken: () => false,
      createOpenAISocket: () => {
        providerSocketCount += 1;
        return new FakeSocket() as unknown as WebSocket;
      }
    });

    bridge.handleTwilioSocket(twilioSocket as unknown as WebSocket);
    emitJson(twilioSocket, {
      event: "start",
      start: {
        streamSid: "MZ-LEGACY",
        customParameters: {
          callBriefId: created.id,
          streamToken: "legacy-valid"
        }
      }
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(providerSocketCount).toBe(0);
    await service.close();
  });

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
    await service.approveCompilation(created.id);
    const reserved = await service.repository.startAttempt(created.id, {
      provider: "twilio"
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
              callAttemptId: reserved.attempt.id,
              compilationSnapshotHash:
                reserved.attempt.compilationSnapshotHash!,
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
    await service.approveCompilation(created.id);
    const reserved = await service.repository.startAttempt(created.id, {
      provider: "twilio"
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
              callAttemptId: reserved.attempt.id,
              compilationSnapshotHash:
                reserved.attempt.compilationSnapshotHash!,
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

  it.each([
    ["Yes, but I don't agree to recording", "en-GB"],
    ["Ja, aber ohne Aufnahme", "de-CH"],
    ["Да, но запись запрещаю", "ru-RU"]
  ] as const)("never starts recording for qualified answer %s", async (transcript, locale) => {
    const harness = await createConsentHarness(false, locale);
    completeConsentPlayback(harness);
    emitJson(harness.consentSocket, {
      type: "conversation.item.input_audio_transcription.completed", transcript
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.startRecording).not.toHaveBeenCalled();
    expect((await harness.service.get(harness.created.id))?.recording).toBeNull();
    expect((await harness.service.listTelemetry(harness.created.id)).some(
      ({ payload }) => payload.name === "consent.granted" || payload.name === "conversation.started"
    )).toBe(false);
    emitJson(harness.twilioSocket, { event: "media", media: { payload: "private-audio" } });
    expect(harness.openAISocket.sent).not.toContainEqual({
      type: "input_audio_buffer.append", audio: "private-audio"
    });
    await harness.service.close();
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

async function createConsentHarness(failRecording = false, locale: typeof brief.locale = brief.locale) {
  const repository = new InMemoryCallRepository();
  const service = new CallService(repository);
  const created = await service.create({
    recipientName: brief.recipientName,
    phoneNumber: brief.phoneNumber,
    objective: brief.objective,
    assistantProfileId: brief.assistantProfileId!,
    representedPersonFirstName: "Nina",
    representedPersonLastName: "Keller",
    assistanceReason: "none",
    context: brief.context,
    locale,
    allowLanguageSwitch: false,
    allowedFacts: brief.allowedFacts
  });
  await service.approveCompilation(created.id);
  const reserved = await service.repository.startAttempt(created.id, {
    provider: "twilio"
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
      customParameters: {
        callBriefId: created.id,
        callAttemptId: reserved.attempt.id,
        compilationSnapshotHash: reserved.attempt.compilationSnapshotHash!,
        streamToken: "valid"
      }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  openAISocket.emit("open");
  consentSocket.emit("open");
  emitJson(openAISocket, { type: "session.updated" });
  emitJson(consentSocket, { type: "session.updated" });
  return {
    service,
    repository,
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
