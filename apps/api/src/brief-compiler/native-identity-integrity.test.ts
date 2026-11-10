import {
  callCompilationSchema,
  createApprovedExecutionSnapshot,
  defaultPreparationRuntimePolicy,
  nativeActionCompiledCallBriefSchema,
  normalizeCreateCallBriefInput,
  previousCompiledCallBriefSchema,
  currentCompiledCallBriefSchema,
  SUPPORTED_CALL_LOCALES,
  type NativeAppointmentOperation
} from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import { evaluateCompiledBrief, OpenAIBriefCompiler } from "./brief-compiler";
import { hasValidCompilationSnapshotHash } from "./compilation-integrity";
import { NATIVE_INTEGRITY_POLICY } from "./native-appointment-compilation";
import { nativeV2Session } from "../voice/live-task-context";
import { nativeAuthority } from "../test-helpers/native-appointment";

// Anonymized production regression: the full represented name is in metadata,
// while the concise task prose only needs the recipient's first name.
const raw = normalizeCreateCallBriefInput({
  recipientName: "Nina", phoneNumber: "+41710000001",
  objective: "узнай у нины что она хочет на обед. если скажет пиццу - уточни какую именно",
  representedPersonFirstName: "Nina", representedPersonLastName: "Keller",
  assistantProfileId: "sebastian", assistanceReason: "none", context: "",
  locale: "de-CH", audioRetentionDays: 30, allowedFacts: [], allowLanguageSwitch: false,
  addressingMode: "formal", tonePreference: "neutral"
});
const plan = nativeActionCompiledCallBriefSchema.parse({
  schemaVersion: "9", callLocale: "de-CH", sourceLanguage: "ru",
  taskType: "information_request", tone: "neutral", addressingStyle: "formal",
  resultHandling: "capture_in_callassist", voicemailAction: "hang_up", refusalBehavior: "respect_and_end",
  localizedObjective: "Nina fragen, was sie zum Mittagessen möchte. Falls sie Pizza möchte, nachfragen, welche genau.",
  opening: {
    recipientAddress: "Nina",
    purposeStatement: "Ich möchte Sie fragen, was Sie zum Mittagessen möchten.",
    readinessQuestion: "Passt es Ihnen gerade?"
  },
  backgroundSummary: "",
  orderedQuestions: [{ text: "Was möchten Sie zum Mittagessen?", purpose: "Den gewünschten Lunch von Nina erfahren.", required: true }],
  conditionalFollowUps: [{ condition: "Nina sagt, dass sie Pizza möchte.", question: "Welche Pizza möchten Sie genau?" }],
  successCriteria: ["Es ist geklärt, was Nina zum Mittagessen möchte.", "Falls Nina Pizza möchte, ist geklärt, welche Pizza genau."],
  unresolvedCriteria: ["Nina nennt keinen konkreten Wunsch für das Mittagessen.", "Bei Pizza bleibt die genaue Sorte unklar."],
  stopConditions: ["Nina lehnt das Gespräch ab."], approvedFacts: [],
  prohibitedActions: ["Keine Essensbestellung aufgeben."],
  namedEntities: [{ type: "person", value: "Nina" }, { type: "person", value: "Nina Keller" }],
  riskCategories: [], assumptions: ["respect_refusal_and_end", "spoken_answers_saved_in_callassist", "no_detailed_voicemail"],
  blockingIssues: [], appointmentAuthorization: null, contextAppendix: [], nativeAppointmentAuthorization: null
});

// Both parties can be absent from the prose: the approved startup parties and
// opener carry their authoritative identities independently of the task text.
const metadataOnlyPlan = nativeActionCompiledCallBriefSchema.parse({
  ...plan,
  localizedObjective: "Ask about the lunch preference and, if pizza, its type.",
  opening: { recipientAddress: "Hello", purposeStatement: "I would like to ask about lunch.", readinessQuestion: "Is now convenient?" },
  orderedQuestions: [{ text: "What would you like for lunch?", purpose: "Find out the lunch preference.", required: true }],
  conditionalFollowUps: [{ condition: "The recipient wants pizza.", question: "Which pizza would you like?" }],
  successCriteria: ["The lunch preference is known, including the pizza type if applicable."],
  unresolvedCriteria: ["The lunch preference or requested pizza type remains unknown."],
  stopConditions: ["The recipient declines the conversation."],
  prohibitedActions: ["Do not place a food order."]
});

describe("native identity integrity", () => {
  it("accepts a preserved identity in native metadata without forcing it into task prose", () => {
    expect(evaluateCompiledBrief(raw, plan)).toMatchObject({ status: "ready_for_review", reasonCodes: [] });
    expect(evaluateCompiledBrief(raw, { ...plan, backgroundSummary: raw.representedPerson }).status).toBe("ready_for_review");
  });

  it.each(SUPPORTED_CALL_LOCALES)("validates complete declared identities independently of call locale %s", locale => {
    const identities = [
      { type: "person", original: "Nina Keller", declared: "NINA KELLER" },
      { type: "person", original: "Jean-Luc D’Amico", declared: "Jean-Luc D'Amico" },
      { type: "person", original: "Олена Коваленко", declared: "Olena Kovalenko" },
      { type: "person", original: "受付窓口", declared: "受付窓口" },
      { type: "organisation", original: "Praxis Müller Bern", declared: "PRAXIS MULLER BERN" },
      { type: "organisation", original: "Центр Олена", declared: "Tsentr Olena" },
      { type: "location", original: "Café Bellevue", declared: "Cafe\u0301 Bellevue" }
    ] as const;
    for (const recipient of identities) {
      const input = { ...raw, locale, recipientName: recipient.original, representedPerson: "Zoë Martin" };
      const compiled = { ...metadataOnlyPlan, callLocale: locale, namedEntities: [
        { type: recipient.type, value: recipient.declared }, { type: "person" as const, value: "Zoe Martin" }
      ] };
      expect(evaluateCompiledBrief(input, compiled), recipient.original).toMatchObject({
        status: "ready_for_review", reasonCodes: []
      });
      // The exemption is only for sourced identity labels, never arbitrary metadata.
      expect(evaluateCompiledBrief(input, { ...compiled, namedEntities: [
        ...compiled.namedEntities, { type: recipient.type, value: `${recipient.declared} Invented` }
      ] }).reasonCodes, recipient.original).toEqual(["fact_integrity_failure"]);
    }
  });

  it("still blocks an omitted, shortened or altered represented identity", () => {
    for (const name of [null, "Nina", "Nina Keler", "Nena Keller"]) {
      const namedEntities = [{ type: "person" as const, value: "Nina" },
        ...(name ? [{ type: "person" as const, value: name }] : [])];
      expect(evaluateCompiledBrief(raw, { ...plan, namedEntities })).toMatchObject({
        status: "blocked", reasonCodes: ["fact_integrity_failure"]
      });
    }
  });

  it("rejects an invented identity even alongside the exact original identities", () => {
    expect(evaluateCompiledBrief(raw, {
      ...plan, namedEntities: [...plan.namedEntities, { type: "person", value: "Nina Keler" }]
    })).toMatchObject({ status: "blocked", reasonCodes: ["fact_integrity_failure"] });
  });

  it.each(["Praxis Müller", "Praxis Müller Zürich", "Müller Bern", "Muller Clinic Bern"])(
    "rejects shortening, branch substitution or guessed translation: %s", declared => {
      expect(evaluateCompiledBrief({ ...raw, recipientName: "Praxis Müller Bern" }, {
        ...metadataOnlyPlan, namedEntities: [
          { type: "organisation", value: declared }, { type: "person", value: raw.representedPerson }
        ]
      })).toMatchObject({ status: "blocked", reasonCodes: ["fact_integrity_failure"] });
    }
  );

  it("does not treat non-identity metadata as a preserved party", () => {
    expect(evaluateCompiledBrief(raw, { ...plan, namedEntities: [
      { type: "person", value: raw.recipientName }, { type: "other", value: raw.representedPerson }
    ] })).toMatchObject({ status: "blocked", reasonCodes: ["fact_integrity_failure"] });
  });

  it("does not use identity metadata to satisfy required identifiers or postal addresses", () => {
    expect(evaluateCompiledBrief(raw, { ...plan, backgroundSummary: "Referenz AB-123-XY." })).toMatchObject({
      status: "blocked", reasonCodes: ["fact_integrity_failure"]
    });
    const address = "Bahnhofstrasse 10, 8001 Zürich";
    expect(evaluateCompiledBrief({ ...raw, context: address }, {
      ...plan, namedEntities: [...plan.namedEntities, { type: "location", value: address }]
    })).toMatchObject({ status: "blocked", reasonCodes: ["fact_integrity_failure"] });
  });

  it("preserves the historical managed validation path, including its intermediate schema", () => {
    for (const historical of [previousCompiledCallBriefSchema.parse({ ...plan, schemaVersion: "4" }),
      currentCompiledCallBriefSchema.parse({ ...plan, schemaVersion: "8" })]) {
      expect(evaluateCompiledBrief(raw, historical)).toMatchObject({
        status: "blocked", reasonCodes: ["fact_integrity_failure"]
      });
    }
  });

  it.each(["general", "book", "confirm_existing", "reschedule", "cancel"] as const)(
    "compiles %s once, keeps the review gate and passes authoritative identities to Live", async profile => {
    const appointmentObjectives: Record<NativeAppointmentOperation, string> = {
      book: "Book a routine consultation next week between nine and five.",
      confirm_existing: "Confirm attendance at the routine consultation on 2099-09-10 at noon.",
      reschedule: "Move the routine consultation on 2099-09-10 at noon to next week between nine and five.",
      cancel: "Cancel the routine consultation on 2099-09-10 at noon."
    };
    const input = profile === "general" ? raw : {
      ...raw, recipientName: "Practice", locale: "en-GB" as const, objective: appointmentObjectives[profile]
    };
    const modelPlan = profile === "general" ? plan : {
      ...metadataOnlyPlan, callLocale: input.locale, sourceLanguage: "en", taskType: "appointment_coordination",
      localizedObjective: input.objective,
      opening: { ...metadataOnlyPlan.opening, purposeStatement: "I am calling about a routine consultation." },
      orderedQuestions: [{ text: "Can you help with this appointment request?", purpose: "Resolve the requested appointment operation.", required: true }],
      conditionalFollowUps: [],
      successCriteria: ["The provider explicitly confirms the requested appointment operation."],
      unresolvedCriteria: ["The requested operation is not confirmed."], prohibitedActions: ["Do not accept unapproved financial terms."],
      namedEntities: [{ type: "organisation", value: input.recipientName }, { type: "person", value: input.representedPerson }]
    };
    const interpretation = profile === "general" ? { intent: "none", authorityEvidence: null, authorization: null } : {
      intent: profile, authorityEvidence: { source: "objective", clarificationAnswerIndex: null, quote: input.objective },
      authorization: {
        ...nativeAuthority, operation: profile,
        existingAppointment: profile === "book" ? null : { date: "2099-09-10", startTime: "12:00", reference: null },
        alternatives: profile === "book" || profile === "reschedule" ? [{
          ...nativeAuthority.alternatives[0], rules: [{ dates: { kind: "next_calendar_week" },
            weekdays: [], excludedWeekdays: [], excludedDates: [], startTime: "09:00", endTime: "17:00" }]
        }] : []
      }
    };
    let generations = 0, audits = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("moderations")) return Response.json({ results: [{ flagged: false }] });
      const body = JSON.parse(String(init?.body));
      if (body.text?.format?.name === "execution_language_audit") {
        audits++;
        return Response.json({ output_text: JSON.stringify({ violations: [] }) });
      }
      generations++;
      return Response.json({ output_text: JSON.stringify({ ...modelPlan,
        nativeAppointmentInterpretation: interpretation
      }) });
    });
    const result = await new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation,
      now: () => new Date("2099-09-01T10:00:00.000Z") }).compile(input, 1, {
      policy: { ...defaultPreparationRuntimePolicy, promptVersion: NATIVE_INTEGRITY_POLICY }
    });
    expect(result).toMatchObject({ compilerVersion: "brief-compiler-13", approvedAt: null,
      policyDecision: { status: "ready_for_review" }, compiledBrief: { schemaVersion: "9", backgroundSummary: "" } });
    expect(generations).toBe(1);
    expect(audits).toBe(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(callCompilationSchema.parse(result)).toEqual(result);
    expect(hasValidCompilationSnapshotHash(result)).toBe(true);

    const time = "2026-11-09T10:00:00.000Z";
    const brief = { ...input, id: "11111111-1111-4111-8111-111111111111", status: "ready" as const, createdAt: time, updatedAt: time };
    expect(() => createApprovedExecutionSnapshot({ brief, compilation: result })).toThrow("CALL_EXECUTION_SNAPSHOT_NOT_APPROVED");
    const execution = createApprovedExecutionSnapshot({ brief, compilation: { ...result, approvedAt: time } });
    expect(execution.runtime.spokenIdentities).toMatchObject({
      recipient: { original: input.recipientName }, representedPerson: { original: "Nina Keller", spoken: "Nina Keller" }
    });
    expect(()=>nativeV2Session(execution)).toThrow("LIVE_V2_REAPPROVAL_REQUIRED");
  });
});
