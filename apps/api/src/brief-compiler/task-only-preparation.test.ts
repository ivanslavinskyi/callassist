import { describe, expect, it, vi } from "vitest";
import { callCompilationSchema, compiledCallBriefSchema, createApprovedExecutionPlan, createApprovedExecutionSnapshot,
  defaultPreparationRuntimePolicy, normalizeCreateCallBriefInput, taskOnlyCompiledCallBriefSchema } from "@callassist/contracts";
import { DeterministicBriefCompiler, OpenAIBriefCompiler, type BriefCompilerRunOptions, type BriefCompilerProviderRequestResult } from "./brief-compiler";
import { NATIVE_TASK_POLICY, PLAN_ONLY_POLICY } from "./native-appointment-compilation";
import { taskEvidenceIssues } from "./task-evidence";
import { hasValidCompilationSnapshotHash } from "./compilation-integrity";
import { planReviewFields } from "../text-processing/plan-review-fields";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { nativeV2Session } from "../voice/live-task-context";
import { buildCompilerInstructions } from "./compiler-instructions";

const policy = {...defaultPreparationRuntimePolicy,promptVersion:NATIVE_TASK_POLICY} as const;
const raw = normalizeCreateCallBriefInput({recipientName:"Nina",representedPersonFirstName:"Nina",representedPersonLastName:"Keller",
  phoneNumber:"+41710000001",assistantProfileId:"anna",locale:"en-GB",
  objective:"Ask Nina what she wants for dinner. If pizza, ask which kind.",allowedFacts:[]});
async function fixture(input=raw) {
  const c=await new DeterministicBriefCompiler().compile(input,1,{policy});
  const plan=taskOnlyCompiledCallBriefSchema.parse(c.compiledBrief);
  plan.namedEntities=[{type:"person",value:input.recipientName},{type:"person",value:input.representedPerson}];
  plan.conditionalFollowUps=[{condition:"If Nina wants pizza.",question:"Which kind?"}];
  plan.taskEvidence.push({path:"conditionalFollowUps.0.condition",sources:[{path:"objective",quote:input.objective}]});
  return plan;
}
function provider(plans: object[], verdicts: object[]=[{languageViolations:[],semanticViolations:[]}]) {
  let generations=0,audits=0;
  const fetchImplementation=vi.fn<typeof fetch>(async(url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(String(url).endsWith("moderations"))return Response.json({results:[{flagged:false}]});
    const accounting={model:body.model,service_tier:"default",usage:{input_tokens:100,output_tokens:20,total_tokens:120}};
    if(body.text.format.name==="execution_fidelity_audit")return Response.json({...accounting,output_text:JSON.stringify(verdicts[Math.min(audits++,verdicts.length-1)])});
    return Response.json({...accounting,output_text:JSON.stringify({...plans[Math.min(generations++,plans.length-1)],
      nativeAppointmentInterpretation:{intent:"none",authorityEvidence:null,authorization:null}})});
  });
  return {fetchImplementation};
}
describe("task-only preparation",()=>{
  it("accounts for generation, semantic repair and both audits through the existing request ledger hooks",async()=>{
    const good=await fixture(),bad=structuredClone(good);
    bad.prohibitedActions=["Do not confuse participants."];
    bad.taskEvidence.push({path:"prohibitedActions.0",sources:[{path:"objective",quote:raw.objective}]});
    const mock=provider([bad,good],[{languageViolations:[],semanticViolations:[{path:"prohibitedActions.0",reason:"unsupported_addition"}]},{languageViolations:[],semanticViolations:[]}]);
    const requests: Parameters<NonNullable<BriefCompilerRunOptions["beforeProviderRequest"]>>[0][]=[];
    const results: BriefCompilerProviderRequestResult[]=[];
    const compilation=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy,
      beforeProviderRequest:async request=>{requests.push(request);return true;},
      afterProviderRequest:async result=>{results.push(result);}
    });
    expect(compilation.policyDecision.status).toBe("ready_for_review");
    expect(requests.map(r=>r.stage)).toEqual(["input_moderation","compilation","language_audit","compilation_repair","language_audit","output_moderation"]);
    expect(new Set(requests.map(r=>r.clientRequestId)).size).toBe(6);
    expect(results.map(r=>r.clientRequestId)).toEqual(requests.map(r=>r.clientRequestId));
    for(const request of requests){
      const result=results.find(r=>r.clientRequestId===request.clientRequestId)!;
      expect(result.outcome).toBe("succeeded");
      if(request.operationType==="brief_compilation"){
        expect(request.reserveUsdMicros).toBeGreaterThan(0);
        expect(request.pricingVersion).toBe(policy.pricingVersion);
        expect(result.usage).toMatchObject({inputTextTokens:100,outputTextTokens:20,totalTokens:120});
      }else expect(request.reserveUsdMicros).toBeUndefined();
    }
    expect(requests[3]!.requestMetadata).toMatchObject({repairKind:"integrity",repairNumber:1});
  });
  it("supports empty optional sections, four requests, immutable approval and direct Live admission",async()=>{
    const plan=await fixture(),mock=provider([plan]);
    const c=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy});
    expect(c).toMatchObject({compilerVersion:"brief-compiler-15",compiledBrief:{schemaVersion:"10",prohibitedActions:[],stopConditions:[],unresolvedCriteria:[]},policyDecision:{status:"ready_for_review"}});
    expect(callCompilationSchema.parse(c)).toEqual(c);expect(hasValidCompilationSnapshotHash(c)).toBe(true);
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(4);
    const schema=JSON.parse(String(mock.fetchImplementation.mock.calls[1]![1]!.body)).text.format.schema;
    expect(schema.properties.prohibitedActions.minItems).toBe(0);expect(schema.required).toContain("taskEvidence");
    const repo=new InMemoryCallRepository();const brief=await repo.create(raw,c);
    await repo.approveCompilation(brief.id,await originalPlanReview(repo,brief.id));
    const snapshot=await repo.get(brief.id);const approval=createApprovedExecutionSnapshot(snapshot!);
    expect(approval.version).toBe(9);expect(approval.plan.prohibitedActions).toEqual([]);
    expect(approval.plan).not.toHaveProperty("taskEvidence");
    expect(()=>nativeV2Session(approval)).toThrow("LIVE_V2_REAPPROVAL_REQUIRED");
    expect(planReviewFields(c).some(f=>f.id.startsWith("taskEvidence"))).toBe(false);
    expect(await repo.refreshAnsweringApproval(brief.id)).toBe(false);
  });
  it("uses the same request budget for plan-only approval and audits its complete execution projection",async()=>{
    const plan=await fixture(),mock=provider([plan]);
    const c=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy:{...policy,promptVersion:PLAN_ONLY_POLICY}});
    expect(c.compilerVersion).toBe("brief-compiler-16");expect(c.policyDecision.status).toBe("ready_for_review");
    expect(callCompilationSchema.parse(c)).toEqual(c);expect(hasValidCompilationSnapshotHash(c)).toBe(true);
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(4);
    const bodies=mock.fetchImplementation.mock.calls.map(call=>JSON.parse(String(call[1]?.body)));
    expect(bodies[1].input[0].content).toContain("Only the complete approved localized plan will be available");
    expect(bodies[1].input[0].content).not.toContain("The original approved user context will also be available to Live");
    const audit=bodies.find(b=>b.text?.format?.name==="execution_fidelity_audit");
    expect(audit.instructions).toContain("Runtime completeness");
    const input=JSON.parse(audit.input);expect(input.executionTask.localizedObjective).toBe(plan.localizedObjective);
    expect(input.sourceMaterial.objective).toBe(raw.objective);
    const repo=new InMemoryCallRepository(),brief=await repo.create(raw,c);
    await repo.approveCompilation(brief.id,await originalPlanReview(repo,brief.id));
    const approval=createApprovedExecutionSnapshot((await repo.get(brief.id))!);
    expect(approval.version).toBe(10);expect(approval).not.toHaveProperty("taskSources");
    const session=nativeV2Session(approval);expect(session.profile).toBe("general");
    expect(JSON.stringify(session)).not.toContain('"taskEvidence"');expect(JSON.stringify(session)).not.toContain('"sourceMaterial"');
  });
  it("validates exact source paths and quotes without interpreting source strings as instructions",async()=>{
    const p=await fixture();expect(taskEvidenceIssues(p,raw)).toEqual([]);
    const invalid=structuredClone(p);invalid.taskEvidence[0]!.sources[0]!.quote="invented quotation";
    expect(taskEvidenceIssues(invalid,raw)).toContain("taskEvidence.0.sources.0");
    invalid.taskEvidence[0]!.sources[0]!.path="allowedFacts.0";
    expect(taskEvidenceIssues(invalid,raw)).toContain("taskEvidence.0.sources.0");
    expect(taskEvidenceIssues({...p,taskEvidence:[]},raw)).toContain("successCriteria.0");
    expect(taskEvidenceIssues({...p,taskEvidence:[...p.taskEvidence,p.taskEvidence[0]!]},raw)).toContain("taskEvidence.2.path");
    expect(compiledCallBriefSchema.safeParse({...p,schemaVersion:"9"}).success).toBe(false);
  });
  it("repairs the captured internal-rule leak even when its quote is a valid source substring",async()=>{
    const good=await fixture(),bad=structuredClone(good);
    bad.prohibitedActions=["Do not present Nina's food preference as Nina Keller's preference."];
    bad.taskEvidence.push({path:"prohibitedActions.0",sources:[{path:"objective",quote:raw.objective}]});
    const mock=provider([bad,good],[{languageViolations:[],semanticViolations:[{path:"prohibitedActions.0",reason:"unsupported_addition"}]},{languageViolations:[],semanticViolations:[]}]);
    const c=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy});
    expect(c.compiledBrief?.prohibitedActions).toEqual([]);expect(c.policyDecision.status).toBe("ready_for_review");
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(6);
    const repair=JSON.parse(String(mock.fetchImplementation.mock.calls[3]![1]!.body));
    expect(repair.input[0].content).toContain("do not add a prohibition telling Live to avoid the compiler error");
  });
  it("repairs unconditional failure criteria on an inapplicable branch in the same audit",async()=>{
    const good=await fixture(),bad=structuredClone(good);
    bad.unresolvedCriteria=["If Nina does not want pizza, the task remains unresolved."];
    bad.taskEvidence.push({path:"unresolvedCriteria.0",sources:[{path:"objective",quote:raw.objective}]});
    const mock=provider([bad,good],[{languageViolations:[],semanticViolations:[{path:"unresolvedCriteria.0",reason:"source_changed"}]},{languageViolations:[],semanticViolations:[]}]);
    const c=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy});
    expect(c.compiledBrief?.unresolvedCriteria).toEqual([]);expect(mock.fetchImplementation).toHaveBeenCalledTimes(6);
  });
  it.each(["Do not disclose my surname.","Do not confuse my preference with Nina's.","Stop if the price is above CHF 100."])("retains an explicit restriction: %s",async restriction=>{
    const input={...raw,context:restriction},p=await fixture(input);p.prohibitedActions=[restriction];
    p.taskEvidence.push({path:"prohibitedActions.0",sources:[{path:"context",quote:restriction}]});
    const c=await new OpenAIBriefCompiler({apiKey:"test",...provider([p])}).compile(input,1,{policy});
    expect(c.compiledBrief?.prohibitedActions).toEqual([restriction]);expect(taskEvidenceIssues(c.compiledBrief!,input)).toEqual([]);
    expect(createApprovedExecutionPlan(c.compiledBrief!).prohibitedActions).toEqual([restriction]);
  });
  it("does not alter historical compiler prompts or permit provenance in spoken fields",()=>{
    expect(buildCompilerInstructions("native_roles")).not.toContain("taskEvidence");
    expect(buildCompilerInstructions("native_task")).toContain("Return [] when these sections are unnecessary");
  });
  it("blocks persistent internal-rule leakage within the existing repair budget",async()=>{
    const p=await fixture();p.prohibitedActions=["Keep participant roles separate."];
    p.taskEvidence.push({path:"prohibitedActions.0",sources:[{path:"objective",quote:raw.objective}]});
    const mock=provider([p],[{languageViolations:[],semanticViolations:[{path:"prohibitedActions.0",reason:"unsupported_addition"}]}]);
    const c=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy});
    expect(c.policyDecision.status).toBe("blocked");expect(mock.fetchImplementation).toHaveBeenCalledTimes(10);
  });
  it("repairs omitted explicit restrictions instead of treating empty sections as sufficient",async()=>{
    const input={...raw,context:"Do not disclose my surname."},good=await fixture(input),bad=structuredClone(good);
    good.prohibitedActions=[input.context];good.taskEvidence.push({path:"prohibitedActions.0",sources:[{path:"context",quote:input.context}]});
    const mock=provider([bad,good],[{languageViolations:[],semanticViolations:[{path:"prohibitedActions",reason:"source_omitted"}]},{languageViolations:[],semanticViolations:[]}]);
    const c=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(input,1,{policy});
    expect(c.compiledBrief?.prohibitedActions).toEqual([input.context]);expect(mock.fetchImplementation).toHaveBeenCalledTimes(6);
  });
  it.each(["de-CH","en-GB","fr-CH","it-CH","ru-RU"] as const)("keeps provenance and empty sections independent of call language and participant names: %s",async locale=>{
    for(const recipientName of ["Nina","Lea Berger","Nina Keller"]){
      const input={...raw,locale,recipientName,context:"Do not disclose the reference.",allowedFacts:["Reference ABC-42"],
        clarificationAnswers:[{issueCode:"ambiguous_recipient_or_subject" as const,answer:"Ask Mila about her preference instead."}]};
      const p=await fixture(input);
      p.prohibitedActions=["Do not disclose the reference."];
      p.taskEvidence.push({path:"prohibitedActions.0",sources:[{path:"context",quote:input.context},{path:"allowedFacts.0",quote:input.allowedFacts[0]!}]});
      expect(taskEvidenceIssues(p,input)).toEqual([]);
      expect(createApprovedExecutionPlan(p).prohibitedActions).toEqual(p.prohibitedActions);
      expect(createApprovedExecutionPlan(p)).not.toHaveProperty("taskEvidence");
    }
  });
});
