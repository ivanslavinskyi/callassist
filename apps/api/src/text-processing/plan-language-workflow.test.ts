import { afterEach, expect, it, vi } from "vitest";
import { OpenAIBriefCompiler } from "../brief-compiler/brief-compiler";
import { OpenAITextProcessor } from "./openai-text-processor";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { DurableJobWorker } from "../jobs/durable-job-worker";
import { buildRealtimeInstructions } from "../realtime/openai-realtime-bridge";
import { ANSWERING_POLICY_VERSION, createApprovedExecutionPlan, createPlanOnlyExecutionPlan, type PlanReviewPayload } from "@callassist/contracts";
import { planReviewFields } from "./plan-review-fields";
import { holisticCandidateSchema } from "../brief-compiler/holistic-contract";
import { holisticPolicy } from "../test-helpers/holistic-candidate";
import { nativeV2Session } from "../voice/live-task-context";
import { OpenAILiveBridge } from "../voice/openai-live-bridge";
import { flush, TestSocket } from "../voice/voice-test-helpers";
import type { TelephonyProvider } from "../telephony/telephony-provider";

const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of close.splice(0).reverse()) await fn(); });

it.each([{holistic:false,language:"pl"},{holistic:true,language:"pl"},{holistic:true,language:"ru"}])("prepares a $language display translation and executes only the canonical German plan after translated approval (holistic=$holistic)", async ({holistic,language}) => {
  const sourceFact = "Номер заявления A-17";
  const generated = {
    sourceLanguage: language, sourceObjective: "Sprawdzić odbiór wniosku.",
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
  const translated: Record<string, string> = language==="ru" ? {
    localizedObjective:"Проверить получение заявления.",backgroundSummary:"Документы уже отправлены.",
    "opening.recipientAddress":"Добрый день, Testbüro.","opening.purposeStatement":"Я звоню от имени Nina Keller по поводу заявления.",
    "opening.readinessQuestion":"У вас есть минутка?","orderedQuestions.0.text":"Заявление получено?",
    "orderedQuestions.0.purpose":"Проверить получение.","conditionalFollowUps.0.condition":"Заявление отсутствует.",
    "conditionalFollowUps.0.question":"Куда можно отправить его повторно?","successCriteria.0":"Статус получения известен.",
    "unresolvedCriteria.0":"Статус неизвестен.","stopConditions.0":"Собеседник хочет завершить разговор.",
    "approvedFacts.0.callLanguageText":"Номер заявления A-17","prohibitedActions.0":"Не записывать на приём."
  } : {
    localizedObjective: "Sprawdzić odbiór wniosku.", backgroundSummary: "Dokumenty zostały już wysłane.",
    "opening.recipientAddress": "Dzień dobry, Testbüro.", "opening.purposeStatement": "Dzwonię w imieniu Nina Keller w sprawie wniosku.",
    "opening.readinessQuestion": "Czy ma Pan lub Pani chwilę?", "orderedQuestions.0.text": "Czy wniosek dotarł?",
    "orderedQuestions.0.purpose": "Sprawdzić odbiór.", "conditionalFollowUps.0.condition": "Brakuje wniosku.",
    "conditionalFollowUps.0.question": "Dokąd można wysłać go ponownie?", "successCriteria.0": "Status odbioru jest znany.",
    "unresolvedCriteria.0": "Status jest nieznany.", "stopConditions.0": "Rozmówca chce zakończyć rozmowę.",
    "approvedFacts.0.callLanguageText": "Numer sprawy A-17", "prohibitedActions.0": "Nie rezerwować terminów."
  };
  const candidate=holistic?holisticCandidateSchema.parse(Object.fromEntries(Object.entries({...generated,
    approvedFacts:["Aktenzeichen A-17"],contextAppendix:[{id:"posting",title:"Versand",description:"Angaben zum Versand",content:"Die Unterlagen wurden bereits versandt."}],
    inferredTone:null,inferredAddressing:null,appointmentProposal:null
  }).filter(([key])=>key in holisticCandidateSchema.shape))):generated;
  if(holistic)Object.assign(translated,{"approvedFacts.0":translated["approvedFacts.0.callLanguageText"],
    "contextAppendix.0.title":language==="ru"?"Отправка":"Wysyłka","contextAppendix.0.description":language==="ru"?"Сведения об отправке":"Informacje o wysyłce",
    "contextAppendix.0.content":translated.backgroundSummary});
  const auditedContexts:unknown[]=[];
  const compilerFetch = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if(body.text?.format.name==="callassist_holistic_review")auditedContexts.push(JSON.parse(body.input).execution);
    return Response.json(String(url).endsWith("moderations") ? { results: [{ flagged: false }] }
      : { status: "completed", output_text: JSON.stringify(body.text.format.name === "execution_language_audit" ? { violations: [] }
        :body.text.format.name==="callassist_holistic_review"?{verdict:"accept",message:""}:candidate) });
  });
  const translateFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).input[1].content);
    expect(input.targetLanguage).toBe(language);
    expect(JSON.stringify(input)).not.toContain(sourceFact);
    return Response.json({ status: "completed", output_text: JSON.stringify({ fields: input.fields.map((f: { id: string }) => ({ id: f.id, text: translated[f.id] })) }),
      usage: { input_tokens: 100, output_tokens: 150, total_tokens: 250 } });
  });
  const repository = new InMemoryCallRepository();
  const completed = vi.spyOn(repository, "completeProviderOperation");
  const compiler=new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation: compilerFetch });
  if(holistic){const compile=compiler.compile.bind(compiler);vi.spyOn(compiler,"compile").mockImplementation((input,revision,options)=>compile(input,revision,{...options,policy:holisticPolicy}));}
  const provider:TelephonyProvider|undefined=holistic?{mode:"twilio",startCall:vi.fn(async()=>({providerCallId:"CA-canonical",providerStatus:"queued"})),
    stopCall:vi.fn(async()=>{}),startRecording:vi.fn(),getRecordingMedia:vi.fn(),deleteRecording:vi.fn(),purgeCallRecordings:vi.fn(async()=>{})}:undefined;
  const service = new CallService(repository, provider, undefined, undefined,
    compiler, undefined, undefined,
    { durableWorkerEnabled: false, textProcessor: new OpenAITextProcessor({ apiKey: "test", fetchImplementation: translateFetch }) });
  close.push(() => service.close());
  const brief = await service.create({ recipientName: "Testbüro", phoneNumber: "+41710000001", assistantProfileId: "anna",
    representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "de-CH", allowLanguageSwitch: false,
    objective: language==="ru"?"Проверь, получено ли заявление. Не записывай на приём.":"Sprawdź, czy wniosek dotarł. Nie rezerwuj wizyty.", context: "Документы уже отправлены.", allowedFacts: [sourceFact] });
  const before = (await service.get(brief.id))!;
  expect(before.compilation!.policyDecision.status).toBe("ready_for_review");
  expect(before.languageContext).toMatchObject({ taskContentLanguage: language, selectionSource: "detection" });
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
  await service.approveCompilation(brief.id, { answeringPolicyVersion:ANSWERING_POLICY_VERSION,revision: compilation.revision, snapshotHash: compilation.snapshotHash,
    review: { mode: "translated", language, artifactId: artifact.id, artifactHash: artifact.payloadHash!, selectionRevision: before.languageContext!.selectionRevision } });
  const after=(await repository.get(brief.id))!;
  expect(after.compilation!.compiledBrief).toEqual(compilation.compiledBrief);
  expect(after.compilation!.snapshotHash).toBe(compilation.snapshotHash);
  if(holistic){
    const live=new TestSocket(),runtime=new OpenAILiveBridge({service,apiKey:"fixture",nativeV2:true,agentHangupEnabled:true,validateStreamToken:()=>true,createLiveSocket:()=>live.ws});
    close.push(async()=>{runtime.close();live.receive({type:"session.closed",reason:"close_requested",usage:{seconds:0}});await flush();});
    const starting=service.start(brief.id);await flush();await flush();live.emit("open");live.startLive("canonical-language");await starting;
    const attempt=(await repository.getLatestAttempt(brief.id))!,approved=attempt.executionSnapshot!;
    expect(approved.version).toBe(10);expect(approved.plan).toEqual(createPlanOnlyExecutionPlan(compilation.compiledBrief!));
    if(approved.version!==10)throw Error("Expected canonical native snapshot");
    expect(approved.contextAppendix).toEqual((candidate as {contextAppendix:unknown}).contextAppendix);
    const expected=nativeV2Session(approved),sent=live.sent.find(e=>e.type==="session.start")!.session;
    expect(sent.input).toEqual(expected.input);expect(sent.delegation.responses.instructions).toBe(expected.backendInstructions);
    expect(auditedContexts).toHaveLength(1);
    expect(auditedContexts[0]).toMatchObject({plan:approved.plan});
    const runtimeText=JSON.stringify(sent);
    expect(runtimeText).toContain(generated.localizedObjective);
    for(const value of [sourceFact,compilation.rawBrief.objective,translated.localizedObjective])expect(runtimeText).not.toContain(value);
    expect(runtimeText).not.toMatch(/\p{Script=Cyrillic}/u);
    return;
  }
  const { attempt } = await repository.startAttempt(brief.id, { provider: "mock" });
  expect(attempt.executionSnapshot!.plan).toEqual(createApprovedExecutionPlan(compilation.compiledBrief!));
  expect(attempt.executionSnapshot!.plan.callLocale).toBe("de-CH");
  const instructions = buildRealtimeInstructions(attempt.executionSnapshot!, true, true);
  expect(instructions).toContain(generated.localizedObjective);
  expect(instructions).not.toContain(translated.localizedObjective);
  expect(instructions).not.toContain(sourceFact);
  expect(instructions).not.toContain(before.compilation!.rawBrief.objective);
  expect(instructions).not.toMatch(/[А-Яа-яЁё]/u);
});
