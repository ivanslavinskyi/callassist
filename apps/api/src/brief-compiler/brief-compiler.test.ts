import {
  CALL_BRIEF_SCHEMA_VERSION,
  normalizeCreateCallBriefInput,
  type CompiledCallBrief,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DeterministicBriefCompiler,
  OpenAIBriefCompiler,
  evaluateCompiledBrief
} from "./brief-compiler";

const rawInput: CreateCallBriefInput = {
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Уточнить, получили ли они заявление, отправленное 12 июля",
  assistantProfileId: "sebastian",
  representedPerson: "Ivan Slavinskyi",
  assistanceReason: "language_barrier",
  context: "Заявление относится к регистрации по месту жительства.",
  locale: "de-CH",
  audioRetentionDays: 7,
  allowLanguageSwitch: false,
  allowedFacts: ["Application sent: 12 July"]
};

const modelOutput = {
  sourceLanguage: "ru",
  taskType: "receipt_confirmation",
  tone: "formal",
  addressingStyle: "formal",
  resultHandling: "capture_in_callassist",
  voicemailAction: "hang_up",
  refusalBehavior: "respect_and_end",
  localizedObjective:
    "Klären, ob der am 12. Juli gesendete Antrag eingegangen ist.",
  opening: {
    recipientAddress: "Vielen Dank, Gemeinde Aadorf.",
    purposeStatement:
      "Ich rufe im Auftrag von Ivan Slavinskyi an, um den Eingang eines am 12. Juli gesendeten Antrags zu klären.",
    readinessQuestion: "Passt es Ihnen, wenn wir das jetzt kurz besprechen?"
  },
  backgroundSummary:
    "Der Antrag betrifft die Anmeldung am Wohnort.",
  orderedQuestions: [
    {
      text: "Ist der am 12. Juli gesendete Antrag eingegangen?",
      purpose: "Den Eingang des Antrags bestätigen",
      required: true
    }
  ],
  conditionalFollowUps: [],
  successCriteria: ["Der Eingang wird eindeutig bestätigt oder verneint"],
  unresolvedCriteria: ["Der Eingang kann nicht geprüft werden"],
  stopConditions: ["Die Frage ist beantwortet", "Die angerufene Person lehnt ab"],
  approvedFacts: [
    {
      sourceText: "Application sent: 12 July",
      callLanguageText: "Antrag gesendet: 12. Juli"
    }
  ],
  prohibitedActions: ["Keine zusätzlichen personenbezogenen Daten erfragen"],
  namedEntities: [
    { type: "organisation", value: "Gemeinde Aadorf" },
    { type: "date", value: "12. Juli" }
  ],
  riskCategories: [],
  blockingIssues: []
};

function compiled(overrides: Partial<CompiledCallBrief> = {}) {
  return {
    ...modelOutput,
    schemaVersion: CALL_BRIEF_SCHEMA_VERSION,
    callLocale: "de-CH" as const,
    ...overrides
  } as CompiledCallBrief;
}

describe("deterministic brief policy", () => {
  it("creates a reviewable immutable development compilation", async () => {
    const result = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(rawInput)
    );

    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(result.compiledBrief?.approvedFacts[0]).toEqual({
      sourceText: "Application sent: 12 July",
      callLanguageText: "Application sent: 12 July"
    });
    expect(result.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.approvedAt).toBeNull();
    expect(result.revision).toBe(1);
    expect(result.compiledBrief?.assumptions).toContain(
      "spoken_answers_saved_in_callassist"
    );
    expect(result.compiledBrief?.opening).toMatchObject({
      recipientAddress: expect.stringContaining("Gemeinde Aadorf"),
      readinessQuestion: expect.any(String)
    });
  });

  it("blocks a model that changes the source text of an approved fact", () => {
    const raw = normalizeCreateCallBriefInput(rawInput);
    const result = evaluateCompiledBrief(
      raw,
      compiled({
        approvedFacts: [
          { sourceText: "Application sent: 13 July", callLanguageText: "13. Juli" }
        ]
      })
    );

    expect(result).toMatchObject({
      status: "blocked",
      reasonCodes: ["fact_integrity_failure"]
    });
  });

  it("blocks risk categories and requests clarification only for fixed issues", () => {
    const raw = normalizeCreateCallBriefInput(rawInput);
    expect(
      evaluateCompiledBrief(
        raw,
        compiled({ riskCategories: ["manipulation_or_coercion"] })
      ).status
    ).toBe("blocked");
    expect(
      evaluateCompiledBrief(
        raw,
        compiled({
          blockingIssues: [
            {
              code: "missing_required_reference",
              question: "Какой именно документ имеется в виду?"
            }
          ]
        })
      )
    ).toMatchObject({
      status: "needs_clarification",
      clarificationQuestions: ["Какой именно документ имеется в виду?"]
    });
  });

  it("does not treat ordinary product defaults as clarification blockers", () => {
    const raw = normalizeCreateCallBriefInput({
      ...rawInput,
      recipientName: "Elena",
      objective: "Call my wife and ask what her favourite book is"
    });
    const result = evaluateCompiledBrief(
      raw,
      compiled({
        addressingStyle: "formal",
        tone: "friendly",
        blockingIssues: [],
        assumptions: [
          "spoken_answers_saved_in_callassist",
          "tone_inferred",
          "no_detailed_voicemail",
          "respect_refusal_and_end"
        ]
      })
    );

    expect(result.status).toBe("ready_for_review");
  });
});

describe("OpenAIBriefCompiler", () => {
  it("moderates input and requests a strict Structured Output", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "resp_123", output_text: JSON.stringify(modelOutput) }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      );
    const compiler = new OpenAIBriefCompiler({
      apiKey: "test-key",
      model: "gpt-test",
      fetchImplementation: fetchMock
    });

    const result = await compiler.compile(normalizeCreateCallBriefInput(rawInput));
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(result.compiledBrief?.localizedObjective).toContain("Antrag");
    expect(result.compilerResponseId).toBe("resp_123");

    const request = fetchMock.mock.calls[1]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: "gpt-test",
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "callassist_compiled_brief",
          strict: true
        }
      }
    });
    expect(body.input[1].content).toContain(rawInput.objective);
    expect(JSON.parse(body.input[1].content)).toMatchObject({
      resultHandling: "capture_in_callassist",
      addressingMode: "formal",
      tonePreference: "auto",
      voicemailPolicy: "do_not_leave_details"
    });
    expect(body.text.format.schema.required).toContain("blockingIssues");
    expect(body.text.format.schema.required).toContain("opening");
    expect(body.text.format.schema.properties.opening).toMatchObject({
      additionalProperties: false,
      required: [
        "recipientAddress",
        "purposeStatement",
        "readinessQuestion"
      ]
    });
    expect(body.text.format.schema.required).not.toContain(
      "materialAmbiguities"
    );
    expect(body.text.format.schema.properties.sourceLanguage.pattern).toBe(
      "^[A-Za-z0-9-]{2,35}$"
    );
    expect(body.text.format.schema.properties.orderedQuestions).toMatchObject({
      minItems: 1,
      maxItems: 12
    });
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain(
      modelOutput.opening.purposeStatement
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(
        new Headers(init?.headers).get("X-Client-Request-Id")
      ).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("retries a timed-out request while the total compilation budget remains", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true }
          );
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: JSON.stringify(modelOutput) }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      );

    const result = await new OpenAIBriefCompiler({
      apiKey: "test-key",
      timeoutMs: 200,
      requestTimeoutMs: 10,
      fetchImplementation: fetchMock
    }).compile(normalizeCreateCallBriefInput(rawInput));

    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(fetchMock.mock.calls[1]?.[0]);
  });

  it("retries once with validation feedback when model output violates the local schema", async () => {
    const invalidOutput = {
      ...modelOutput,
      sourceLanguage: "Russian language inferred from the original objective",
      orderedQuestions: []
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_invalid",
            output_text: JSON.stringify(invalidOutput)
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_corrected",
            output_text: JSON.stringify(modelOutput)
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      );

    const result = await new OpenAIBriefCompiler({
      apiKey: "test-key",
      fetchImplementation: fetchMock
    }).compile(normalizeCreateCallBriefInput(rawInput));

    expect(result.compilerResponseId).toBe("resp_corrected");
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    );
    expect(retryBody.input[0].content).toContain("sourceLanguage");
    expect(retryBody.input[0].content).toContain("orderedQuestions");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns safe diagnostics after two invalid compiler responses", async () => {
    const invalidOutput = { ...modelOutput, orderedQuestions: [] };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ output_text: JSON.stringify(invalidOutput) }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_still_invalid",
            output_text: JSON.stringify(invalidOutput)
          }),
          { status: 200 }
        )
      );

    await expect(
      new OpenAIBriefCompiler({
        apiKey: "test-key",
        fetchImplementation: fetchMock
      }).compile(normalizeCreateCallBriefInput(rawInput))
    ).rejects.toMatchObject({
      code: "OPENAI_RESPONSE_INVALID",
      responseId: "resp_still_invalid",
      validationPaths: ["orderedQuestions"]
    });
  });

  it("ignores an external-delivery blocker when spoken answers are captured", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              ...modelOutput,
              blockingIssues: [
                {
                  code: "missing_external_delivery_details",
                  question: "Куда передать ответ?"
                }
              ]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      );

    const result = await new OpenAIBriefCompiler({
      apiKey: "test-key",
      fetchImplementation: fetchMock
    }).compile(normalizeCreateCallBriefInput(rawInput));

    expect(result.compiledBrief?.blockingIssues).toEqual([]);
    expect(result.policyDecision.status).toBe("ready_for_review");
  });

  it("blocks moderated input without invoking the compiler model", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [{ flagged: true }] }), {
        status: 200
      })
    );
    const result = await new OpenAIBriefCompiler({
      apiKey: "test-key",
      fetchImplementation: fetchMock
    }).compile(normalizeCreateCallBriefInput(rawInput));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.compiledBrief).toBeNull();
    expect(result.policyDecision.reasonCodes).toEqual([
      "input_moderation_flagged"
    ]);
  });

  it("stores an explicit model refusal as a blocked decision", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_refusal",
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "Cannot comply" }]
              }
            ]
          }),
          { status: 200 }
        )
      );

    const result = await new OpenAIBriefCompiler({
      apiKey: "test-key",
      fetchImplementation: fetchMock
    }).compile(normalizeCreateCallBriefInput(rawInput));
    expect(result.policyDecision.reasonCodes).toEqual(["model_refusal"]);
    expect(result.compilerResponseId).toBe("resp_refusal");
  });

  it("blocks generated runtime text flagged by output moderation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: JSON.stringify(modelOutput) }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ flagged: true }] }), {
          status: 200
        })
      );

    const result = await new OpenAIBriefCompiler({
      apiKey: "test-key",
      fetchImplementation: fetchMock
    }).compile(normalizeCreateCallBriefInput(rawInput));
    expect(result.policyDecision).toMatchObject({
      status: "blocked",
      reasonCodes: ["prohibited_content"]
    });
  });
});
