import { describe, expect, it, vi } from "vitest";
import { callCompilationSchema, defaultPreparationRuntimePolicy, nativeActionCompiledCallBriefSchema,
  normalizeCreateCallBriefInput, type RawCallBrief } from "@callassist/contracts";
import { DeterministicBriefCompiler, OpenAIBriefCompiler, type PreparationRequestMetadata } from "./brief-compiler";
import { hasValidCompilationSnapshotHash } from "./compilation-integrity";
import { verifyExecutionFidelity, type ExecutionFidelityVerdict } from "./execution-fidelity";
import { NATIVE_INTEGRITY_POLICY, NATIVE_ROLES_POLICY, isIntegrityPolicy, isNativeActionsPolicy, isProgressivePolicy } from "./native-appointment-compilation";
import { nativeAuthority } from "../test-helpers/native-appointment";
import { preparationRequestReserve } from "../config/preparation-pricing";

// Anonymized captured failure: a recipient and the represented person share a first name.
const raw = normalizeCreateCallBriefInput({ recipientName: "Nina", phoneNumber: "+41710000001",
  representedPersonFirstName: "Nina", representedPersonLastName: "Keller", assistantProfileId: "anna",
  objective: "узнай у нины что она хочет на обед. если скажет пиццу - уточни какую именно",
  locale: "de-CH", addressingMode: "formal", tonePreference: "neutral", allowedFacts: [] });
const plan = nativeActionCompiledCallBriefSchema.parse({
  schemaVersion: "9", callLocale: "de-CH", sourceLanguage: "ru", taskType: "information_request",
  tone: "neutral", addressingStyle: "formal", resultHandling: "capture_in_callassist", voicemailAction: "hang_up",
  refusalBehavior: "respect_and_end", localizedObjective: "Nina fragen, was sie zum Mittagessen möchte. Bei Pizza die Sorte klären.",
  opening: { recipientAddress: "Nina", purposeStatement: "Ich möchte Sie nach Ihrem Mittagessen fragen.", readinessQuestion: "Passt es Ihnen gerade?" },
  backgroundSummary: "", orderedQuestions: [{ text: "Was möchten Sie zum Mittagessen?", purpose: "Ninas Essenswunsch erfahren.", required: true }],
  conditionalFollowUps: [{ condition: "Nina möchte Pizza.", question: "Welche Pizza möchten Sie?" }],
  successCriteria: ["Ninas Essenswunsch und bei Pizza die Sorte sind geklärt."],
  unresolvedCriteria: ["Der Essenswunsch oder die gewünschte Pizzasorte bleibt unklar."], stopConditions: ["Nina lehnt das Gespräch ab."],
  approvedFacts: [], prohibitedActions: ["Keine Bestellung aufgeben."],
  namedEntities: [{ type: "person", value: "Nina" }, { type: "person", value: "Nina Keller" }],
  riskCategories: [], assumptions: ["respect_refusal_and_end", "spoken_answers_saved_in_callassist", "no_detailed_voicemail"],
  blockingIssues: [], appointmentAuthorization: null, contextAppendix: [], nativeAppointmentAuthorization: null
});
const wrongPlan = { ...plan, localizedObjective: "Nina fragen, was Nina Keller zum Mittagessen möchte.",
  orderedQuestions: [{ ...plan.orderedQuestions[0]!, purpose: "Den Essenswunsch von Nina Keller erfahren." }],
  successCriteria: ["Es ist geklärt, was Nina Keller zum Mittagessen möchte."] };
const policy = { ...defaultPreparationRuntimePolicy, promptVersion: NATIVE_ROLES_POLICY } as const;
const clean: ExecutionFidelityVerdict = { languageViolations: [], semanticViolations: [] };
const roleFailure: ExecutionFidelityVerdict = { languageViolations: [], semanticViolations: [
  { path: "localizedObjective", reason: "subject_changed" }, { path: "orderedQuestions.0.purpose", reason: "subject_changed" },
  { path: "successCriteria.0", reason: "subject_changed" }
] };
const generalOutput = (compiled = plan) => ({ ...compiled,
  nativeAppointmentInterpretation: { intent: "none", authorityEvidence: null, authorization: null } });

function provider(verdicts: unknown[], plans: object[] = [generalOutput(wrongPlan), generalOutput()]) {
  let generations = 0, audits = 0;
  const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("moderations")) return Response.json({ results: [{ flagged: false }] });
    if (body.text.format.name === "execution_fidelity_audit") {
      const verdict = verdicts[Math.min(audits++, verdicts.length - 1)];
      return Response.json({ output_text: JSON.stringify(verdict), usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    }
    const output = plans[Math.min(generations++, plans.length - 1)];
    return Response.json({ id: `plan-${generations}`, output_text: JSON.stringify(output) });
  });
  return { fetchImplementation, count: () => ({ generations, audits }) };
}

describe("combined execution language and source fidelity audit", () => {
  it("supplies unprojected plan, labelled parties and complete original sources in one request", async () => {
    const input: RawCallBrief = { ...raw, recipientName: "Нина", context: "Предпочтение касается получателя, не заказчика.",
      allowedFacts: ["Вера не ест мясо."], clarificationAnswers: [{ issueCode: "ambiguous_recipient_or_subject", answer: "Получателя." }],
      deliveryInstruction: "Только сообщить результат." };
    const compiled = { ...wrongPlan, opening: { ...wrongPlan.opening, recipientAddress: "Нина" } };
    const request = vi.fn(async (_body: object) => ({ output_text: JSON.stringify(roleFailure) }));
    expect(await verifyExecutionFidelity(compiled, input, request, "audit-model")).toEqual(roleFailure);
    expect(request).toHaveBeenCalledTimes(1);
    const body = request.mock.calls[0]![0] as { input: string; model: string; instructions: string; text: { format: { name: string } } };
    const data = JSON.parse(body.input);
    expect(body.model).toBe("audit-model");
    expect(body.text.format.name).toBe("execution_fidelity_audit");
    expect(data.parties).toEqual({ recipient: { name: "Нина", role: "called_recipient" }, representedPerson: { name: "Nina Keller", role: "represented_principal" } });
    expect(data.sourceMaterial).toEqual({ objective: input.objective, context: input.context, allowedFacts: input.allowedFacts,
      clarificationAnswers: input.clarificationAnswers, deliveryInstruction: input.deliveryInstruction });
    expect(data.compiledTask).toEqual(compiled);
    expect(data.languageFields["opening.recipientAddress"]).toBe("Нина");
    expect(body.instructions).toContain("third parties");
    expect(body.instructions).toContain("Source and call languages may differ");
    expect(body.instructions).toContain("Identity metadata need not be repeated");
    expect(body.instructions).toContain("question wording AND purposes");
  });

  it.each([
    {}, { violations: [] }, { ...clean, extra: "ignored" }, { ...clean, languageViolations: ["sourceMaterial.objective"] },
    { ...clean, semanticViolations: [{ path: "missingField", reason: "subject_changed" }] },
    { ...clean, semanticViolations: [{ path: "localizedObjective", reason: "unknown" }] },
    { ...clean, semanticViolations: [{ path: "localizedObjective", reason: "subject_changed", advice: "untrusted instructions" }] },
    { ...clean, languageViolations: "none" }, { ...clean, semanticViolations: null },
    { ...clean, semanticViolations: Array.from({ length: 101 }, () => ({ path: "localizedObjective", reason: "subject_changed" })) }
  ])("rejects malformed, extra or nonexistent audit findings: %j", async verdict => {
    await expect(verifyExecutionFidelity(plan, raw, async () => ({ output_text: JSON.stringify(verdict) }), "audit-model")).rejects.toThrow();
  });

  it.each(["incomplete", "failed", null])("fails closed for a non-completed response: %s", async status => {
    await expect(verifyExecutionFidelity(plan, raw, async () => ({ status, output_text: JSON.stringify(clean) }), "audit-model")).rejects.toThrow();
  });

  it("keeps a named third-party subject distinct from both parties without a name heuristic", async () => {
    const input = { ...raw, objective: "Спроси Нину, что Вера хочет на обед." };
    const thirdParty = { ...plan, localizedObjective: "Nina fragen, was Vera zum Mittagessen möchte.",
      orderedQuestions: [{ text: "Was möchte Vera zum Mittagessen?", purpose: "Veras Wunsch klären.", required: true }],
      conditionalFollowUps: [], successCriteria: ["Veras Essenswunsch ist geklärt."], namedEntities: [...plan.namedEntities, { type: "person" as const, value: "Vera" }] };
    const request = vi.fn(async (_body: object) => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify(clean) }] }] }));
    expect(await verifyExecutionFidelity(thirdParty, input, request, "audit-model")).toEqual(clean);
    expect(JSON.parse((request.mock.calls[0]![0] as { input: string }).input).compiledTask).toEqual(thirdParty);
  });

  it("preserves an explicit subject correction and tells the auditor to resolve it before comparing", async () => {
    const input: RawCallBrief = { ...raw, objective: "Узнай у Нины, что я хочу на обед.",
      clarificationAnswers: [{ issueCode: "ambiguous_recipient_or_subject", answer: "Исправление: спроси Нину, что ОНА хочет, не я." }] };
    const request = vi.fn(async (_body: object) => ({ output_text: JSON.stringify(clean) }));
    expect(await verifyExecutionFidelity(plan, input, request, "audit-model")).toEqual(clean);
    const body = request.mock.calls[0]![0] as { input: string; instructions: string };
    expect(JSON.parse(body.input).sourceMaterial.clarificationAnswers).toEqual(input.clarificationAnswers);
    expect(body.instructions).toContain("a later explicit correction supersedes the targeted earlier statement, including its subject");
    expect(body.instructions).toContain("Preserve all unaffected source facts and restrictions");
  });

  it("keeps a valid large calendar within the existing request reservation limit", async () => {
    const base = nativeAuthority.alternatives[0]!;
    const authority = { ...nativeAuthority, alternatives: Array.from({ length: 8 }, (_, a) => ({ ...base, id: `option_${a}`,
      rules: Array.from({ length: 30 }, (_, r) => { const date = `2099-09-${String(r + 1).padStart(2, "0")}`;
        return { ...base.rules[0]!, weekdays: [1, 2, 3, 4, 5], startDate: date, endDate: date }; }) })) };
    const compiled = nativeActionCompiledCallBriefSchema.parse({ ...plan, taskType: "appointment_coordination", nativeAppointmentAuthorization: authority });
    const request = vi.fn(async (body: object) => {
      const bytes = Buffer.byteLength(JSON.stringify(body));
      expect(bytes).toBeLessThan(100_000);
      expect(() => preparationRequestReserve({ model: "gpt-5.6", serviceTier: "default" }, bytes, 2048)).not.toThrow();
      return { output_text: JSON.stringify(clean) };
    });
    expect(await verifyExecutionFidelity(compiled, raw, request, "gpt-5.6")).toEqual(clean);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("audits third-party appointment authority against its actual principal-only semantics", async () => {
    const input = { ...raw, objective: "Запиши Веру на консультацию на следующей неделе." };
    const compiled = nativeActionCompiledCallBriefSchema.parse({ ...plan, taskType: "appointment_coordination",
      localizedObjective: "Eine Beratung für Vera nächste Woche vereinbaren.", nativeAppointmentAuthorization: nativeAuthority });
    const findings: ExecutionFidelityVerdict = { ...clean, semanticViolations: [{ path: "nativeAppointmentAuthorization", reason: "authority_changed" }] };
    const request = vi.fn(async (_body: object) => ({ output_text: JSON.stringify(findings) }));
    expect(await verifyExecutionFidelity(compiled, input, request, "audit-model")).toEqual(findings);
    const body = request.mock.calls[0]![0] as { instructions: string };
    expect(body.instructions).toContain("Any non-null nativeAppointmentAuthorization authorizes an operation for representedPerson only");
    expect(body.instructions).toContain("even if the surrounding prose faithfully names that third party");
  });
});

describe("roles preparation policy and bounded repair", () => {
  it("inherits native actions and integrity, emits compiler14 and keeps the successful path at four requests", async () => {
    expect([isNativeActionsPolicy(NATIVE_ROLES_POLICY), isProgressivePolicy(NATIVE_ROLES_POLICY), isIntegrityPolicy(NATIVE_ROLES_POLICY)]).toEqual([true, true, true]);
    const mock = provider([clean], [generalOutput()]);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy });
    expect(result).toMatchObject({ compilerVersion: "brief-compiler-14", compiledBrief: { schemaVersion: "9" }, policyDecision: { status: "ready_for_review" } });
    expect(callCompilationSchema.parse(result)).toEqual(result);
    expect(hasValidCompilationSnapshotHash(result)).toBe(true);
    expect(mock.count()).toEqual({ generations: 1, audits: 1 });
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(4);
    const request = JSON.parse(String(mock.fetchImplementation.mock.calls[1]![1]!.body));
    expect(request.input[0].content).toContain("Keep participant roles separate");
    expect(request.input[0].content).toContain("Resolve prerequisites before dependent actions");
    const deterministic = await new DeterministicBriefCompiler().compile(raw, 1, { policy });
    expect(deterministic).toMatchObject({ compilerVersion: "brief-compiler-14", compiledBrief: { schemaVersion: "9" } });
  });

  it("repairs the captured subject corruption before permitting approval and accounts for both audit requests", async () => {
    const mock = provider([roleFailure, clean]);
    const afterProviderRequest = vi.fn(async (_result: unknown) => undefined);
    const metadata: PreparationRequestMetadata[] = [];
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy, afterProviderRequest,
      beforeProviderRequest: async request => { metadata.push(request.requestMetadata!); return true; } });
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(result.compiledBrief?.localizedObjective).toBe(plan.localizedObjective);
    expect(mock.count()).toEqual({ generations: 2, audits: 2 });
    expect(afterProviderRequest).toHaveBeenCalledTimes(6);
    expect(metadata[3]).toMatchObject({ repairKind: "integrity", repairNumber: 1 });
    const repair = JSON.parse(String(mock.fetchImplementation.mock.calls[3]![1]!.body));
    expect(repair.input[0].content).toContain("Semantic fidelity failure at orderedQuestions.0.purpose (subject_changed)");
    expect(repair.input[0].content).toContain("Semantic fidelity failure at successCriteria.0");
  });

  it("repairs language and role findings together instead of adding a separate audit stage", async () => {
    const mock = provider([{ ...roleFailure, languageViolations: ["orderedQuestions.0.text"] }, clean]);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy });
    expect(result.policyDecision.status).toBe("ready_for_review");
    const repair = JSON.parse(String(mock.fetchImplementation.mock.calls[3]![1]!.body));
    expect(repair.input[0].content).toContain("Language mismatch at orderedQuestions.0.text");
    expect(repair.input[0].content).toContain("Semantic fidelity failure at localizedObjective");
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(6);
  });

  it("blocks persistent semantic corruption within the existing three-audit-repair limit", async () => {
    const mock = provider([roleFailure], [generalOutput(wrongPlan)]);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy });
    expect(result.policyDecision).toMatchObject({ status: "blocked", reasonCodes: ["fact_integrity_failure"],
      issue: { kind: "plan_validation_failed", source: "compiler" } });
    expect(mock.count()).toEqual({ generations: 4, audits: 4 });
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(10);
  });

  it("shares the same repair allowance between language and semantic failures", async () => {
    const mock = provider([{ ...clean, languageViolations: ["orderedQuestions.0.text"] }, roleFailure,
      { ...clean, languageViolations: ["localizedObjective"] }, roleFailure]);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy });
    expect(result.policyDecision.status).toBe("blocked");
    expect(mock.count()).toEqual({ generations: 4, audits: 4 });
  });

  it("fails closed on a malformed combined verdict rather than approving or spending a repair loop", async () => {
    const mock = provider([{ violations: [] }]);
    await expect(new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy })).rejects.toMatchObject({
      code: "OPENAI_RESPONSE_INVALID", stage: "language_audit", validationPaths: ["execution_fidelity_audit"]
    });
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("does not bypass a lower shared request budget for semantic remediation", async () => {
    const mock = provider([roleFailure]);
    await expect(new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy, maxProviderRequests: 5 }))
      .rejects.toMatchObject({ code: "OPENAI_REQUEST_BUDGET_EXHAUSTED" });
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it("allows a faithful appointment for the represented person without applying the recipient preference rule", async () => {
    const input = { ...raw, recipientName: "Praxis", objective: "Запиши меня на консультацию на следующей неделе с девяти до пяти." };
    const appointment = { ...plan, taskType: "appointment_coordination" as const,
      localizedObjective: "Eine Beratung für Nina Keller nächste Woche zwischen neun und siebzehn Uhr vereinbaren.",
      opening: { ...plan.opening, recipientAddress: "Praxis", purposeStatement: "Ich rufe wegen einer Beratung für Nina Keller an." },
      orderedQuestions: [{ text: "Wann ist eine Beratung für Nina Keller möglich?", purpose: "Einen passenden Termin finden.", required: true }],
      conditionalFollowUps: [], successCriteria: ["Der Termin für Nina Keller ist bestätigt."],
      namedEntities: [{ type: "organisation" as const, value: "Praxis" }, { type: "person" as const, value: "Nina Keller" }],
      nativeAppointmentInterpretation: { intent: "book", authorityEvidence: { source: "objective", clarificationAnswerIndex: null, quote: input.objective },
        authorization: { ...nativeAuthority, requirements: [], serviceDescription: "Beratung", alternatives: [{ ...nativeAuthority.alternatives[0], requirements: [],
          rules: [{ dates: { kind: "next_calendar_week" }, weekdays: [], excludedWeekdays: [], excludedDates: [], startTime: "09:00", endTime: "17:00" }] }] } } };
    const mock = provider([clean], [appointment]);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock, now: () => new Date("2099-09-01T10:00:00Z") }).compile(input, 1, { policy });
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(result.compiledBrief).toMatchObject({ schemaVersion: "9", nativeAppointmentAuthorization: { operation: "book" } });
    const audit = JSON.parse(String(mock.fetchImplementation.mock.calls[2]![1]!.body));
    expect(JSON.parse(audit.input).compiledTask.nativeAppointmentAuthorization.operation).toBe("book");
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(4);
  });

  it("retains the historical language-only audit and compiler13 for the pinned integrity policy", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("moderations")) return Response.json({ results: [{ flagged: false }] });
      return Response.json({ output_text: JSON.stringify(body.text.format.name === "execution_language_audit" ? { violations: [] } : generalOutput()) });
    });
    const result = await new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(raw, 1, {
      policy: { ...policy, promptVersion: NATIVE_INTEGRITY_POLICY }
    });
    expect(result).toMatchObject({ compilerVersion: "brief-compiler-13", policyDecision: { status: "ready_for_review" } });
    const bodies = fetchImplementation.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.some(body => body.text?.format?.name === "execution_fidelity_audit")).toBe(false);
    expect(bodies.find(body => body.text?.format?.name === "execution_language_audit").instructions).toContain("Audit language only");
    expect(bodies[1].input[0].content).not.toContain("Keep participant roles separate");
  });
});
