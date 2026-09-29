import { afterEach, expect, it, vi } from "vitest";
import { OpenAIBriefCompiler } from "../brief-compiler/brief-compiler";
import { OpenAITextProcessor } from "./openai-text-processor";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { DurableJobWorker } from "../jobs/durable-job-worker";
import { buildRealtimeInstructions } from "../realtime/openai-realtime-bridge";
import { createApprovedExecutionPlan, type PlanReviewPayload } from "@callassist/contracts";
import { planReviewFields } from "./plan-review-fields";

const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of close.splice(0).reverse()) await fn(); });

it("automatically prepares an input-language review and executes only the unchanged German plan after translated approval", async () => {
  const sourceFact = "Номер заявления A-17";
  const generated = {
    sourceLanguage: "pl", sourceObjective: "Sprawdzić odbiór wniosku.",
    taskType: "receipt_confirmation", tone: "neutral", addressingStyle: "formal", resultHandling: "capture_in_callassist",
    voicemailAction: "hang_up", refusalBehavior: "respect_and_end",
    localizedObjective: "Den Eingang des Antrags klären.",
    opening: { recipientAddress: "Guten Tag, Testbüro.", purposeStatement: "Ich rufe im Auftrag von Nina Keller wegen eines Antrags an.", readinessQuestion: "Haben Sie kurz Zeit?" },
    backgroundSummary: "Die Unterlagen wurden bereits versandt.",
    orderedQuestions: [{ text: "Ist der Antrag eingegangen?", purpose: "Den Eingang prüfen.", required: true }],
    conditionalFollowUps: [{ condition: "Der Antrag fehlt.", question: "Wohin kann er erneut gesendet werden?" }],
    successCriteria: ["Der Eingangsstatus ist bekannt."], unresolvedCriteria: ["Der Status ist unbekannt."],
    stopConditions: ["Die Person möchte das Gespräch beenden."],
    approvedFacts: [{ sourceText: sourceFact, callLanguageText: "Aktenzeichen A-17" }],
    prohibitedActions: ["Keine Termine buchen."],
    namedEntities: [], riskCategories: [], assumptions: [], blockingIssues: [],
    appointmentAuthorization: null, schedulingInterpretation: { intent: "none", authorityEvidence: null, schedule: null }
  };
  const polish: Record<string, string> = {
    localizedObjective: "Sprawdzić odbiór wniosku.", backgroundSummary: "Dokumenty zostały już wysłane.",
    "opening.recipientAddress": "Dzień dobry, Testbüro.", "opening.purposeStatement": "Dzwonię w imieniu Nina Keller w sprawie wniosku.",
    "opening.readinessQuestion": "Czy ma Pan lub Pani chwilę?", "orderedQuestions.0.text": "Czy wniosek dotarł?",
    "orderedQuestions.0.purpose": "Sprawdzić odbiór.", "conditionalFollowUps.0.condition": "Brakuje wniosku.",
    "conditionalFollowUps.0.question": "Dokąd można wysłać go ponownie?", "successCriteria.0": "Status odbioru jest znany.",
    "unresolvedCriteria.0": "Status jest nieznany.", "stopConditions.0": "Rozmówca chce zakończyć rozmowę.",
    "approvedFacts.0.callLanguageText": "Numer sprawy A-17", "prohibitedActions.0": "Nie rezerwować terminów."
  };
  const compilerFetch = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json(String(url).endsWith("moderations") ? { results: [{ flagged: false }] }
      : { status: "completed", output_text: JSON.stringify(body.text.format.name === "execution_language_audit" ? { violations: [] } : generated) });
  });
  const translateFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).input[1].content);
    expect(input.targetLanguage).toBe("pl");
    expect(JSON.stringify(input)).not.toContain(sourceFact);
    return Response.json({ status: "completed", output_text: JSON.stringify({ fields: input.fields.map((f: { id: string }) => ({ id: f.id, text: polish[f.id] })) }),
      usage: { input_tokens: 100, output_tokens: 150, total_tokens: 250 } });
  });
  const repository = new InMemoryCallRepository();
  const completed = vi.spyOn(repository, "completeProviderOperation");
  const service = new CallService(repository, undefined, undefined, undefined,
    new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation: compilerFetch }), undefined, undefined,
    { durableWorkerEnabled: false, textProcessor: new OpenAITextProcessor({ apiKey: "test", fetchImplementation: translateFetch }) });
  close.push(() => service.close());
  const brief = await service.create({ recipientName: "Testbüro", phoneNumber: "+41710000001", assistantProfileId: "anna",
    representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "de-CH", allowLanguageSwitch: false,
    objective: "Sprawdź, czy wniosek dotarł. Nie rezerwuj wizyty.", context: "Документы уже отправлены.", allowedFacts: [sourceFact] });
  const before = (await service.get(brief.id))!;
  expect(before.compilation!.policyDecision.status).toBe("ready_for_review");
  expect(before.languageContext).toMatchObject({ taskContentLanguage: "pl", selectionSource: "detection" });
  await service.preparePlanReview(brief.id);
  await service.preparePlanReview(brief.id);
  expect(await repository.listTextArtifacts(brief.id)).toHaveLength(1);
  const worker = new DurableJobWorker(repository, { text_artifact_generation: (job, lease) => service.textArtifacts.process(job, lease) }, () => undefined);
  close.push(() => worker.close()); await worker.runOnce();
  const artifact = (await repository.listTextArtifacts(brief.id))[0]!;
  expect(artifact.status).toBe("ready");
  expect((artifact.payload as PlanReviewPayload).fields.map(f => f.id)).toEqual(planReviewFields(before.compilation!).map(f => f.id));
  expect(translateFetch).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 250 }) }));
  const compilation = before.compilation!;
  await service.approveCompilation(brief.id, { revision: compilation.revision, snapshotHash: compilation.snapshotHash,
    review: { mode: "translated", language: "pl", artifactId: artifact.id, artifactHash: artifact.payloadHash!, selectionRevision: before.languageContext!.selectionRevision } });
  const { attempt } = await repository.startAttempt(brief.id, { provider: "mock" });
  expect(attempt.executionSnapshot!.plan).toEqual(createApprovedExecutionPlan(compilation.compiledBrief!));
  expect(attempt.executionSnapshot!.plan.callLocale).toBe("de-CH");
  const instructions = buildRealtimeInstructions(attempt.executionSnapshot!, true, true);
  expect(instructions).toContain(generated.localizedObjective);
  expect(instructions).not.toContain(polish.localizedObjective);
  expect(instructions).not.toContain(sourceFact);
  expect(instructions).not.toContain(before.compilation!.rawBrief.objective);
  expect(instructions).not.toMatch(/[А-Яа-яЁё]/u);
});
