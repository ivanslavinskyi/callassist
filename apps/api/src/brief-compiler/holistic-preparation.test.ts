import { validateNativeAppointment } from "../appointments/native-appointment-authorization";
import { nativeProposal } from "../test-helpers/native-appointment";
import { describe,expect,it,vi } from "vitest";
import { createApprovedExecutionSnapshot, createPlanOnlyTaskContext, callCompilationSchema, planOnlyContextText,
  normalizeCreateCallBriefInput, resolveTaskLanguage, MATERIAL_PREPARATION_POLICY, RELIABLE_PREPARATION_POLICY, type PreparationDiagnosticInput } from "@callassist/contracts";
import { OpenAIBriefCompiler, type BriefCompilerRunOptions } from "./brief-compiler";
import { holisticCandidate, holisticInput, holisticPolicy } from "../test-helpers/holistic-candidate";
import { hasValidCompilationSnapshotHash } from "./compilation-integrity";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { nativeV2Session } from "../voice/live-task-context";
import { planReviewFields } from "../text-processing/plan-review-fields";
import { responseText,validationCode,PreparationValidationError } from "./preparation-validation";
import { assembleHolisticCandidate, holisticCandidateSchema } from "./holistic-contract";
import { nativeAuthority } from "../test-helpers/native-appointment";

function mockProvider(candidates:unknown[],audits:unknown[]=[{verdict:"accept",message:""}],policy:NonNullable<BriefCompilerRunOptions["policy"]>=holisticPolicy) {
  let generation=0,audit=0;
  const bodies:Array<Record<string,any>>=[];
  const fetchImplementation=vi.fn<typeof fetch>(async(url,init)=>{
    const body=JSON.parse(String(init?.body));bodies.push(body);
    if(String(url).endsWith("moderations"))return Response.json({results:[{flagged:false}]});
    const value=body.text.format.name==="callassist_holistic_review"?audits[Math.min(audit++,audits.length-1)]:candidates[Math.min(generation++,candidates.length-1)];
    if(value instanceof Response)return value.clone();
    return Response.json({status:"completed",output_text:typeof value==="string"?value:JSON.stringify(value)});
  });
  const run=(options:BriefCompilerRunOptions={})=>new OpenAIBriefCompiler({apiKey:"test",fetchImplementation}).compile(holisticInput,1,{policy,...options});
  return {run,bodies,fetchImplementation,count:()=>({generation,audit})};
}
describe.each([holisticPolicy,{...holisticPolicy,promptVersion:MATERIAL_PREPARATION_POLICY},{...holisticPolicy,promptVersion:RELIABLE_PREPARATION_POLICY}])("holistic preparation and unchanged voice runtime: $promptVersion",policy=>{
  const provider=(candidates:unknown[],audits?:unknown[])=>mockProvider(candidates,audits,policy);
  it("recovers a localized language name before it can silently select the account fallback",async()=>{
    const good={...await holisticCandidate(),sourceLanguage:"ru-RU"};
    const events:PreparationDiagnosticInput[]=[],p=provider([{...good,sourceLanguage:"Russisch"},good]);
    const compilation=await p.run({diagnostic:async e=>{events.push(e);}});
    expect(compilation.compiledBrief?.sourceLanguage).toBe("ru-RU");
    expect(resolveTaskLanguage({detectedLanguage:compilation.compiledBrief?.sourceLanguage,accountPreference:"en",preferences:{mode:"auto",uiLocaleHint:"de"},compilationRevision:1}))
      .toMatchObject({taskContentLanguage:"ru",selectionSource:"detection"});
    expect(p.count()).toEqual({generation:2,audit:1});
    const schema=p.bodies.find(b=>b.text?.format.name==="callassist_holistic_candidate")!.text.format.schema;
    expect(new RegExp(schema.properties.sourceLanguage.pattern).test("Russisch")).toBe(false);
    const audit=JSON.parse(p.bodies.find(b=>b.text?.format.name==="callassist_holistic_review")!.input);
    if(policy.promptVersion===RELIABLE_PREPARATION_POLICY)expect(audit).not.toHaveProperty("sourceLanguage");
    else expect(audit.sourceLanguage).toBe("ru-RU");
    expect(audit.execution.plan).not.toHaveProperty("sourceLanguage");
    expect(events.some(e=>e.metadata.code==="OUTPUT_SCHEMA_INVALID")).toBe(true);
  });
  it.each(["ru","RU-ru","pl","zh-Hant","sr-Latn","und","mul"])("preserves generic source-language tags independently of the call language: %s",async tag=>{
    const raw=normalizeCreateCallBriefInput({...holisticInput,locale:"de-CH"});
    const c=holisticCandidateSchema.parse({...await holisticCandidate(),sourceLanguage:tag});
    const compiled=assembleHolisticCandidate(c,raw,new Date("2026-11-11T12:00:00Z"));
    expect(compiled.sourceLanguage).toBe(Intl.getCanonicalLocales(tag)[0]);expect(compiled.callLocale).toBe("de-CH");
  });
  it("audits exactly the approved task context and admits it to the existing voice session",async()=>{
    const candidate=await holisticCandidate(),p=provider([candidate]),events:PreparationDiagnosticInput[]=[];
    const c=await p.run({diagnostic:async event=>{events.push(event);}});
    expect(c).toMatchObject({compilerVersion:"brief-compiler-17",compiledBrief:{schemaVersion:"11"},policyDecision:{status:"ready_for_review"}});
    expect(callCompilationSchema.parse(c)).toEqual(c);expect(hasValidCompilationSnapshotHash(c)).toBe(true);
    const repo=new InMemoryCallRepository(),brief=await repo.create(holisticInput,c);
    await repo.approveCompilation(brief.id,await originalPlanReview(repo,brief.id));
    const approval=createApprovedExecutionSnapshot((await repo.get(brief.id))!);
    expect(approval.version).toBe(10);if(approval.version!==10)throw new Error("Expected approval10");expect(()=>nativeV2Session(approval)).not.toThrow();
    const audited=JSON.parse(p.bodies.find(b=>b.text?.format.name==="callassist_holistic_review")!.input).execution;
    expect(audited).toEqual({plan:approval.plan,spokenIdentities:approval.runtime.spokenIdentities,nativeOpening:approval.nativeOpening,contextAppendix:approval.contextAppendix});
    expect(planOnlyContextText(audited)).toBe(planOnlyContextText(createPlanOnlyTaskContext(c.compiledBrief!,c.rawBrief,holisticInput.voiceGender)));
    expect(JSON.stringify(approval.plan)).not.toMatch(/sourceText|taskEvidence|namedEntities/);
    expect(p.count()).toEqual({generation:1,audit:1});expect(p.bodies).toHaveLength(4);
    expect(events.map(e=>e.metadata.code)).toContain("AUDIT_ACCEPT");
    expect(planReviewFields(c).filter(f=>f.id.startsWith("approvedFacts")).map(f=>f.id)).not.toContain("approvedFacts.0.callLanguageText");
  });
  it.each([null,[],{},'not JSON','{"incomplete":','"string"'])("recovers one malformed candidate: %j",async bad=>{
    const good=await holisticCandidate(),p=provider([bad,good]);
    expect((await p.run()).policyDecision.status).toBe("ready_for_review");
    expect(p.count()).toEqual({generation:2,audit:1});
    const repair=JSON.parse(p.bodies.filter(b=>b.text?.format.name==="callassist_holistic_candidate")[1]!.input);
    expect(repair.correction.currentFinding.code).toMatch(/^OUTPUT_/);expect(repair.correction).toHaveProperty("rejectedCandidate");
  });
  it("passes only the current full candidate and finding to semantic repair",async()=>{
    const good=await holisticCandidate(),bad={...good,localizedObjective:"Invented task"};
    const p=provider([bad,good],[{verdict:"revise",message:"Restore the request about office hours."},{verdict:"accept",message:""}]);
    expect((await p.run()).policyDecision.status).toBe("ready_for_review");
    const correction=JSON.parse(p.bodies.filter(b=>b.text?.format.name==="callassist_holistic_candidate")[1]!.input).correction;
    expect(correction).toEqual({rejectedCandidate:bad,currentFinding:"Restore the request about office hours."});
    expect(p.count()).toEqual({generation:2,audit:2});expect(p.bodies).toHaveLength(6);
  });
  it.each([{},null,[],{verdict:"accept"}, {verdict:"revise",message:" "},'{broken'])("retries an unusable audit on the unchanged candidate: %j",async bad=>{
    const p=provider([await holisticCandidate()],[bad,{verdict:"accept",message:""}]);
    expect((await p.run()).policyDecision.status).toBe("ready_for_review");expect(p.count()).toEqual({generation:1,audit:2});
    const audits=p.bodies.filter(b=>b.text?.format.name==="callassist_holistic_review").map(b=>JSON.parse(b.input));
    expect(audits[0].execution).toEqual(audits[1].execution);
  });
  it("shares recovery across candidate and audit errors and never adds a third audit",async()=>{
    const p=provider([{},await holisticCandidate()],[{}]);
    await expect(p.run()).rejects.toMatchObject({validationCode:"AUDIT_OUTPUT_INVALID"});expect(p.count()).toEqual({generation:2,audit:1});
    const second=provider([await holisticCandidate()],[{},{verdict:"revise",message:"A material correction is required"}]);
    expect((await second.run()).policyDecision.status).toBe("blocked");expect(second.count()).toEqual({generation:1,audit:2});
  });
  it("retains failed validation even though provider transport succeeded",async()=>{
    const events:PreparationDiagnosticInput[]=[],p=provider([{},{}]);
    await expect(p.run({diagnostic:async e=>{events.push(e);}})).rejects.toMatchObject({validationCode:"OUTPUT_SCHEMA_INVALID"});
    expect(events.some(e=>e.metadata.code==="RESPONSE_RECEIVED")).toBe(true);
    expect(events.some(e=>e.metadata.code==="OUTPUT_SCHEMA_INVALID"&&e.operationId)).toBe(true);
    expect(p.count()).toEqual({generation:2,audit:0});
  });
  it("retains answer evidence without opaque provider reasoning",async()=>{
    const candidate=await holisticCandidate(),events:PreparationDiagnosticInput[]=[];
    const p=provider([Response.json({status:"completed",output:[
      {type:"reasoning",encrypted_content:"opaque-provider-reasoning"},
      {type:"message",content:[{type:"output_text",text:JSON.stringify(candidate)}]}
    ]})]);
    expect((await p.run({diagnostic:async e=>{events.push(e);}})).policyDecision.status).toBe("ready_for_review");
    expect(JSON.stringify(events)).not.toContain("opaque-provider-reasoning");
    expect(events.some(e=>e.metadata.code==="CANDIDATE_VALID")).toBe(true);
    const unusable=provider([Response.json({status:"completed",output:[{type:"reasoning",encrypted_content:"opaque-provider-reasoning"}]})]);
    await expect(unusable.run({diagnostic:async e=>{events.push(e);}})).rejects.toMatchObject({validationCode:"OUTPUT_MISSING"});
    expect(JSON.stringify(events)).not.toContain("opaque-provider-reasoning");
  });
  it("does not replace a usable result with diagnostic storage failures",async()=>{
    const stderr=vi.spyOn(process.stderr,"write").mockReturnValue(true);
    try{expect((await provider([await holisticCandidate()]).run({diagnostic:async()=>{throw new Error("private storage detail");}})).policyDecision.status).toBe("ready_for_review");
      expect(stderr.mock.calls.flat().join("")).not.toContain("private storage detail");}finally{stderr.mockRestore();}
  });
  it("keeps a genuine clarification and a refusal distinct from malformed output",async()=>{
    const p=provider([await holisticCandidate()],[{verdict:"clarify",message:"Which of the two appointments do you mean?"}]);
    expect((await p.run()).policyDecision.status).toBe("needs_clarification");expect(p.count().generation).toBe(1);
    const refusal=provider([Response.json({status:"completed",output:[{content:[{type:"refusal",refusal:"Cannot comply"}]}]})]);
    expect((await refusal.run()).policyDecision.reasonCodes).toEqual(["model_refusal"]);expect(refusal.count().generation).toBe(1);
  });
  it("does not let audit acceptance silently override a blocking policy category",async()=>{
    const flagged={...await holisticCandidate(),riskCategories:["prompt_injection"]};
    const blocked=await provider([flagged]).run();
    expect(blocked.policyDecision).toMatchObject({status:"blocked",reasonCodes:["prohibited_content"]});
    const corrected=provider([flagged,await holisticCandidate()],[{verdict:"revise",message:"Remove the unsupported risk category; the task only asks for office hours."},{verdict:"accept",message:""}]);
    expect((await corrected.run()).policyDecision.status).toBe("ready_for_review");
    expect(corrected.count()).toEqual({generation:2,audit:2});
  });
  it("keeps global request budgets and cancellation active",async()=>{
    const p=provider([await holisticCandidate()]);
    await expect(p.run({maxProviderRequests:2})).rejects.toMatchObject({validationCode:"REQUEST_BUDGET_EXHAUSTED"});
    const controller=new AbortController();controller.abort();const cancelled=provider([await holisticCandidate()]);
    await expect(cancelled.run({signal:controller.signal})).rejects.toThrow();expect(cancelled.bodies).toHaveLength(0);
  });
  it("normalizes relative calendars and IDs without weakening runtime authority",async()=>{
    const c=await holisticCandidate();const {version,providerScope,maxAppointments,financialPolicy,...a}=nativeAuthority;
    c.taskType="appointment_coordination";
    c.appointmentProposal={...a,timeZone:null,requirements:[{description:"Only with the preferred doctor"}],alternatives:[{selection:"first_matching",requirements:[],rules:[{
      dates:{kind:"next_calendar_week"},weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:"09:00",endTime:"12:00"}]}]};
    const compiled=assembleHolisticCandidate(c,holisticInput,new Date("2026-11-11T12:00:00Z"));
    expect(compiled.nativeAppointmentAuthorization).toMatchObject({providerScope:"called_recipient",financialPolicy:"no_unapproved_terms",maxAppointments:1,
      requirements:[{id:"requirement_1"}],alternatives:[{id:"alternative_1",rules:[{startDate:"2026-11-16",endDate:"2026-11-22"}]}]});
    expect(JSON.stringify(compiled)).not.toContain("sourceText");
    const proposal={...nativeProposal,alternativeId:"alternative_1",date:"2026-11-16",startTime:"09:30",requirements:[{id:"requirement_1",recipientQuote:"The preferred doctor is available."}]};
    const authority=compiled.nativeAppointmentAuthorization!;
    expect(validateNativeAppointment(authority,proposal,"The preferred doctor is available.",new Date("2026-11-11T12:00:00Z")).ok).toBe(true);
    expect(validateNativeAppointment(authority,proposal,"No observed requirement evidence.",new Date("2026-11-11T12:00:00Z")).ok).toBe(false);
    expect(validateNativeAppointment(authority,{...proposal,startTime:"17:00"},"The preferred doctor is available.",new Date("2026-11-11T12:00:00Z")).ok).toBe(false);
    expect(validateNativeAppointment(authority,{...proposal,operation:"cancel"},"The preferred doctor is available.",new Date("2026-11-11T12:00:00Z")).ok).toBe(false);
  });
});
describe("typed model output diagnostics",()=>{
  it.each([{},null,{output_text:42},{output:[{content:[{type:"output_text",text:{private:"value"}}]}]},{status:"incomplete",output_text:"{}"}])("rejects unusable envelope %j",value=>expect(()=>responseText(value,"compilation")).toThrow(PreparationValidationError));
  it("does not publish arbitrary exception text or recurse through cyclic causes",()=>{
    const e:any={message:"Private user message"};e.cause={cause:e};expect(validationCode(e)).toBe("PREPARATION_FAILED");
    expect(validationCode(new Error("OPENAI_STREAM_PADDING"))).toBe("STREAM_PADDING");
  });
});
