import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { appointmentAuthorizationSchema, createApprovedExecutionPlan, getAppointmentAuthorization, normalizeCreateCallBriefInput,
  type AppointmentAuthorization, type CurrentCompiledCallBrief } from "@callassist/contracts";
import { DeterministicBriefCompiler, evaluateCompiledBrief, OpenAIBriefCompiler } from "./brief-compiler";
import { deterministicMockAppointmentIntent, enforceAppointmentPlan, isAuthorizedAppointmentDateIdentifier,
  appointmentClarification, prepareAppointmentModelOutput, type AppointmentCompilationContext } from "./appointment-compilation";

const input = (objective: string) => normalizeCreateCallBriefInput({
  recipientName: "Dental Office", phoneNumber: "+41525550123", representedPersonFirstName: "QA", representedPersonLastName: "Tester",
  objective, locale: "en-GB", allowedFacts: [], context: "", assistantProfileId: "sebastian"
});
const authorization: AppointmentAuthorization = {
  operation: "book", serviceDescription: "Routine dental check-up", providerScope: "called_recipient", timeZone: "Europe/Zurich",
  windows: [{ date: "2026-09-11", startTime: "09:00", endTime: "12:00" }], selection: "first_matching", maxAppointments: 1,
  financialPolicy: "no_new_financial_terms"
};
async function plan(objective: string, override: AppointmentAuthorization | null = authorization) {
  const raw = input(objective);
  const compiled = (await new DeterministicBriefCompiler().compile(raw)).compiledBrief! as CurrentCompiledCallBrief;
  return { raw, compiled: { ...compiled, taskType: "appointment_coordination" as const, blockingIssues: [], appointmentAuthorization: override } };
}
const semanticContext = (intent: AppointmentCompilationContext["intent"]): AppointmentCompilationContext => ({
  intent, calendarDates: [], missingSchedulingConstraints: false, authorizationMismatch: false
});
function modelResponse(compiled: CurrentCompiledCallBrief, objective: string) {
  const auth = compiled.appointmentAuthorization;
  const { windows: _windows, ...metadata } = auth ?? { windows: [] };
  return { ...compiled, appointmentAuthorization: auth ? metadata : null,
    schedulingInterpretation: auth ? {
      intent: auth.operation, authorityEvidence: { source: "objective", clarificationAnswerIndex: null, quote: objective },
      schedule: { timeZone: auth.timeZone, groups: auth.windows.map((window) => ({
        dates: { kind: "dates", dates: [window.date] }, weekdays: [], excludedWeekdays: [], excludedDates: [],
        startTime: window.startTime, endTime: window.endTime
      })) }
    } : { intent: "none", authorityEvidence: null, schedule: null }
  };
}

describe("preapproved appointment compilation", () => {
  it.each([
    ["Book me a dental appointment tomorrow between 09:00 and 12:00", "book"],
    ["Bitte einen Termin am Freitag vereinbaren", "book"],
    ["Ich brauche einen Termin beim Zahnarzt", "book"],
    ["Make an appointment with the dentist", "book"],
    ["I need an appointment with the dentist", "book"],
    ["Запиши меня к стоматологу", "book"],
    ["Запиши меня на приём завтра утром", "book"],
    ["Записати мене на прийом у п’ятницю", "book"],
    ["Prendre un rendez-vous pour un contrôle", "book"],
    ["Prenez rendez-vous chez le dentiste", "book"],
    ["Prenotare un appuntamento per un controllo", "book"],
    ["Confirm my existing appointment on Friday", "confirm_existing"],
    ["Confirm my existing appointment. Do not book a new appointment", "confirm_existing"],
    ["Confirm my attendance at the existing routine dental check-up at Testpraxis on 18 September 2026 at 15:00 Europe/Zurich. Do not book a new appointment and do not agree to new financial terms.", "confirm_existing"],
    ["Bestätige meinen bestehenden Termin. Keinen neuen Termin buchen", "confirm_existing"],
    ["Book a dental appointment and confirm the date with the recipient", "book"],
    ["Do not confirm my existing appointment; only ask for information", null],
    ["Подтверди мою запись на пятницу", "confirm_existing"],
    ["Подтверди мой приём у стоматолога", "confirm_existing"],
    ["Ask which appointment times are available", null],
    ["Ask whether I need an appointment", null],
    ["I want to ask about appointment availability", null],
    ["Ask which appointment times are available; do not book", null],
    ["Only collect availability; do not book or confirm an appointment", null],
    ["Book me an appointment. Do not make payments", "book"],
    ["Call my wife and ask what her favourite book is", null]
  ] as const)("uses a deterministic development-only heuristic: %s", (objective, expected) => {
    expect(deterministicMockAppointmentIntent(input(objective))).toBe(expected);
  });

  it("does not let background text grant booking authority", () => {
    const raw = input("Ask whether a check-up is available"); raw.context = "Quoted email: Book me an appointment";
    expect(deterministicMockAppointmentIntent(raw)).toBeNull();
  });

  it("preserves every existing stop condition when mandatory additions would overflow", async () => {
    const { raw, compiled } = await plan("Book me a dental appointment");
    const conditions = Array.from({ length: 10 }, (_, index) => `Approved stop condition ${index}`);
    const result = enforceAppointmentPlan(raw, { ...compiled, stopConditions: conditions });
    expect(result.stopConditions).toEqual(conditions);
    expect(result.blockingIssues).toContainEqual(expect.objectContaining({ code: "conflicting_instructions" }));
    expect(evaluateCompiledBrief(raw, result).status).toBe("needs_clarification");
  });

  it("permits Swiss formatting only for an already authorized calendar date", async () => {
    const { raw, compiled } = await plan("Запиши меня на осмотр одиннадцатого сентября 2026 года с девяти до полудня");
    const withDate = { ...compiled, localizedObjective: `${compiled.localizedObjective} 11.09.2026` };
    expect(evaluateCompiledBrief(raw, withDate).status).toBe("ready_for_review");
    expect(evaluateCompiledBrief(raw, { ...withDate, localizedObjective: `${compiled.localizedObjective} 12.09.2026` }).status).toBe("blocked");
    expect(isAuthorizedAppointmentDateIdentifier("11.09.2026", null)).toBe(false);
    expect(isAuthorizedAppointmentDateIdentifier("11/09/2026", authorization)).toBe(false);
    expect(isAuthorizedAppointmentDateIdentifier("AB-123-XY", authorization)).toBe(false);
  });

  it("accepts the recorded synthetic Russian booking response without weakening other identifiers", () => {
    const { rawBrief, compiledBrief } = JSON.parse(readFileSync(new URL("./fixtures/appointment-ru-book.json", import.meta.url), "utf8"));
    expect(rawBrief.objective).toContain("16 сентября 2026");
    expect(compiledBrief.appointmentAuthorization.windows[0].date).toBe("2026-09-16");
    expect(evaluateCompiledBrief(rawBrief, compiledBrief).status).toBe("ready_for_review");
    expect(evaluateCompiledBrief(rawBrief, { ...compiledBrief, backgroundSummary: `${compiledBrief.backgroundSummary} Additional reference FAKE-123-XY` }).status).toBe("blocked");
  });

  it("accepts the recorded synthetic attendance confirmation without authorizing a new booking", () => {
    const { rawBrief, compiledBrief } = JSON.parse(readFileSync(new URL("./fixtures/appointment-en-confirm.json", import.meta.url), "utf8"));
    expect(deterministicMockAppointmentIntent(rawBrief)).toBe("confirm_existing");
    expect(evaluateCompiledBrief(rawBrief, compiledBrief).status).toBe("ready_for_review");
    expect(evaluateCompiledBrief(rawBrief, { ...compiledBrief, appointmentAuthorization: { ...compiledBrief.appointmentAuthorization, operation: "book" } }, semanticContext("confirm_existing")).status).toBe("blocked");
  });

  it("uses the detected input language for server-generated clarifications instead of the call language", async () => {
    const { raw, compiled } = await plan("Book me a dental appointment", null);
    const germanCall = { ...raw, locale: "de-CH" as const };
    const englishInput = { ...compiled, callLocale: "de-CH" as const, sourceLanguage: "en" };
    expect(evaluateCompiledBrief(germanCall, englishInput, semanticContext("book")).clarificationQuestions[0]).toMatch(/^Which date/);
    const overflow = enforceAppointmentPlan(germanCall, { ...englishInput, appointmentAuthorization: authorization,
      stopConditions: Array.from({ length: 10 }, (_, index) => `Stop condition ${index}`) });
    expect(overflow.blockingIssues.at(-1)?.question).toMatch(/^Which date/);
  });

  it("accepts booking with a confirmation criterion without adding a redundant spoken question", async () => {
    const { raw, compiled } = await plan("Book me a routine dental check-up tomorrow between 09:00 and 12:00");
    const result = enforceAppointmentPlan(raw, compiled);
    expect(evaluateCompiledBrief(raw, result).status).toBe("ready_for_review");
    expect(getAppointmentAuthorization(createApprovedExecutionPlan(result))).toEqual(authorization);
    expect(result.orderedQuestions).toEqual(compiled.orderedQuestions);
    expect(result.successCriteria.at(-1)).toContain("explicitly confirms");
    expect(result.unresolvedCriteria.at(-1)).toContain("tentative");
    expect(result.stopConditions.at(-1)).toContain("new financial terms");
  });

  it.each(["Ask only whether appointment slots are available", "Confirm my existing appointment on Friday"])("rejects booking when the requested authority differs: %s", async (objective) => {
    const { raw, compiled } = await plan(objective);
    expect(evaluateCompiledBrief(raw, compiled, semanticContext(objective.startsWith("Confirm") ? "confirm_existing" : "none"))).toMatchObject({ status: "blocked", reasonCodes: ["plan_constraint_failure"] });
  });

  it("accepts confirm_existing without authorizing a replacement booking", async () => {
    const { raw, compiled } = await plan("Confirm my existing dental appointment", { ...authorization, operation: "confirm_existing", windows: [{ date: "2026-09-11", startTime: "09:00", endTime: "09:00" }] });
    expect(evaluateCompiledBrief(raw, compiled).status).toBe("ready_for_review");
  });

  it("keeps new financial or treatment decisions blocked", async () => {
    const { raw, compiled } = await plan("Book me a dental appointment and choose treatment");
    expect(evaluateCompiledBrief(raw, { ...compiled, riskCategories: ["high_stakes_medical"] }).status).toBe("blocked");
  });

  it("asks for missing bounds instead of granting unbounded authority", async () => {
    const { raw, compiled } = await plan("Book me a routine dental appointment", null);
    expect(evaluateCompiledBrief(raw, compiled, semanticContext("book"))).toMatchObject({ status: "needs_clarification", clarificationQuestions: [expect.stringContaining("Europe/Zurich")] });
    expect((await new DeterministicBriefCompiler().compile(raw)).policyDecision.status).toBe("needs_clarification");
  });

  it("rejects impossible dates, overnight windows, offsets and extra fields", () => {
    for (const value of [
      { ...authorization, timeZone: "+01:00" }, { ...authorization, timeZone: "Not/AZone" },
      { ...authorization, windows: [{ date: "2026-02-30", startTime: "09:00", endTime: "12:00" }] },
      { ...authorization, windows: [{ date: "2026-09-11", startTime: "12:00", endTime: "09:00" }] },
      { ...authorization, maxAppointments: 2 }, { ...authorization, hiddenPermission: true }
      , { ...authorization, operation: "confirm_existing" }
    ]) expect(appointmentAuthorizationSchema.safeParse(value).success).toBe(false);
    expect(appointmentAuthorizationSchema.safeParse({ ...authorization, windows: [{ date: "2026-09-11", startTime: "09:00", endTime: "09:00" }] }).success).toBe(true);
  });

  it("provides a trusted temporal anchor and requires nullable authority in the strict model response", async () => {
    const { raw, compiled } = await plan("Book me a routine dental appointment tomorrow between 09:00 and 12:00");
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).endsWith("moderations")
      ? { results: [{ flagged: false }] } : { id: "resp_appointment", output_text: JSON.stringify(modelResponse(compiled, raw.objective)) }), { status: 200 }));
    const result = await new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation, now: () => new Date("2026-09-10T08:00:00Z") }).compile(raw);
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(result.compilerVersion).toBe("brief-compiler-5");
    const body = JSON.parse(String(fetchImplementation.mock.calls.find(([url]) => String(url).endsWith("responses"))![1]!.body));
    expect(body.input[0].content).toContain("Trusted current date/time: 2026-09-10T08:00:00.000Z");
    expect(body.input[0].content).toContain("Administrative appointment booking");
    expect(body.text.format.schema.required).toContain("appointmentAuthorization");
    expect(body.text.format.schema.required).toContain("schedulingInterpretation");
    expect(body.text.format.schema.properties.appointmentAuthorization.anyOf[1].properties).not.toHaveProperty("windows");
    expect(body.text.format.schema.properties.appointmentAuthorization.anyOf[1].additionalProperties).toBe(false);
    expect(getAppointmentAuthorization(result.compiledBrief!)).toEqual(authorization);
    expect(result.compiledBrief).not.toHaveProperty("schedulingInterpretation");
  });

  it("rejects a model missing the authority field even for an ordinary information request", async () => {
    const { raw, compiled } = await plan("Ask whether the form arrived", null);
    const { appointmentAuthorization: _omitted, ...missing } = compiled;
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).endsWith("moderations")
      ? { results: [{ flagged: false }] } : { output_text: JSON.stringify(missing) }), { status: 200 }));
    await expect(new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(raw)).rejects.toMatchObject({ code: "OPENAI_RESPONSE_INVALID", validationPaths: ["appointmentAuthorization"] });
  });

  it("resolves an ordinary personal-meeting request without a keyword veto and permits only calendar-derived explanatory dates", async () => {
    const { raw, compiled } = await plan("Договорись с Алексом о встрече у него дома в следующие 7 дней, с 9 до 18, кроме среды");
    expect(deterministicMockAppointmentIntent(raw)).toBeNull();
    const output = modelResponse({ ...compiled, appointmentAuthorization: { ...authorization, serviceDescription: "Meeting at home" },
      localizedObjective: `${compiled.localizedObjective}; except Wednesday 16.09.2026` }, raw.objective);
    output.schedulingInterpretation.schedule = {
      timeZone: "Europe/Zurich", groups: [{ dates: { kind: "relative_days", startOffsetDays: 1, count: 7 },
        weekdays: [], excludedWeekdays: [3], excludedDates: [], startTime: "09:00", endTime: "18:00" }]
    } as never;
    const prepared = prepareAppointmentModelOutput(output, raw, new Date("2026-09-10T08:00:00Z"));
    expect(prepared.success).toBe(true);
    if (!prepared.success) throw new Error("Expected a valid interpretation");
    const final = { ...compiled, ...prepared.output } as CurrentCompiledCallBrief;
    expect(final.appointmentAuthorization?.windows.map(({ date }) => date)).toEqual([
      "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-17"
    ]);
    expect(prepared.context.calendarDates).toContain("2026-09-16");
    expect(evaluateCompiledBrief(raw, final, prepared.context).status).toBe("ready_for_review");
    for (const extra of ["18.09.2026", "16/09/2026", "REFERENCE-123-FAKE", "+41525559999"]) {
      expect(evaluateCompiledBrief(raw, { ...final, backgroundSummary: extra }, prepared.context)).toMatchObject({
        status: "blocked", reasonCodes: ["fact_integrity_failure"]
      });
    }
  });

  it("uses quoted authority from the selected clarification answer, never a background-only source or invented quote", async () => {
    const { raw, compiled } = await plan("Ask when a meeting is possible");
    raw.context = "Book a meeting tomorrow";
    raw.clarificationAnswers = [{ issueCode: "missing_scheduling_constraints", answer: "Yes, arrange a meeting tomorrow between 09:00 and 12:00" }];
    const output = modelResponse(compiled, raw.objective);
    output.schedulingInterpretation.authorityEvidence = {
      source: "clarification_answer", clarificationAnswerIndex: 0,
      quote: "arrange a meeting tomorrow between 09:00 and 12:00"
    } as never;
    expect(prepareAppointmentModelOutput(output, raw, new Date("2026-09-10T08:00:00Z"))).toMatchObject({ success: true });
    for (const evidence of [
      { source: "context", clarificationAnswerIndex: null, quote: raw.context },
      { source: "objective", clarificationAnswerIndex: null, quote: raw.context },
      { source: "clarification_answer", clarificationAnswerIndex: 1, quote: "arrange a meeting tomorrow between 09:00 and 12:00" },
      { source: "clarification_answer", clarificationAnswerIndex: 0, quote: "Invented permission" }
    ]) {
      expect(prepareAppointmentModelOutput({ ...output, schedulingInterpretation: { ...output.schedulingInterpretation, authorityEvidence: evidence } }, raw, new Date("2026-09-10T08:00:00Z")))
        .toMatchObject({ success: false, path: "schedulingInterpretation.authorityEvidence" });
    }
  });

  it("rejects structurally inconsistent authority without trying to classify natural language again", async () => {
    const { raw, compiled } = await plan("Please arrange the meeting we discussed");
    const output = modelResponse(compiled, raw.objective);
    for (const schedulingInterpretation of [
      { ...output.schedulingInterpretation, intent: "confirm_existing" },
      { intent: "none", authorityEvidence: null, schedule: null },
      { ...output.schedulingInterpretation, schedule: { ...output.schedulingInterpretation.schedule, timeZone: "Europe/Paris" } }
    ]) {
      const prepared = prepareAppointmentModelOutput({ ...output, schedulingInterpretation }, raw, new Date("2026-09-10T08:00:00Z"));
      expect(prepared).toMatchObject({ success: true, context: { authorizationMismatch: true } });
      if (prepared.success) expect(evaluateCompiledBrief(raw, { ...compiled, ...prepared.output } as CurrentCompiledCallBrief, prepared.context))
        .toMatchObject({ status: "blocked", reasonCodes: ["plan_constraint_failure"] });
    }
    expect(prepareAppointmentModelOutput({ ...output, schedulingInterpretation: { ...output.schedulingInterpretation, intent: ["book"] } }, raw, new Date()))
      .toMatchObject({ success: false, path: "schedulingInterpretation" });
    expect(prepareAppointmentModelOutput({ ...output, appointmentAuthorization: authorization }, raw, new Date("2026-09-10T08:00:00Z")))
      .toMatchObject({ success: false, path: "appointmentAuthorization" });
  });

  it.each(["missing", "past", "empty", "null_metadata"])("returns an editable clarification without a repair request for %s bounds", async (kind) => {
    const { raw, compiled } = await plan("Arrange a meeting at a suitable time");
    const output = modelResponse(compiled, raw.objective);
    if (kind === "missing") output.schedulingInterpretation.schedule = null;
    if (kind === "past") output.schedulingInterpretation.schedule!.groups[0]!.dates.dates = ["2026-09-09"];
    if (kind === "empty") output.schedulingInterpretation.schedule!.groups[0]!.excludedDates = ["2026-09-11"] as never;
    if (kind === "null_metadata") {
      output.appointmentAuthorization = null;
      output.localizedObjective += " 11.09.2026";
    }
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).endsWith("moderations")
      ? { results: [{ flagged: false }] } : { output_text: JSON.stringify(output) }), { status: 200 }));
    const result = await new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation, now: () => new Date("2026-09-10T08:00:00Z") }).compile(raw);
    expect(result.policyDecision.status).toBe("needs_clarification");
    expect(result.compiledBrief).toMatchObject({ appointmentAuthorization: null,
      blockingIssues: [{ code: "missing_scheduling_constraints", question: expect.stringContaining("Europe/Zurich") }] });
    expect(fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith("responses"))).toHaveLength(1);
  });

  it("repairs malformed calendar output once and keeps the same trusted clock", async () => {
    const { raw, compiled } = await plan("Arrange a meeting tomorrow between 09:00 and 12:00");
    const valid = modelResponse(compiled, raw.objective);
    let attempts = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("moderations")) return new Response(JSON.stringify({ results: [{ flagged: false }] }));
      const output = ++attempts === 1 ? { ...valid, schedulingInterpretation: { ...valid.schedulingInterpretation, schedule: { invalid: true } } } : valid;
      return new Response(JSON.stringify({ output_text: JSON.stringify(output) }));
    });
    const now = vi.fn(() => new Date("2026-09-10T08:00:00Z"));
    const result = await new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation, now }).compile(raw);
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(attempts).toBe(2);
    expect(now).toHaveBeenCalledTimes(1);
    const requestBodies = fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith("responses")).map(([, init]) => JSON.parse(String(init?.body)));
    expect(requestBodies[1].input[0].content).toContain("schedulingInterpretation.schedule");
    expect(requestBodies.every((body) => body.input[0].content.includes("2026-09-10T08:00:00.000Z"))).toBe(true);
  });

  it.each(["en-GB", "de-CH", "fr-CH", "it-CH", "ru-RU"] as const)("preserves spoken questions and checks confirmation separately in %s", async (locale) => {
    const { raw, compiled } = await plan("Arrange a meeting at home tomorrow");
    const result = enforceAppointmentPlan({ ...raw, locale }, { ...compiled, callLocale: locale });
    expect(result.orderedQuestions).toEqual(compiled.orderedQuestions);
    expect(result.successCriteria.at(-1)).toMatch(/confirms|bestätigt|confirme|conferma|подтвердил/);
  });

  it("keeps Ukrainian input-language clarification neutral without requiring a Ukrainian call locale", () => {
    expect(appointmentClarification(input("Arrange a meeting"), "uk")).toMatch(/^На яку дату й час/);
    expect(appointmentClarification(input("Arrange a meeting"), "uk")).not.toContain("послугу");
  });

  it("requires the intermediate even when the model returns a null authority", async () => {
    const { raw, compiled } = await plan("Ask whether the form arrived", null);
    const { schedulingInterpretation: _omitted, ...missing } = modelResponse(compiled, raw.objective);
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).endsWith("moderations")
      ? { results: [{ flagged: false }] } : { output_text: JSON.stringify(missing) })));
    await expect(new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(raw))
      .rejects.toMatchObject({ code: "OPENAI_RESPONSE_INVALID", validationPaths: ["schedulingInterpretation"] });
    expect(fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith("responses"))).toHaveLength(2);
  });
});
